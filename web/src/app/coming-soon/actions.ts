"use server";

import { InterestMeta } from "@orbit/contract";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { API_URL } from "./orbit-api";

// A refusal hands the email back, since React empties the form once its action ends.
export type Sent = { ok: true } | { ok: false; error: string; email: string } | null;

// What the page itself may tell about the visit (interest.tsx); the rest comes from the request's headers, here.
const FromPage = InterestMeta.pick({ referrer: true, utm: true, timezone: true, language: true, screen: true });

// Coming Soon's "Join the waitlist": the email, what the page saw, and what the request says (Cloudflare's country, and its
// region and city once visitor location headers are on), to POST /public/interest with the visitor's address.
export async function expressInterest(_: Sent, form: FormData): Promise<Sent> {
  const h = await headers();
  const email = String(form.get("email") ?? "");
  let visit: unknown = {};
  try {
    visit = JSON.parse(String(form.get("visit") || "{}"));
  } catch {} // a visit that can't be read is left out, never the email
  const page = FromPage.safeParse(visit);
  const header = (name: string, max: number) => h.get(name)?.slice(0, max) || undefined;
  const meta = {
    ...(page.success ? page.data : {}),
    country: header("cf-ipcountry", 8),
    region: header("cf-region", 200),
    city: header("cf-ipcity", 200),
    userAgent: header("user-agent", 500),
    acceptLanguage: header("accept-language", 200),
  };
  const xff = h.get("x-forwarded-for"); // Caddy's, from Cloudflare's: the API's rate limit and record read it
  const res = await fetch(`${API_URL}/public/interest`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff } : {}) },
    body: JSON.stringify({ email, meta }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return { ok: false, email, error: "Can't reach Orbit right now. Try again in a minute." };
  if (res.ok) {
    refresh(); // the count under the form goes up
    return { ok: true };
  }
  const e: { message?: unknown } | null = await res.json().catch(() => null);
  return { ok: false, email, error: typeof e?.message === "string" ? e.message : "Something went wrong on our side. Try again in a minute." };
}
