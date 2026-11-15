import { z } from "zod";
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

// POST /auth/code: sends a 6-digit code on WhatsApp or by email. Same answer whether or not an account exists.
export const SendCode = z.object({ to: z.string().min(1).max(254) });
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
  })
  .partial();

// POST /me/email: adds the email proven before the WhatsApp step matched this account.
export const AddEmail = z.object({ token: z.string() });

// Sign-in and security. A code sent with POST /auth/code proves each one.
// POST /me/fresh: a code to the account's own phone or email, before a change.
export const FreshCheck = z.object({ via: z.enum(["phone", "email"]), code: z.string().regex(/^\d{6}$/) });
// PUT /me/phone, PUT /me/email: the new number or address and the code sent to it.
export const ChangeContact = z.object({ to: z.string().min(1).max(254), code: z.string().regex(/^\d{6}$/) });

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
