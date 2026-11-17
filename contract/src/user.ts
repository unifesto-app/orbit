import { z } from "zod";
import { allCities } from "./cities.ts";
import { Roles } from "./roles.ts";

// Sign-in, sign-up and profile (Orbit flows: User, settled 15 Nov 2026).
// The contact and age rules are copied from the app's src/signin.ts so the API, the app and the web agree; the app
// should import them from here once its sign-in is wired to the API.

// An Indian mobile: 10 digits from 6 to 9, typed bare, with +91 or 91, or with a leading 0. Spaces, dashes and brackets
// are ignored. "abroad" is a number with another country's code, which Orbit doesn't take (decision 11).
export function readPhone(text: string): string | "abroad" | null {
  const t = text.replace(/[\s\-()]/g, "");
  if (/^\+(?!91)\d/.test(t)) return "abroad";
  const m = /^(?:\+91|91(?=\d{10}$)|0(?=\d{10}$))?([6-9]\d{9})$/.exec(t);
  return m ? `+91${m[1]}` : null;
}

export type Contact = { kind: "phone"; e164: string } | { kind: "email"; email: string };

// One field takes a phone or an email. The email is lowercased: that is its identity.
export function readContact(text: string): Contact | "abroad" | null {
  const t = text.trim();
  if (t.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) && t.length <= 254 ? { kind: "email", email: t.toLowerCase() } : null;
  const phone = readPhone(t);
  return phone === "abroad" || phone === null ? phone : { kind: "phone", e164: phone };
}

// "R••• K•••": the masked account on "Is this you?", enough for its owner to know it.
export const maskName = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0]!.toUpperCase()}•••`)
    .join(" ");

export const ADULT = 18;
const indiaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }); // "2026-11-16"

// Whole years old on `now`'s day in India. `dob` is "YYYY-MM-DD".
export function ageOn(dob: string, now: number) {
  const [y, m, d] = indiaDay.format(new Date(now)).split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// The day someone turns 18, "YYYY-MM-DD". A 29 Feb birthday turns on 1 Mar in a common year.
export function adultOn(dob: string) {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(by + ADULT, bm - 1, bd)).toISOString().slice(0, 10);
}

// "YYYY-MM-DD", a real day from 1900 to today in India.
export const Dob = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const at = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(s) && s >= "1900-01-01" && s <= indiaDay.format(new Date());
  }, "Not a real date");

// The device asking. `id` is the one the API issued this install on an earlier sign-in, kept across sign-outs.
export const Device = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(100),
  client: z.enum(["app", "web"]),
});
export type Device = z.infer<typeof Device>;

// That the request comes from Orbit itself (User flow, Account security), on code sends and Google's start. The app
// signs `<challenge>:<what>` (POST /auth/challenge, then proofOf): an iPhone with App Attest, its first time with the
// key's attestation and after that with an assertion, an Android phone with a Play Integrity token whose request hash
// is that text (so it holds no number or email: Google sees it). The web (Galaxy, code sends only) sends a Cloudflare
// Turnstile token.
export const Proof = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ios"),
    challenge: z.string().min(1).max(100),
    keyId: z.string().min(1).max(100),
    attestation: z.string().max(20_000).optional(),
    assertion: z.string().max(2_000).optional(),
  }),
  z.object({ kind: z.literal("android"), challenge: z.string().min(1).max(100), token: z.string().min(1).max(20_000) }),
  z.object({ kind: z.literal("web"), token: z.string().min(1).max(4_000) }),
]);
export type Proof = z.infer<typeof Proof>;
// What the proof signs after the challenge.
export const proofOf = { code: "code", google: "google" } as const;

// POST /auth/code: sends a 6-digit code on WhatsApp or by email. Same answer whether or not an account exists.
// A proof that isn't one of these shapes counts as none, so it's refused or let through like a missing one.
export const SendCode = z.object({ to: z.string().min(1).max(254), proof: Proof.optional().catch(undefined) });
// POST /auth/google/start, with a body only from builds that prove themselves.
export const GoogleStart = z.object({ proof: Proof.optional().catch(undefined) });
export const CodeSent = z.object({ retryIn: z.number() });

// POST /auth/code/verify. `signup` is the token from an earlier step, when this is the WhatsApp number step.
export const VerifyCode = z.object({
  to: z.string().min(1).max(254),
  code: z.string().regex(/^\d{6}$/),
  device: Device,
  signup: z.string().optional(),
});

// POST /auth/confirm: the answer to "Is this you?". `me: false` is "Not me, start fresh".
export const Confirm = z.object({ ticket: z.string(), me: z.boolean(), device: Device });

// POST /auth/signup: About you. Continue creates the account.
export const AboutYou = z.object({ signup: z.string(), name: z.string().trim().min(1).max(100), dob: Dob, device: Device });

// POST /auth/refresh. The refresh token rotates on every use.
export const Refresh = z.object({ refresh: z.string().min(1).max(200) });

// The account and its roles, which the app's mode switcher draws from.
export const Me = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    dob: z.string().nullable(),
    gender: z.string().nullable(),
    photo: z.string().nullable(),
    city: z.string().nullable(), // for new events nearby; only the account sees it
    since: z.string(), // ISO time the account was made
    // Set while a deletion waits: the app shows "Keep my account" in front of Home until then.
    deletionDue: z.string().nullable(),
  })
  .extend(Roles.shape);
export type Me = z.infer<typeof Me>;

// PATCH /me. null clears a field; the name can't be cleared. Date of birth, phone and email change elsewhere.
export const UpdateMe = z
  .object({
    name: z.string().trim().min(1).max(100),
    gender: z.string().trim().min(1).max(30).nullable(),
    // A city's name from the pickers' list (names are unique across states), so no Google place name is ever kept.
    city: z
      .string()
      .refine((name) => allCities.some((c) => c.name === name), "Not a city on Orbit's list")
      .nullable(),
  })
  .partial();

// POST /me/email: adds the email proven before the WhatsApp step matched this account.
export const AddEmail = z.object({ token: z.string() });

// Google and Apple, and every way in (User flow, Sign-in methods).
export const Provider = z.enum(["google", "apple"]);
export type Provider = z.infer<typeof Provider>;
export type Way = "phone" | "email" | Provider | "passkey";

// What proves Google, Apple or a passkey. The API checks each:
// - Google: the grant the API's own Google page sent back to the app, and the secret POST /auth/google/start gave the
//   app with that page, so another app that catches the link back can't use it.
export const GoogleProof = z.object({ grant: z.string().min(1).max(100), verifier: z.string().min(43).max(128) });
// - Apple: the identity token from Apple's sheet, made with a nonce from POST /auth/nonce, and Apple's authorization
//   code, which lets the API revoke Apple when the account goes.
export const AppleProof = z.object({ idToken: z.string().min(1).max(8000), nonce: z.string().min(1).max(100), code: z.string().max(1000).optional() });
// - A passkey: the challenge from the options call and the authenticator's answer, as JSON.
export const PasskeyProof = z.object({ challenge: z.string().min(1).max(200), credential: z.record(z.string(), z.unknown()) });

// POST /auth/google, /auth/apple, /auth/passkey: sign in or sign up. Apple sends the name only the first time, so the
// app passes it on for About you.
export const GoogleSignIn = GoogleProof.extend({ device: Device });
export const AppleSignIn = AppleProof.extend({ device: Device, name: z.string().trim().max(100).optional() });
export const PasskeySignIn = PasskeyProof.extend({ device: Device });
// POST /auth/google/start: no body; answers { url, verifier }: the page to open, and the secret that redeems its grant.

// Sign-in and security. Every change needs a fresh check first.
// POST /me/fresh: any way in the account has. Codes come from POST /auth/code to the account's own phone or email.
export const FreshCheck = z.union([
  z.object({ via: z.literal("phone"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ via: z.literal("email"), code: z.string().regex(/^\d{6}$/) }),
  GoogleProof.extend({ via: z.literal("google") }),
  AppleProof.extend({ via: z.literal("apple") }),
  PasskeyProof.extend({ via: z.literal("passkey") }),
]);
// PUT /me/phone, PUT /me/email: the new number or address and the code sent to it.
export const ChangeContact = z.object({ to: z.string().min(1).max(254), code: z.string().regex(/^\d{6}$/) });
// POST /me/passkeys: the new passkey, after POST /me/passkeys/options. PATCH /me/passkeys/:id renames one.
export const AddPasskey = PasskeyProof;
export const RenamePasskey = z.object({ name: z.string().trim().min(1).max(50) });
// POST /me/ways: "Add Google to your account?", answered yes after signing in with a number already on Orbit.
export const AddWay = z.object({ token: z.string() });

// GET /me/security: every way in and every device signed in.
export const Security = z.object({
  phone: z.string().nullable(),
  email: z.string().nullable(),
  google: z.object({ email: z.string().nullable() }).nullable(),
  apple: z.object({ email: z.string().nullable() }).nullable(),
  passkeys: z.array(z.object({ id: z.string(), name: z.string(), added: z.string(), lastUsed: z.string().nullable() })),
  fresh: z.boolean(), // a fresh check in the last 10 minutes on this device
  heldUntil: z.string().nullable(), // the 7-day hold after "Is this you?": other ways in can't be removed until then
  devices: z.array(z.object({ id: z.string(), name: z.string(), client: z.enum(["app", "web"]), lastActive: z.string(), current: z.boolean() })),
});
export type Security = z.infer<typeof Security>;

// Where a sign-in goes next.
export const AuthStep = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("signedIn"),
    access: z.string(),
    refresh: z.string(),
    device: z.string(),
    expiresIn: z.number(), // seconds the access token lasts
    me: Me,
    // "Add this email to your account?", after a WhatsApp number matched an existing account.
    addEmail: z.object({ email: z.string(), token: z.string() }).optional(),
    // "Add Google to your account?", the same for Google or Apple.
    addWay: z.object({ provider: Provider, email: z.string().nullable(), token: z.string() }).optional(),
  }),
  // "R••• K•••, on Orbit since 2025. Is this you?": a phone code on a device the account hasn't used.
  z.object({ step: z.literal("confirm"), ticket: z.string(), name: z.string(), since: z.number() }),
  // Add a WhatsApp number next.
  z.object({ step: z.literal("phone"), signup: z.string() }),
  // About you next; `name` prefills it.
  z.object({ step: z.literal("aboutYou"), signup: z.string(), name: z.string().nullable() }),
]);
export type AuthStep = z.infer<typeof AuthStep>;

export const Tokens = z.object({ access: z.string(), refresh: z.string(), expiresIn: z.number() });

// Every error: a code the client can branch on and a message that says what to do.
export const ApiError = z.object({
  error: z.string(),
  message: z.string(),
  retryIn: z.number().optional(), // seconds, on tooSoon
  until: z.string().nullable().optional(), // on suspended; null = closed for good
  opensOn: z.string().optional(), // on under18, for a migrated account
});
export type ApiError = z.infer<typeof ApiError>;
