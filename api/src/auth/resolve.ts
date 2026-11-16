import type { Contact, Way } from "@orbit/contract";
import type { Identity } from "./ways.ts";

// Which account a proven phone or email opens (User flow, "How a sign-in finds its account"). Pure, so the doc's rows
// are tested as a table in resolve.test.ts. Google and Apple come in by their email (routes.ts, signInWith); a new one
// rides along in `identity` to the account it ends up on.

// What a sign-in carries between screens, inside a signed token. Nothing here is saved until About you.
export type Pending = {
  email?: string; // proven before the WhatsApp step
  phone?: string; // proven, on its way to a new account
  userId?: string; // an existing account being finished (a migrated one with no phone or no date of birth)
  displace?: string; // "Not me, start fresh": the account this number moves away from
  via?: Way; // the way in this sign-in proved, for the device's fresh check
  identity?: Identity; // Google or Apple, proven, not on any account yet
  name?: string; // from Google or Apple, for About you
};

// The account the proof matched, if any.
export type Found = { id: string; email: string | null; deviceKnown: boolean } | null;

export type Pick =
  | { account: string; setPhone?: string; addEmail?: string; addIdentity?: Identity } // carry on with this account
  | { confirm: string } // ask "Is this you?" about this account first
  | { fresh: Pending } // a new account, made at About you
  | { refuse: "phoneTaken" };

export function resolve(proof: Contact, found: Found, pending: Pending | null): Pick {
  if (proof.kind === "email") return found ? { account: found.id } : { fresh: { email: proof.email } };

  // The WhatsApp step for an account that has no phone yet. If the number is on another account, ask for a different
  // one, so neither account is stranded (no merging in v1).
  if (pending?.userId) {
    return found && found.id !== pending.userId ? { refuse: "phoneTaken" } : { account: pending.userId, setPhone: proof.e164 };
  }
  // A number alone opens the whole account, so on a device the account hasn't used, its owner confirms first (decision 3
  // with the recycled-SIM guard).
  if (found) return found.deviceKnown ? { account: found.id, addEmail: found.email ? undefined : pending?.email, addIdentity: pending?.identity } : { confirm: found.id };
  return { fresh: { email: pending?.email, phone: proof.e164, identity: pending?.identity, name: pending?.name } };
}

// What an existing account still needs before it signs in: a phone ("+0" placeholders have none), then About you until
// it has a date of birth and has accepted the current terms. That covers migrated people, who have no date of birth on
// file and accept Orbit's terms there, and keeps an under-18 migrated person at About you, refused, until their 18th
// birthday.
export const nextFor = (u: { phone: string | null; dob: string | null; termsAccepted: boolean }) =>
  !u.phone ? "phone" : !u.dob || !u.termsAccepted ? "aboutYou" : "signIn";
