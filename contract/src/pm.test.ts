import { test } from "node:test";
import assert from "node:assert/strict";
import { AddNote, CreatePmToken, GetTask, ListTasks, SaveTask, UpsertTask, UpsertTrack, cleanLabels } from "./pm.ts";

test("cleanLabels trims, lowercases, drops blanks and repeats", () => {
  assert.deepEqual(cleanLabels([" Mobile ", "mobile", "", "  ", "Web", "WEB"]), ["mobile", "web"]);
});

test("UpsertTask dueDate: empty and real dates pass, impossible dates fail", () => {
  assert.ok(UpsertTask.safeParse({ key: "P1", dueDate: "" }).success);
  assert.ok(UpsertTask.safeParse({ key: "P1", dueDate: "2026-11-17" }).success);
  assert.ok(!UpsertTask.safeParse({ key: "P1", dueDate: "2026-02-31" }).success);
});

test("UpsertTask rejects an unknown key", () => {
  assert.ok(!UpsertTask.safeParse({ key: "P1", foo: 1 }).success);
});

test("key pattern refuses NUL, leading dash, spaces and slashes", () => {
  for (const k of ["%00", "\u0000", "-x", "a b", "a/b", ".a", ""]) {
    assert.ok(!GetTask.safeParse({ key: k }).success, JSON.stringify(k));
    assert.ok(!UpsertTrack.safeParse({ key: k, name: "n" }).success, JSON.stringify(k));
  }
  assert.ok(GetTask.safeParse({ key: "P1.2_x-y" }).success);
});

test("SaveTask accepts ifUpdatedAt; UpsertTask does not", () => {
  assert.ok(SaveTask.safeParse({ key: "P1", ifUpdatedAt: "2026-11-17T10:00:00.000Z" }).success);
  assert.ok(!SaveTask.safeParse({ key: "P1", ifUpdatedAt: "yesterday" }).success);
  assert.ok(!UpsertTask.safeParse({ key: "P1", ifUpdatedAt: "2026-11-17T10:00:00.000Z" }).success);
});

test("AddNote and ListTasks refuse unknown keys", () => {
  assert.ok(!AddNote.safeParse({ message: "hi", foo: 1 }).success);
  assert.ok(!ListTasks.safeParse({ foo: 1 }).success);
});

test("NUL is refused in title, notes, owner, labels, track name, note message, token name, list label", () => {
  const z = "a\u0000b";
  assert.ok(!UpsertTask.safeParse({ key: "P1", title: z }).success);
  assert.ok(!UpsertTask.safeParse({ key: "P1", notes: z }).success);
  assert.ok(!UpsertTask.safeParse({ key: "P1", owner: z }).success);
  assert.ok(!UpsertTask.safeParse({ key: "P1", labels: [z] }).success);
  assert.ok(!UpsertTrack.safeParse({ key: "P", name: z }).success);
  assert.ok(!AddNote.safeParse({ message: z }).success);
  assert.ok(!CreatePmToken.safeParse({ name: z }).success);
  assert.ok(!ListTasks.safeParse({ label: z }).success);
});

test("dueDate year bounds: 2000-01-01 and 2100-12-31 pass, 0000-01-01, 1999-12-31, 2101-01-01 fail", () => {
  for (const d of ["2000-01-01", "2100-12-31"]) assert.ok(UpsertTask.safeParse({ key: "P1", dueDate: d }).success, d);
  for (const d of ["0000-01-01", "1999-12-31", "2101-01-01"]) assert.ok(!UpsertTask.safeParse({ key: "P1", dueDate: d }).success, d);
});
