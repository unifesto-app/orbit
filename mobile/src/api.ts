// The Orbit API (api/, at api.heyorbit.in), for the Orbit app and the host apps (moved here from app/src on 22 Nov 2026).
// Pure: each app's session (app/src/session.ts, host/src/session.ts) gives it the fetch and where the refresh token is
// kept, so it runs on Node in app/src/api.test.ts.
// - `call`: any request. Every failure comes back as the API's own { error, message }, ready to show, never a throw.
// - `authed`: a signed-in request. The access token lives in memory only; a missing or refused one is renewed with the
//   refresh token, once, and the request tried again.
// The refresh token rotates on every use and the previous one stops working 60 seconds later (api/src/auth/tokens.ts),
// so one refresh runs at a time and the new token is kept the moment it arrives.
import { type ApiError, CLIENT_HEADER } from '@orbit/contract';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.heyorbit.in';

const TIMEOUT_MS = 15_000;
const UPLOAD_MS = 60_000; // a form with a file (a photo of up to 5 MB) on a slow connection
const EARLY_S = 30; // renew this long before the access token runs out

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Tokens = { access: string; refresh: string; expiresIn: number }; // the contract's Tokens

export const OFFLINE: ApiError = { error: 'offline', message: 'Can’t reach Orbit. Check your connection and try again.' };
export const BROKEN: ApiError = { error: 'server', message: 'Something went wrong on our side. Try again in a moment.' };
const SIGNED_OUT: ApiError = { error: 'signedOut', message: 'You’re signed out. Sign in again.' };
const gone = (): Result<never> => ({ ok: false, status: 401, error: SIGNED_OUT });

export function makeApi(deps: {
  base: string;
  fetch: typeof fetch;
  refreshToken: { get(): string | null; set(token: string | null): void };
  // The API ended this session (signed out elsewhere, device removed, account suspended): sign out here too. Its
  // message says why.
  onEnded: (why: ApiError) => void;
  now?: () => number;
  // What this is, "ios/1.0.0", sent on every request so Galaxy's Analytics can count people by platform and version
  // (contract/src/analytics.ts, CLIENT_HEADER).
  client?: string;
}) {
  const now = deps.now ?? Date.now;

  // A FormData body (an upload) goes as it is, and fetch sets its content-type; anything else goes as JSON.
  async function call<T>(method: Method, path: string, body?: unknown, access?: string): Promise<Result<T>> {
    const form = body instanceof FormData;
    // AbortController and a timer rather than AbortSignal.timeout, which Hermes may not have.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), form ? UPLOAD_MS : TIMEOUT_MS);
    try {
      const res = await deps.fetch(deps.base + path, {
        method,
        headers: {
          ...(body === undefined || form ? {} : { 'content-type': 'application/json' }),
          ...(access ? { authorization: `Bearer ${access}` } : {}),
          ...(deps.client ? { [CLIENT_HEADER]: deps.client } : {}),
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        signal: abort.signal,
      });
      const data: unknown = res.status === 204 ? null : await res.json().catch(() => undefined);
      if (res.ok) return data === undefined ? { ok: false, status: res.status, error: BROKEN } : { ok: true, data: data as T };
      const e = data as Partial<ApiError> | undefined;
      return { ok: false, status: res.status, error: typeof e?.error === 'string' && typeof e.message === 'string' ? (e as ApiError) : BROKEN };
    } catch {
      return { ok: false, status: 0, error: OFFLINE }; // no answer: offline, timed out, or the server is down
    } finally {
      clearTimeout(timer);
    }
  }

  let access: { token: string; until: number } | null = null;
  let renewing: Promise<Result<string>> | null = null;
  // Bumped on every sign-in and sign-out, so a refresh that was under way can't bring back tokens from before.
  let epoch = 0;

  const keep = (t: Tokens) => {
    deps.refreshToken.set(t.refresh);
    access = { token: t.access, until: now() + (t.expiresIn - EARLY_S) * 1000 };
  };

  function stop() {
    epoch++;
    access = null;
    renewing = null;
    deps.refreshToken.set(null);
  }
  function end(why: ApiError) {
    stop();
    deps.onEnded(why);
  }

  function renew(): Promise<Result<string>> {
    if (renewing) return renewing;
    const p: Promise<Result<string>> = (async (): Promise<Result<string>> => {
      const at = epoch;
      const refresh = deps.refreshToken.get();
      if (!refresh) {
        end(SIGNED_OUT); // signed in on screen with no token to stay so: say so rather than fail every request
        return gone();
      }
      let r = await call<Tokens>('POST', '/auth/refresh', { refresh });
      // No answer, or a proxy's error: the API may have rotated it all the same, and only that answer had the new token.
      // The same token gets the same new one for a minute, so ask again at once. Past the minute, the old token ends
      // every session.
      // ponytail: an answer lost for longer (an outage, or the app killed mid-refresh and reopened a minute later) still
      // signs out everywhere; the API's fix is to forgive a late old token until the new one's access token is used.
      if (!r.ok && (r.status === 0 || r.status >= 500) && at === epoch) r = await call<Tokens>('POST', '/auth/refresh', { refresh });
      if (at !== epoch) return gone();
      if (r.ok) {
        keep(r.data);
        return { ok: true, data: r.data.access };
      }
      // Only the API saying so ends the session; offline or a server fault keeps it, to try again later.
      if (r.error.error === 'signedOut' || r.error.error === 'suspended') end(r.error);
      return r;
    })().finally(() => {
      if (renewing === p) renewing = null; // not one started after a sign-out or sign-in cleared this one
    });
    renewing = p;
    return p;
  }

  // Pinned to the sign-in it started under: after a sign-out or another sign-in, it never goes out with the next
  // account's token.
  async function authed<T>(method: Method, path: string, body?: unknown): Promise<Result<T>> {
    const at = epoch;
    let token = access && access.until > now() ? access.token : null;
    if (!token) {
      const r = await renew();
      if (!r.ok) return r;
      if (at !== epoch) return gone();
      token = r.data;
    }
    const first = await call<T>(method, path, body, token);
    if (at !== epoch) return gone();
    if (!first.ok && first.status === 403 && first.error.error === 'suspended') {
      end(first.error);
      return first;
    }
    if (first.ok || first.status !== 401) return first;
    // Refused: the token ran out early or the session ended. One renewal tells which; then one more try.
    const r = await renew();
    if (!r.ok) return r;
    return at === epoch ? call<T>(method, path, body, r.data) : gone();
  }

  return {
    call,
    authed,
    // Signed in: the tokens from the sign-in's last step. No delete first: the new token is written straight over.
    start(t: Tokens) {
      epoch++;
      renewing = null;
      keep(t);
    },
    // Signed out here at once; the API is told with the tokens there were, without waiting.
    signOut() {
      const had = { access: access && access.until > now() ? access.token : null, refresh: deps.refreshToken.get() };
      stop();
      void (async () => {
        let token = had.access;
        if (!token && had.refresh) {
          const r = await call<Tokens>('POST', '/auth/refresh', { refresh: had.refresh });
          token = r.ok ? r.data.access : null;
        }
        if (token) await call('POST', '/auth/signout', undefined, token);
      })();
    },
  };
}
