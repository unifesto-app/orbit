import { Redis } from "ioredis";

// Where codes and their limits live: Redis in production (User flow, plan section 2), a Map in tests and on a laptop.
export type Store = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<boolean>; // true for the one caller that removed it
  incr(key: string, ttlMs: number, by?: number): Promise<number>; // a count in a fixed window from its first hit
};

// ponytail: one process only, and it forgets on restart. Fine for tests and dev; production sets REDIS_URL.
export function memoryStore(now: () => number = Date.now): Store {
  const m = new Map<string, { v: string; until: number }>();
  const live = (k: string) => {
    const e = m.get(k);
    if (e && e.until <= now()) m.delete(k);
    return m.get(k);
  };
  return {
    get: async (k) => live(k)?.v ?? null,
    set: async (k, v, ttl) => void m.set(k, { v, until: now() + ttl }),
    del: async (k) => (live(k) ? m.delete(k) : false),
    incr: async (k, ttl, by = 1) => {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + by;
      m.set(k, { v: String(n), until: e?.until ?? now() + ttl });
      return n;
    },
  };
}

export function redisStore(url: string): Store {
  const r = new Redis(url);
  return {
    get: (k) => r.get(k),
    set: async (k, v, ttl) => void (await r.set(k, v, "PX", ttl)),
    del: async (k) => (await r.del(k)) === 1,
    // PEXPIRE NX needs Redis 7 or Valkey (ElastiCache runs Valkey).
    incr: async (k, ttl, by = 1) => {
      const res = await r.multi().incrby(k, by).pexpire(k, ttl, "NX").exec();
      const err = res?.find(([e]) => e)?.[0];
      if (!res || err) throw err ?? new Error("redis transaction aborted");
      return Number(res[0]![1]);
    },
  };
}
