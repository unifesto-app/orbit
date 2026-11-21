// The Console's sign-in: the Orbit API's tokens in httpOnly cookies, set and read only by this Next server, so no script
// in the browser ever holds one. Galaxy's (galaxy/src/session.ts), with the Console's own cookies and lifetime. Shared
// by proxy.ts, the pages (src/api.ts) and the sign-in page's Server Actions. Nothing here imports next/headers, so
// proxy.ts can use it.
import { type ApiError, CLIENT_HEADER } from "@orbit/contract";

// On the box the Console reaches the API inside Docker's `edge` network (deploy/docker-compose.yml), not through Caddy,
// so the X-Forwarded-For it passes on is the visitor's (Caddy set it on the Console request). Local dev: the API on 4000.
export const API_URL = process.env.ORBIT_API_URL ?? "http://localhost:4000";

export const ACCESS = "cs_a";
export const REFRESH = "cs_r";
export const DEVICE = "cs_d"; // the API's device id: a browser it knows skips "Is this you?"

// Signed out after 30 days unused: each renewal starts the 30 days again. Galaxy's 12 hours is a staff rule; the app
// keeps a session 180 days (api/src/auth/sessions.ts). A browser is more often shared than a phone, so the Console sits
// between. ponytail: my call (21 Nov 2026), the User flow doc says nothing on web sessions; change it here.
export const IDLE_DAYS = 30;

export type Tokens = { access: string; refresh: string; expiresIn: number };
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const OFFLINE: ApiError = { error: "offline", message: "Can't reach the Orbit API. Try again in a minute." };
const BROKEN: ApiError = { error: "server", message: "Something went wrong on our side. Try again in a minute." };

export async function apiFetch<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  o: { body?: unknown; access?: string; xff?: string | null } = {},
): Promise<Result<T>> {
  try {
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        ...(o.body === undefined ? {} : { "content-type": "application/json" }),
        ...(o.access ? { authorization: `Bearer ${o.access}` } : {}),
        // Hosts are people using Orbit, so the Console counts as the web in Analytics (contract's readClient).
        [CLIENT_HEADER]: "web",
        // The API's rate limits read the visitor's address (api/src/http.ts, clientIp), never the Console's.
        ...(o.xff ? { "x-forwarded-for": o.xff } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(15_000),
    });
    const data: unknown = res.status === 204 ? null : await res.json().catch(() => undefined);
    if (res.ok && data !== undefined) return { ok: true, data: data as T };
    const e = data as Partial<ApiError> | undefined;
    const error = typeof e?.error === "string" && typeof e.message === "string" ? (e as ApiError) : BROKEN;
    return { ok: false, status: res.ok ? 500 : res.status, error };
  } catch {
    return { ok: false, status: 0, error: OFFLINE };
  }
}

type Jar = {
  set(name: string, value: string, o: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number }): unknown;
  delete(name: string): unknown;
};
const cookie = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });

// The access cookie goes 30 seconds before the token does, so a page never renders with one about to be refused:
// proxy.ts renews whenever it's missing.
export function keep(jar: Jar, t: Tokens) {
  jar.set(ACCESS, t.access, cookie(t.expiresIn - 30));
  jar.set(REFRESH, t.refresh, cookie(IDLE_DAYS * 24 * 3600));
}
export const keepDevice = (jar: Jar, id: string) => jar.set(DEVICE, id, cookie(365 * 24 * 3600));
export function forget(jar: Jar) {
  jar.delete(ACCESS);
  jar.delete(REFRESH);
}

// Where to go after signing in: a path on this site only. Parsed as the browser will parse it, since a URL parser drops
// tabs and newlines ("/\t/evil.example" is another site). Dot segments fold away too, so "/.//evil.example" parses on
// this site but its path is "//evil.example", another site again: a path starting "//" is refused.
export function safeNext(next: unknown) {
  if (typeof next !== "string") return "/";
  try {
    const u = new URL(next, "http://console.invalid");
    return u.origin === "http://console.invalid" && !u.pathname.startsWith("//") ? u.pathname + u.search : "/";
  } catch {
    return "/";
  }
}
