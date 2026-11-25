// Keeps places out of Sentry (25 Nov 2026): the discover and search reads carry the phone's lat and lng in the query
// string, and fetch breadcrumbs and http spans record the URL. Every query string goes, for every URL. Pure, so
// scrub.test.ts runs it on Node; app/_layout.tsx hands these to Sentry.init.
const noQuery = (s: string) => s.replace(/\?[^\s"'#]*/g, '');
const URLISH = /url|query|description|transaction/i;

// A record whose url-like fields lose their query string; fields that are only the query are dropped.
export function scrubData<T extends Record<string, unknown> | undefined>(d: T): T {
  if (!d) return d;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (/query/i.test(k)) continue;
    out[k] = typeof v === 'string' && URLISH.test(k) ? noQuery(v) : v;
  }
  return out as T;
}

export const scrubBreadcrumb = <B extends { data?: Record<string, unknown>; message?: string }>(b: B): B => ({
  ...b,
  ...(b.message !== undefined && { message: noQuery(b.message) }),
  data: scrubData(b.data),
});

export const scrubEvent = <E extends { breadcrumbs?: { data?: Record<string, unknown>; message?: string }[] }>(e: E): E =>
  e.breadcrumbs ? { ...e, breadcrumbs: e.breadcrumbs.map(scrubBreadcrumb) } : e;

export const scrubSpan = <S extends { data: Record<string, unknown>; description?: string }>(s: S): S => ({
  ...s,
  ...(s.description !== undefined && { description: noQuery(s.description) }),
  data: scrubData(s.data),
});

export const scrubTransaction = <T extends { transaction?: string; spans?: { data: Record<string, unknown>; description?: string }[]; request?: { url?: string; query_string?: unknown } }>(e: T): T => ({
  ...e,
  ...(e.transaction !== undefined && { transaction: noQuery(e.transaction) }),
  ...(e.spans && { spans: e.spans.map(scrubSpan) }),
  ...(e.request && { request: { ...e.request, ...(e.request.url !== undefined && { url: noQuery(e.request.url) }), query_string: undefined } }),
});
