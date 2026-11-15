import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sign, verify } from "hono/jwt";

// Short signed tokens, each for one use: the 15-minute access token, and the steps of a sign-in that carry proof from
// one screen to the next without saving anything (User flow: "No account until it's real").
const TTL = {
  access: 15 * 60, // plan section 6
  phoneStep: 15 * 60, // a proven email, or an account with no phone, on its way to the WhatsApp step
  aboutYou: 15 * 60, // a proven phone (and maybe email), or an account to finish, on its way to About you
  ticket: 10 * 60, // "Is this you?"
  addEmail: 10 * 60, // "Add this email to your account?"
} as const;
export type Use = keyof typeof TTL;
export const ACCESS_SECONDS = TTL.access;
export const TOKEN_MAX_MS = 15 * 60 * 1000; // the longest of them, for spending one only once

// ponytail: expiry runs on the real clock, not the injected one, so tests can't age a token by ticking.
export async function issue(secret: string, use: Use, claims: Record<string, unknown>) {
  const iat = Math.floor(Date.now() / 1000);
  return sign({ ...claims, use, jti: randomUUID(), iat, exp: iat + TTL[use] }, secret, "HS256");
}

// The claims, or null for anything expired, forged or made for another use.
export async function read<T>(secret: string, use: Use, token: string): Promise<(T & { jti: string }) | null> {
  try {
    const p = await verify(token, secret, "HS256");
    return p.use === use ? (p as T & { jti: string }) : null;
  } catch {
    return null;
  }
}

export const randomToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
