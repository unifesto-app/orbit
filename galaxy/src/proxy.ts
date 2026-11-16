import { type NextRequest, NextResponse } from "next/server";
import { ACCESS, apiFetch, forget, keep, REFRESH, type Tokens } from "./session";

// Every page but sign-in needs someone signed in. Tokens are renewed here, because only a proxy or a Server Action can
// set cookies: a page that renewed the refresh token couldn't keep the new one.
export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/login" || req.cookies.has(ACCESS)) return NextResponse.next();

  const refresh = req.cookies.get(REFRESH)?.value;
  const r = refresh ? await apiFetch<Tokens>("POST", "/auth/refresh", { body: { refresh }, xff: req.headers.get("x-forwarded-for") }) : null;
  if (!r?.ok) {
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
