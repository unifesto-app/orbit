import { test } from "node:test";
import assert from "node:assert/strict";
import { EditFestItem, EditPerson, NewFestItem, NewPerson, OrderFestItems, SetEventPeople } from "./people.ts";

const id = "00000000-0000-4000-8000-000000000001", id2 = "00000000-0000-4000-8000-000000000002";

test("a new person needs a name and a line; bio and links default", () => {
  assert.deepEqual(NewPerson.parse({ name: " Asha ", headline: "Poet" }), { name: "Asha", headline: "Poet", bio: null, links: [] });
  assert.ok(!NewPerson.safeParse({ name: "", headline: "Poet" }).success);
  assert.ok(!NewPerson.safeParse({ name: "A", headline: "P", links: [{ label: "Site", url: "http://a.in" }] }).success); // https only
  assert.ok(NewPerson.safeParse({ name: "A", headline: "P", links: [{ label: "Site", url: "https://a.in" }] }).success);
  assert.ok(!EditPerson.safeParse({}).success);
});

test("an event's people: each once, with a role", () => {
  assert.ok(SetEventPeople.safeParse({ shown: [], people: [{ personId: id, role: "Judge" }, { personId: id2, role: "Host" }] }).success);
  assert.ok(!SetEventPeople.safeParse({ shown: [], people: [{ personId: id, role: "Judge" }, { personId: id, role: "Host" }] }).success);
  assert.ok(!SetEventPeople.safeParse({ shown: [], people: [{ personId: id, role: "" }] }).success);
  assert.ok(!SetEventPeople.safeParse({ people: [] }).success); // what the page showed is required
});

test("fest items: a known kind; order lists each id once", () => {
  const ok = { title: "Battle of Bands", kind: "Competition", when: "6 PM", where: "Main stage", about: "Bands play off." };
  assert.deepEqual(NewFestItem.parse(ok), { ...ok, team: null, prize: null, actHostId: null });
  assert.ok(!NewFestItem.safeParse({ ...ok, kind: "Party" }).success);
  assert.ok(!EditFestItem.safeParse({}).success);
  assert.ok(!OrderFestItems.safeParse({ ids: [id, id] }).success);
  assert.ok(OrderFestItems.safeParse({ ids: [id, id2] }).success);
});
