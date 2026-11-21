"use server";

import type { AuthStep } from "@orbit/contract";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";
import { call } from "../../api";
import { ACCESS, apiFetch, DEVICE, forget, keep, keepDevice, type Result, safeNext } from "../../session";

// The app's sign-in (app/src/app/login.tsx, User flow doc), on the web: signing in and signing up are the same steps, and
// the Orbit API decides each next one (api/src/auth/routes.ts). Every action answers only what the page shows next; the
// tokens go into httpOnly cookies here and never reach the browser's scripts.

// What the page shows next. `go`: signed in, with questions to ask first, then this path.
export type Next =
  | { at: "code"; to: string; signup?: string; wait: number }
  | { at: "whose"; ticket: string; name: string; since: number }
  | { at: "phone"; signup: string }
  | { at: "about"; signup: string; name: string | null };
export type Question = { at: "link"; email: string; token: string } | { at: "keep"; due: string };
export type Outcome = { error?: string; expired?: boolean; retryIn?: number; next?: Next; questions?: Question[]; go?: string };

const xff = async () => (await headers()).get("x-forwarded-for");

// This browser, as Sign-in and security lists it: "Console · Chrome on macOS".
async function device() {
  const h = await headers();
  const { browser, os } = userAgent({ headers: h });
  const name = ["Console", browser.name && `${browser.name}${os.name ? ` on ${os.name}` : ""}`].filter(Boolean).join(" · ");
  return { id: (await cookies()).get(DEVICE)?.value, name, client: "web" as const };
}

// The API's no, as the page shows it. `expired`: a step token or ticket ran out, so the page starts again.
const no = (r: Extract<Result<unknown>, { ok: false }>): Outcome => ({ error: r.error.message, expired: r.error.error === "expired", retryIn: r.error.retryIn });

// A code to a phone (WhatsApp) or an email. `turnstile`: the page's Turnstile token, which the API checks (form.tsx).
// A code sent there under 30 seconds ago still works, so "too soon" goes on to it, as the app does.
export async function sendCode(to: string, signup: string | undefined, turnstile: string | undefined): Promise<Outcome> {
  const proof = turnstile ? { kind: "web", token: turnstile } : undefined;
  const r = await apiFetch<{ retryIn: number }>("POST", "/auth/code", { body: { to, proof }, xff: await xff() });
  if (r.ok) return { next: { at: "code", to, signup, wait: r.data.retryIn } };
  if (r.error.error === "tooSoon") return { next: { at: "code", to, signup, wait: r.error.retryIn ?? 30 } };
  return no(r);
}

// "Send a new code": the wait until the next one, or why not.
export async function resendCode(to: string, turnstile: string | undefined): Promise<Outcome> {
  const proof = turnstile ? { kind: "web", token: turnstile } : undefined;
  const r = await apiFetch<{ retryIn: number }>("POST", "/auth/code", { body: { to, proof }, xff: await xff() });
  return r.ok ? { retryIn: r.data.retryIn } : no(r);
}

export async function verifyCode(to: string, code: string, signup: string | undefined, next: string): Promise<Outcome> {
  const r = await apiFetch<AuthStep>("POST", "/auth/code/verify", { body: { to, code, device: await device(), ...(signup && { signup }) }, xff: await xff() });
  return r.ok ? finish(r.data, next) : no(r);
}

// "Is this you?": yes signs in; "Not me, start fresh" goes on to About you for a new account.
export async function confirm(ticket: string, me: boolean, next: string): Promise<Outcome> {
  const r = await apiFetch<AuthStep>("POST", "/auth/confirm", { body: { ticket, me, device: await device() }, xff: await xff() });
  return r.ok ? finish(r.data, next) : no(r);
}

// About you: Continue makes the account (or finishes one), with the terms accepted.
export async function signUp(signup: string, name: string, dob: string, next: string): Promise<Outcome> {
  const r = await apiFetch<AuthStep>("POST", "/auth/signup", { body: { signup, name, dob, device: await device() }, xff: await xff() });
  return r.ok ? finish(r.data, next) : no(r);
}

// Where the API says to go next. Signed in keeps the tokens at once, so leaving at a question after it stays signed in.
async function finish(step: AuthStep, next: string): Promise<Outcome> {
  if (step.step === "confirm") return { next: { at: "whose", ticket: step.ticket, name: step.name, since: step.since } };
  if (step.step === "phone") return { next: { at: "phone", signup: step.signup } };
  if (step.step === "aboutYou") return { next: { at: "about", signup: step.signup, name: step.name } };
  const jar = await cookies();
  keep(jar, step);
  keepDevice(jar, step.device);
  // Asked once each, as in the app: add the email they started with (their number was already on Orbit), and Keep my
  // account when it's set to be deleted. The passkey offer comes with passkeys on the web.
  const questions: Question[] = [
    ...(step.addEmail ? [{ at: "link" as const, email: step.addEmail.email, token: step.addEmail.token }] : []),
    ...(step.me.deletionDue ? [{ at: "keep" as const, due: step.me.deletionDue }] : []),
  ];
  if (!questions.length) redirect(safeNext(next));
  return { questions, go: safeNext(next) };
}

// The questions after signing in post to /login, which the proxy never renews (sign-in has to work signed out). Past the
// access token's 14.5 minutes they can't run, so they say so rather than send someone still signed in back to the start.
const LATE: Outcome = { error: "This question timed out. Choose Not now to go on." };
const late = async () => !(await cookies()).has(ACCESS);

// "Add this email to your account?": signed in already, by the number.
export async function addEmail(token: string): Promise<Outcome> {
  if (await late()) return LATE;
  const r = await call("POST", "/me/email", { token });
  return r.ok ? {} : no(r);
}

export async function keepAccount(): Promise<Outcome> {
  if (await late()) return LATE;
  const r = await call("POST", "/me/deletion/keep");
  return r.ok ? {} : no(r);
}

// The page then loads sign-in afresh ((console)/sign-out.tsx).
export async function signOut() {
  const jar = await cookies();
  const access = jar.get(ACCESS)?.value;
  if (access) await apiFetch("POST", "/auth/signout", { access, xff: await xff() });
  forget(jar);
}
