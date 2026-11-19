import { headers } from "next/headers";
import { after } from "next/server";
import { API_URL } from "../api";

// The visit log's way in (visit.tsx → here → API POST /public/visit): the same site, so nothing cross-site for a
// browser or a blocker to stop, and this server adds what the request's headers say (Cloudflare's location, the
// browser) and the visitor's address, for the API's limits and visitor code. The page's own values for those are
// replaced, never trusted. Always 204, sent before the API is called: the page has nothing to do with the answer.
export async function POST(req: Request) {
  try {
    // A browser's beacon always says its size; anything without one, or large, isn't read.
    const size = Number(req.headers.get("content-length"));
    if (!size || size > 4096) return done();
    // Only this site's pages: a cross-site form or script carries another Origin. (No Origin: older browsers' beacons.)
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin && new URL(origin).host !== req.headers.get("host")) return done();
    const hit: unknown = JSON.parse(await req.text());
    if (!hit || typeof hit !== "object") return done();
    const h = await headers();
    const header = (name: string, max: number) => h.get(name)?.slice(0, max) || undefined;
    const body =
      (hit as { kind?: unknown }).kind === "view"
        ? { ...hit, country: header("cf-ipcountry", 8), region: header("cf-region", 200), city: header("cf-ipcity", 200), userAgent: header("user-agent", 500) }
        : hit;
    const xff = h.get("x-forwarded-for");
    after(() =>
      fetch(`${API_URL}/public/visit`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {}),
    );
  } catch {} // a hit that can't be read or passed on is dropped
  return done();
}

const done = () => new Response(null, { status: 204 });
