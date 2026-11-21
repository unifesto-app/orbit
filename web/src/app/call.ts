import { headers } from "next/headers";
import { API_URL } from "./api";

// The site's one way to send something to the API, for its Server Actions (the waitlist's actions.ts, careers'
// careers/actions.ts). Kept out of those files: everything a "use server" file exports is an action anyone can call.
// POSTs to the API with the browser's address (Caddy's X-Forwarded-For), so its limits are per visitor, not per site.
export async function call(path: string, body: unknown): Promise<{ ok: true } | { ok: false; code?: string; error: string }> {
  const xff = (await headers()).get("x-forwarded-for");
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    // A FormData body (a job application's résumé) goes as it is, and fetch sets its content-type.
    headers: { ...(body instanceof FormData ? {} : { "content-type": "application/json" }), ...(xff ? { "x-forwarded-for": xff } : {}) },
    body: body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000), // past the API's own proof and WhatsApp waits
  }).catch(() => null);
  if (!res) return { ok: false, error: "Can't reach Orbit right now. Try again in a minute." };
  if (res.ok) return { ok: true };
  const e: { error?: unknown; message?: unknown } | null = await res.json().catch(() => null);
  return {
    ok: false,
    code: typeof e?.error === "string" ? e.error : undefined,
    error: typeof e?.message === "string" ? e.message : "Something went wrong on our side. Try again in a minute.",
  };
}
