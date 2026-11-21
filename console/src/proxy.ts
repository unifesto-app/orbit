import { type NextRequest, NextResponse } from "next/server";
import { ACCESS, apiFetch, forget, keep, REFRESH, type Tokens } from "./session";

// Galaxy's (galaxy/src/proxy.ts). Every page but sign-in needs someone signed in. Tokens are renewed here, because only
// a proxy or a Server Action can set cookies: a page that renewed the refresh token couldn't keep the new one.
export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/login" || req.cookies.has(ACCESS)) return NextResponse.next();

  const refresh = req.cookies.get(REFRESH)?.value;
  const r = refresh ? await apiFetch<Tokens>("POST", "/auth/refresh", { body: { refresh }, xff: req.headers.get("x-forwarded-for") }) : null;
  if (!r?.ok) {
    // A Server Action that can't be renewed (the API restarting, or the session ended) runs without a token rather than
    // being sent to /login: replayed there, where its page's actions aren't, it would answer nothing, and Sign out would
    // keep the cookies (review of the sign-in). It's safe: `call` (src/api.ts) still sends any signed-in work to sign-in,
    // and Sign out needs no token to forget them.
    if (req.method === "POST" && req.headers.has("next-action")) {
      const res = NextResponse.next();
      if (r && r.status !== 0 && r.status < 500) forget(res.cookies);
      return res;
    }
    const login = new URL("/login", req.url);
    if (req.nextUrl.pathname !== "/") login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    const res = NextResponse.redirect(login);
    // Only the API saying so ends the sign-in; no answer keeps the token to try again.
    if (r && r.status !== 0 && r.status < 500) forget(res.cookies);
    return res;
  }

  // Renewed: the browser keeps the new tokens on a redirect to the same address (307 keeps a Server Action's POST), and
  // the page renders on the request that brings them back. Rendering with them here would use the new access token
  // before the browser had the refresh token that goes with it, and if this answer were lost, the old token's next use
  // would look stolen and end every session the person has, the app's too (api/src/auth/sessions.ts). Unused, a renewal
  // can be repeated: the same token gets the same new one.
  // ponytail: a browser that took the first sign-in's cookies but drops these would loop until it gives up on redirects.
  // Next sends a same-origin redirect as a bare path (server/web/adapter.js), so behind Caddy it never turns into http.
  const res = NextResponse.redirect(req.nextUrl, 307);
  keep(res.cookies, r.data);
  return res;
}

export const config = {
  // Not Next's own files or the site's images.
  matcher: ["/((?!_next/|icon\\.svg|favicon\\.ico).*)"],
};
