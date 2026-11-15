import { test } from "node:test";
import assert from "node:assert/strict";
import type { Contact } from "@orbit/contract";
import { nextFor, resolve, type Found, type Pending, type Pick } from "./resolve.ts";

// The User doc's "How a sign-in finds its account", row by row.
const phone: Contact = { kind: "phone", e164: "+919876543210" };
const email: Contact = { kind: "email", email: "riya@example.com" };
const acct = (o: Partial<NonNullable<Found>> = {}): Found => ({ id: "u1", email: null, deviceKnown: true, ...o });

const rows: [string, Contact, Found, Pending | null, Pick][] = [
  ["a new email goes to the WhatsApp step", email, null, null, { fresh: { email: "riya@example.com" } }],
  ["an email on an account signs in to it (or finishes it)", email, acct(), null, { account: "u1" }],
  ["an email proof ignores a sign-up in progress", email, null, { email: "other@example.com" }, { fresh: { email: "riya@example.com" } }],
  ["a new number goes to About you", phone, null, null, { fresh: { email: undefined, phone: "+919876543210" } }],
  ["a new number after an email carries the email", phone, null, { email: "riya@example.com" }, { fresh: { email: "riya@example.com", phone: "+919876543210" } }],
  ["a number on an account, on a known device, signs in", phone, acct(), null, { account: "u1", addEmail: undefined }],
  ["the email proven first is offered to that account", phone, acct(), { email: "riya@example.com" }, { account: "u1", addEmail: "riya@example.com" }],
  ["not offered when the account has an email", phone, acct({ email: "r@x.in" }), { email: "riya@example.com" }, { account: "u1", addEmail: undefined }],
  ["a number on an account, on a new device, asks Is this you?", phone, acct({ deviceKnown: false }), null, { confirm: "u1" }],
  ["finishing an account with no phone: a free number goes on it", phone, null, { userId: "u2" }, { account: "u2", setPhone: "+919876543210" }],
  ["finishing an account: its own number again is fine", phone, acct({ id: "u2" }), { userId: "u2" }, { account: "u2", setPhone: "+919876543210" }],
  ["finishing an account: a number on another account is refused", phone, acct(), { userId: "u2" }, { refuse: "phoneTaken" }],
];

for (const [name, proof, found, pending, want] of rows) test(name, () => assert.deepEqual(resolve(proof, found, pending), want));

test("an account needs a phone, then a date of birth and the current terms from About you, before it signs in", () => {
  const p = "+919876543210";
  assert.equal(nextFor({ phone: null, dob: null, termsAccepted: false }), "phone");
  assert.equal(nextFor({ phone: p, dob: null, termsAccepted: false }), "aboutYou");
  assert.equal(nextFor({ phone: p, dob: null, termsAccepted: true }), "aboutYou"); // terms migrated, no date of birth yet
  assert.equal(nextFor({ phone: p, dob: "2000-01-01", termsAccepted: false }), "aboutYou");
  assert.equal(nextFor({ phone: p, dob: "2000-01-01", termsAccepted: true }), "signIn");
});
