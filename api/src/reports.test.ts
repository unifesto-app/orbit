import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { auditLog, events, staffGrants } from "./db/schema.ts";

// Reports (X15): sending one, the Galaxy queue, and the event's calendar file.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(8_000_000 + ++n * 11).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async () => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const withFeature = async (feature: "queues" | "hosts") => {
  const s = await join();
  await t.db.insert(staffGrants).values({ userId: s.me.id, feature, addedBy: s.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s;
};
let hn = 0;
const start = async (u: P) => (await as(u)("POST", "/hosts", { name: `Punchline ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const place = { venue: "Hall; Main", address: "Road 1, Block 2", area: "Jubilee Hills", city: "Hyderabad" };
const draft = async (u: P, hostId: string, title = "Open Mic Night") => (await as(u)("POST", `/hosts/${hostId}/events`, { title })).body as { id: string; slug: string };
const publish = async (u: P, hostId: string, title?: string) => {
  const e = await draft(u, hostId, title);
  const form = new FormData();
  form.set("image", new File([(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer()) as BlobPart], "p.png", { type: "image/png" }));
  const up = await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  assert.equal(up.status, 200);
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(DAY), endsAt: iso(DAY + 2 * HOUR), place })).status, 200);
  await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 });
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return e;
};

test("send a report: checked, 404 for a missing or draft subject, one open per subject, 10 a day", async () => {
  const owner = await join(), a = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id);
  const d = await draft(owner, h.id, "Secret");

  assert.equal((await t.call("POST", "/reports", { eventId: e.id, reason: "scam" })).status, 401);
  assert.equal((await as(a)("POST", "/reports", { reason: "scam" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, hostId: h.id, reason: "scam" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "boring" })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "other", note: "x".repeat(1001) })).status, 400);
  assert.equal((await as(a)("POST", "/reports", { eventId: d.id, reason: "scam" })).status, 404);
  assert.equal((await as(a)("POST", "/reports", { hostId: crypto.randomUUID(), reason: "scam" })).status, 404);

  const one = await as(a)("POST", "/reports", { eventId: e.id, reason: "scam", note: "Asks for UPI to a personal number" });
  assert.equal(one.status, 201);
  const again = await as(a)("POST", "/reports", { eventId: e.id, reason: "spam" });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, one.body.id);
  assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "misleading" })).status, 201);

  // 5 valid tries so far today (the 400s don't count); 5 more pass, the 11th is refused, and a day later it's open again.
  for (let i = 0; i < 5; i++) assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).status, 200);
  const many = await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" });
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "tooMany");
  t.tick(DAY);
  assert.equal((await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).status, 200);
});

test("Galaxy: Queues only; list, view, resolve and dismiss once", async () => {
  const owner = await join(), a = await join(), b = await join(), hostsOnly = await withFeature("hosts"), q = await withFeature("queues");
  const h = await start(owner);
  const e = await publish(owner, h.id, "Late Show");
  const ra = (await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe", note: "No exits" })).body.id as string;
  t.tick(1000); // newest first needs two times
  const rb = (await as(b)("POST", "/reports", { eventId: e.id, reason: "offensive" })).body.id as string;

  assert.equal((await as(a)("GET", "/galaxy/reports")).status, 404);
  assert.equal((await as(hostsOnly)("GET", "/galaxy/reports")).status, 404);
  for (const u of [a, hostsOnly]) {
    assert.equal((await as(u)("GET", `/galaxy/reports/${ra}`)).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/reports/${ra}/resolve`, {})).status, 404);
    assert.equal((await as(u)("POST", `/galaxy/reports/${ra}/dismiss`, {})).status, 404);
  }
  assert.equal((await as(q)("GET", "/galaxy/reports?status=nope")).status, 400);

  const open = (await as(q)("GET", "/galaxy/reports")).body.reports as any[];
  const mine = open.filter((r) => r.subject.id === e.id);
  assert.deepEqual(mine.map((r) => r.id), [rb, ra]); // newest first
  assert.equal(mine[1].subject.kind, "event");
  assert.equal(mine[1].subject.name, "Late Show");
  assert.equal(mine[1].subject.slug, e.slug);
  assert.equal(mine[1].openOnSubject, 2);
  assert.match(mine[1].reporter.phone, /^\+91 ••••••\d{4}$/);

  const one = await as(q)("GET", `/galaxy/reports/${ra}`);
  assert.equal(one.body.note, "No exits");
  assert.equal(one.body.decidedBy, null);
  assert.equal((await as(q)("GET", "/galaxy/reports/nope")).status, 404);
  assert.equal((await as(q)("GET", `/galaxy/reports/${crypto.randomUUID()}`)).status, 404);

  const done = await as(q)("POST", `/galaxy/reports/${ra}/resolve`, { note: "Host fixed the page" });
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "resolved");
  assert.equal(done.body.staffNote, "Host fixed the page");
  assert.equal(done.body.decidedBy.id, q.me.id);
  assert.equal(done.body.openOnSubject, 1);
  assert.equal((await as(q)("POST", `/galaxy/reports/${ra}/dismiss`, {})).status, 409);
  assert.equal((await as(q)("POST", `/galaxy/reports/${rb}/dismiss`, {})).body.status, "dismissed");
  assert.equal((await as(q)("POST", `/galaxy/reports/${rb}/resolve`, {})).status, 409);
  assert.equal((await as(q)("GET", "/galaxy/reports?status=resolved")).body.reports[0].id, ra);
  assert.equal((await as(q)("GET", "/galaxy/reports?status=dismissed")).body.reports[0].id, rb);
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.actorId, q.me.id))).length, 2);

  // Decided, the reporter may send a new one on the same event.
  assert.equal((await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" })).status, 201);
});

test("calendar file for a published event, 404 for a draft", async () => {
  const owner = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id, "Jokes, Laughs; More");
  const d = await draft(owner, h.id);
  const res = await t.app.request(`/public/events/${e.slug}/calendar.ics`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), `inline; filename="${e.slug}.ics"`);
  const body = await res.text();
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Orbit//EN\r\n"));
  assert.ok(body.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(body));
  assert.ok(body.includes(`UID:${e.id}@heyorbit.in\r\n`));
  assert.ok(body.includes("SUMMARY:Jokes\\, Laughs\\; More\r\n"));
  assert.ok(body.includes("LOCATION:Hall\\; Main\\, Road 1\\, Block 2\\, Jubilee Hills\\, Hyderabad\r\n"));
  assert.ok(body.includes(`URL:https://heyorbit.in/event/${e.slug}\r\n`));
  assert.match(body, /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z\r\n/);
  assert.equal((await t.app.request(`/public/events/${d.slug}/calendar.ics`)).status, 404);
  assert.equal((await t.app.request(`/public/events/nope-nope/calendar.ics`)).status, 404);
});

test("two reports at once: one made, the other answered with it", async () => {
  const owner = await join(), a = await join();
  const h = await start(owner);
  const [x, y] = await Promise.all([as(a)("POST", "/reports", { hostId: h.id, reason: "spam" }), as(a)("POST", "/reports", { hostId: h.id, reason: "scam" })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 201]);
  assert.equal(x.body.id, y.body.id);
});

test("staff never see or decide reports on a host they're on", async () => {
  const q = await withFeature("queues"), q2 = await withFeature("queues"), a = await join();
  const h = await start(q); // q owns this host
  const e = await publish(q, h.id, "My Own Show");
  const onHost = (await as(a)("POST", "/reports", { hostId: h.id, reason: "spam" })).body.id as string;
  const onEvent = (await as(a)("POST", "/reports", { eventId: e.id, reason: "unsafe" })).body.id as string;
  for (const id of [onHost, onEvent]) {
    assert.equal((await as(q)("POST", `/galaxy/reports/${id}/resolve`, {})).status, 403);
    assert.equal((await as(q)("POST", `/galaxy/reports/${id}/dismiss`, {})).body.error, "ownHost");
    assert.equal((await as(q)("GET", `/galaxy/reports/${id}`)).status, 404);
  }
  const seen = ((await as(q)("GET", "/galaxy/reports")).body.reports as any[]).map((r) => r.id);
  assert.ok(!seen.includes(onHost) && !seen.includes(onEvent));
  // Another staff member sees and decides them.
  const other = ((await as(q2)("GET", "/galaxy/reports")).body.reports as any[]).map((r) => r.id);
  assert.ok(other.includes(onHost) && other.includes(onEvent));
  assert.equal((await as(q2)("POST", `/galaxy/reports/${onHost}/resolve`, {})).status, 200);
});

test("calendar file: text with line breaks and controls, no end time, cancelled", async () => {
  const owner = await join();
  const h = await start(owner);
  const e = await publish(owner, h.id);
  await t.db.update(events).set({ title: "Line\r\nBreak\rOne\nTwo\u0007\u2028End", endsAt: null }).where(eq(events.id, e.id));
  const body = await (await t.app.request(`/public/events/${e.slug}/calendar.ics`)).text();
  assert.ok(body.includes("SUMMARY:Line\\nBreak\\nOne\\nTwoEnd\r\n"));
  assert.ok(!/\r(?!\n)|[^\r]\n/.test(body));
  const start_ = /DTSTART:(\d{8}T\d{6}Z)/.exec(body)![1]!, end = /DTEND:(\d{8}T\d{6}Z)/.exec(body)![1]!;
  const ms = (s: string) => Date.parse(s.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z"));
  assert.equal(ms(end) - ms(start_), 2 * HOUR);
  await t.db.update(events).set({ status: "cancelled" }).where(eq(events.id, e.id));
  assert.equal((await t.app.request(`/public/events/${e.slug}/calendar.ics`)).status, 404);
});
