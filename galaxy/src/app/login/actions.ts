"use server";

import type { AuthStep } from "@orbit/contract";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";
import { ACCESS, apiFetch, DEVICE, forget, keep, keepDevice, safeNext } from "../../session";

// Signing in to Galaxy (Orbit flows: User, signing in by code): a code by WhatsApp or email, then "Is this you?" on a
// browser the account hasn't used. Galaxy never makes or finishes an account: that's the app's. Only staff get in.

export type Outcome = { error?: string; retryIn?: number; confirm?: { ticket: string; name: string; since: number } };

const xff = async () => (await headers()).get("x-forwarded-for");

async function device() {
  const h = await headers();
  const { browser, os } = userAgent({ headers: h });
  const name = ["Galaxy", browser.name && `${browser.name}${os.name ? ` on ${os.name}` : ""}`].filter(Boolean).join(" · ");
  return { id: (await cookies()).get(DEVICE)?.value, name, client: "web" as const };
}

// `turnstile`: the page's Turnstile token, which the API checks (form.tsx).
export async function sendCode(to: string, turnstile?: string): Promise<Outcome> {
  const proof = turnstile ? { kind: "web", token: turnstile } : undefined;
  const r = await apiFetch<{ retryIn: number }>("POST", "/auth/code", { body: { to, proof }, xff: await xff() });
  return r.ok ? { retryIn: r.data.retryIn } : { error: r.error.message, retryIn: r.error.retryIn };
}

export async function verifyCode(to: string, code: string, next: string): Promise<Outcome> {
  const r = await apiFetch<AuthStep>("POST", "/auth/code/verify", { body: { to, code, device: await device() }, xff: await xff() });
  return r.ok ? finish(r.data, next) : { error: r.error.message };
}

// "Yes, it's me". "Not me" never reaches the API from here: it starts a new account, which Galaxy doesn't do.
export async function confirmMe(ticket: string, next: string): Promise<Outcome> {
  const r = await apiFetch<AuthStep>("POST", "/auth/confirm", { body: { ticket, me: true, device: await device() }, xff: await xff() });
  return r.ok ? finish(r.data, next) : { error: r.error.message };
}

async function finish(step: AuthStep, next: string): Promise<Outcome> {
  if (step.step === "confirm") return { confirm: { ticket: step.ticket, name: step.name, since: step.since } };
  if (step.step !== "signedIn") return { error: "Finish signing up in the Orbit app first, then sign in here." };
  if (!step.me.staff) {
    // Not staff: the session the API just made ends at once, and nothing is kept here.
    await apiFetch("POST", "/auth/signout", { access: step.access, xff: await xff() });
    return { error: "Galaxy is for Orbit's staff. Sign in with your staff account." };
  }
  const jar = await cookies();
  keep(jar, step);
  keepDevice(jar, step.device);
  redirect(safeNext(next));
}

export async function signOut() {
  const jar = await cookies();
  const access = jar.get(ACCESS)?.value;
  if (access) await apiFetch("POST", "/auth/signout", { access, xff: await xff() });
  forget(jar);
  redirect("/login");
}
