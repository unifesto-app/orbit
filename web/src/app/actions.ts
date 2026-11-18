"use server";

import { ADULT, ageOn, Dob, FEATURES, type Feature, Interest, InterestMeta, readPhone } from "@orbit/contract";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { API_URL } from "./api";

// The waitlist in two steps (owner, 18 Nov 2026: "Name, Mobile, WhatsApp Otp, DoB", "very simple for user to
// complete"): the details and the features they'd love, then the WhatsApp code. Checked here first so a code is never
// sent for a form that can't join; the API checks it all again.

export type Details = { name: string; phone: string; email: string; dob: string; features: Feature[]; agree: boolean };
// `sent`: the number the last code went to and when, kept by the page, so changing only the name or date of birth
// goes back to the code already on its way instead of paying for another.
type Sent = { sent?: { phone: string; at: number } };
export type Step = ({ at: "details"; form?: Details; error?: string } & Sent) | ({ at: "code"; form: Details; error?: string; note?: string } & Sent) | { at: "done"; name: string; email: string };

// What the page itself may tell about the visit (waitlist.tsx); the rest comes from the request's headers.
const FromPage = InterestMeta.pick({ referrer: true, utm: true, timezone: true, language: true, screen: true });
const isFeature = (v: string): v is Feature => Object.hasOwn(FEATURES, v);

// Step 1: the details, then a code on WhatsApp. Also "Send a new code" on step 2. `turnstile`: the page's token.
export async function sendCode(data: FormData): Promise<Step> {
  const form: Details = {
    name: String(data.get("name") ?? "").replaceAll("\0", "").trim().slice(0, 100),
    phone: String(data.get("phone") ?? "").trim().slice(0, 20),
    email: String(data.get("email") ?? "").trim().slice(0, 254),
    dob: String(data.get("dob") ?? ""),
    features: data.getAll("features").map(String).filter(isFeature),
    agree: data.get("agree") === "on",
  };
  const back = (error: string): Step => ({ at: "details", form, error });
  if (!form.name) return back("Enter your name.");
  const phone = readPhone(form.phone);
  if (phone === "abroad") return back("Orbit takes Indian (+91) WhatsApp numbers only.");
  if (!phone) return back("Enter your 10-digit WhatsApp number.");
  if (!Interest.shape.email.safeParse(form.email).success) return back("Enter a valid email address."); // the API's own check
  if (!Dob.safeParse(form.dob).success) return back("Enter your date of birth.");
  if (ageOn(form.dob, Date.now()) < ADULT) return back("Orbit is for people 18 and over.");
  // The one box (owner, 18 Nov 2026: "common checkbox along with 18+"): 18 or older, and the Terms and Privacy Policy.
  if (!form.agree) return back("Tick the box to confirm you’re 18 or older and agree to the Terms and Privacy Policy.");

  // Only the name, email or date changed and the last code is still good (waitlist.tsx): checked, nothing sent.
  if (data.get("reuse")) return { at: "code", form };
  const token = String(data.get("turnstile") ?? "");
  const r = await call("/public/interest/code", { phone, proof: token ? { kind: "web", token } : undefined });
  if (!r.ok) return data.get("again") ? { at: "code", form, error: r.error } : back(r.error);
  return { at: "code", form, note: data.get("again") ? "New code sent." : undefined };
}

// Step 2: the code, with the details from step 1 and what the visit says about itself.
export async function join(form: Details, data: FormData): Promise<Step> {
  const code = String(data.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { at: "code", form, error: "Enter the 6-digit code." };
  const h = await headers();
  let visit: unknown = {};
  try {
    visit = JSON.parse(String(data.get("visit") || "{}"));
  } catch {} // a visit that can't be read is left out, never the sign-up
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
  const r = await call("/public/interest", { ...form, code, meta });
  if (r.ok) {
    refresh(); // the count goes up
    return { at: "done", name: form.name.split(/\s+/)[0]!, email: form.email.toLowerCase() };
  }
  return r.code === "under18" ? { at: "details", form, error: r.error } : { at: "code", form, error: r.error };
}

// POSTs to the API with the browser's address (Caddy's X-Forwarded-For), so its limits are per visitor, not per site.
async function call(path: string, body: unknown): Promise<{ ok: true } | { ok: false; code?: string; error: string }> {
  const xff = (await headers()).get("x-forwarded-for");
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff } : {}) },
    body: JSON.stringify(body),
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
