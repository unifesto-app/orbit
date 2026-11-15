import { test } from "node:test";
import assert from "node:assert/strict";
import { adultOn, ageOn, Dob, maskName, readContact, readPhone } from "./user.ts";

test("readPhone takes Indian mobiles in every usual shape and refuses others", () => {
  for (const t of ["9876543210", "+91 98765 43210", "919876543210", "09876543210", "(98765) 43-210"]) assert.equal(readPhone(t), "+919876543210", t);
  assert.equal(readPhone("+14155550100"), "abroad");
  assert.equal(readPhone("5876543210"), null); // mobiles start 6 to 9
  assert.equal(readPhone("98765"), null);
});

test("readContact lowercases emails and tells phones from emails", () => {
  assert.deepEqual(readContact(" Riya@Example.COM "), { kind: "email", email: "riya@example.com" });
  assert.deepEqual(readContact("98765 43210"), { kind: "phone", e164: "+919876543210" });
  assert.equal(readContact("riya@example"), null);
  assert.equal(readContact("+447700900123"), "abroad");
});

test("ageOn counts whole years on the day in India", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(ageOn("2008-11-17", at("2026-11-16T12:00:00+05:30")), 17);
  assert.equal(ageOn("2008-11-16", at("2026-11-16T00:10:00+05:30")), 18); // still 15 Nov in UTC, already 16 Nov in India
  assert.equal(adultOn("2008-02-29"), "2026-03-01");
});

test("Dob takes only real past days", () => {
  assert.equal(Dob.safeParse("2004-03-12").success, true);
  assert.equal(Dob.safeParse("2004-02-30").success, false);
  assert.equal(Dob.safeParse("1899-12-31").success, false);
  assert.equal(Dob.safeParse("2999-01-01").success, false);
});

test("maskName keeps only initials", () => {
  assert.equal(maskName(" riya  kapoor "), "R••• K•••");
});
