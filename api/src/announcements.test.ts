import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, like } from "drizzle-orm";
import sharp from "sharp";
import { testApp } from "./testkit.ts";
import { deliveries, events, hosts, inboxItems, teamRoles, users } from "./db/schema.ts";
import { emailFor } from "./notification-emails.ts";
import { sendReminders } from "./announcements.ts";

// Host announcements and the automatic reminders (notifications build plan PR 10).

let t: Awaited<ReturnType<typeof testApp>>;
const HOUR = 3600_000, DAY = 24 * HOUR, IST = 5.5 * HOUR;
before(async () => {
  t = await testApp();
  // Start at the next noon in India, so a test's sends stay inside one India day and Thanks' 09:00-21:00 window.
  const noon = Math.floor((t.now() + IST) / DAY) * DAY - IST + 12 * HOUR;
  t.tick((noon > t.now() ? noon : noon + DAY) - t.now());
});
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(7_000_000 + ++n * 13).padStart(9, "0")}`;
const join = async () => {
  const p = phone();
  t.tick(1_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  const u = s.body as { access: string; me: { id: string } };
  // A phone on the people app, so pushes have somewhere to go.
  assert.equal((await t.call("PUT", "/me/push-device", { app: "orbit", platform: "ios", env: "sandbox", token: `tok-${n}` }, u.access)).status, 204);
  return u;
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
let hn = 0;
const publish = async (u: P, startsIn = 3 * DAY, endsIn = startsIn + 2 * HOUR) => {
  const h = (await as(u)("POST", "/hosts", { name: `Jam Circle ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  const e = (await as(u)("POST", `/hosts/${h.id}/events`, { title: "Open Mic Night" })).body as { id: string };
  const form = new FormData();
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#1D372A" } }).png().toBuffer();
  form.set("image", new File([png as BlobPart], "p.png", { type: "image/png" }));
  await t.app.request(`/events/${e.id}/poster`, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
  assert.equal((await as(u)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(startsIn), endsAt: iso(endsIn), place })).status, 200);
  const tier = (await as(u)("POST", `/events/${e.id}/tickets`, { name: "General", pricePaise: 0 })).body.id as string;
  assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 200);
  return { id: e.id, tier, host: h.id };
};
type E = Awaited<ReturnType<typeof publish>>;
const book = async (u: P, e: E) => {
  const r = await as(u)("POST", `/events/${e.id}/book`, { ticketTypeId: e.tier, quantity: 1 });
  assert.equal(r.status, 201);
  return r.body as { id: string };
};
const rows = (u: P, kind: string) => t.db.select().from(deliveries).where(and(eq(deliveries.userId, u.me.id), eq(deliveries.kind, kind)));
const inbox = (u: P, kind: string) => t.db.select().from(inboxItems).where(and(eq(inboxItems.userId, u.me.id), eq(inboxItems.kind, kind)));
const tick = () => sendReminders({ db: t.db, notify: t.notify, now: t.now });

test("an announcement reaches every ticket holder by push and inbox (its email row held); others hear nothing", async () => {
  const host = await join(), a = await join(), b = await join(), other = await join();
  const e = await publish(host);
  await book(a, e);
  await book(b, e);
  const r = await as(host)("POST", `/events/${e.id}/announcements`, { text: "  Doors open at 7, bring ID  " });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.text, "Doors open at 7, bring ID");
  assert.equal(r.body.audience, "everyone");
  assert.equal(r.body.reached, 2);
  for (const u of [a, b]) {
    const [item] = await inbox(u, "hostAnnouncement");
    assert.equal(item!.text, "Doors open at 7, bring ID");
    assert.match(item!.fromName, /^Jam Circle/);
    const got = await rows(u, "hostAnnouncement");
    assert.deepEqual(got.map((d) => d.channel).sort(), ["email", "push"]);
    assert.equal(got.find((d) => d.channel === "push")!.status, "queued");
    assert.ok(got.every((d) => d.dedupeKey === `hostAnnouncement:${u.me.id}:${r.body.id}`));
  }
  assert.equal((await inbox(other, "hostAnnouncement")).length, 0);
  assert.equal((await inbox(host, "hostAnnouncement")).length, 0);

  const list = await as(host)("GET", `/events/${e.id}/announcements`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].reached, 2);
  assert.equal(list.body.items[0].author, "Riya Kapoor");
  assert.equal(list.body.left, 2);
  assert.deepEqual(list.body.autoMessages, { tomorrow: true, startingSoon: true, thanks: true });
});

test("notCheckedIn is kept and reaches holders (no admits are recorded yet); bad text and audience refused", async () => {
  const host = await join(), a = await join();
  const e = await publish(host);
  await book(a, e);
  const r = await as(host)("POST", `/events/${e.id}/announcements`, { text: "Not here yet? Gate 2", audience: "notCheckedIn" });
  assert.equal(r.status, 201);
  assert.equal(r.body.audience, "notCheckedIn");
  assert.equal((await inbox(a, "hostAnnouncement")).length, 1);
  for (const body of [{ text: "   " }, { text: "x".repeat(501) }, { text: "hi", audience: "vips" }])
    assert.equal((await as(host)("POST", `/events/${e.id}/announcements`, body)).status, 400);
});

test("a fourth announcement in a day is refused; the next day it goes", async () => {
  const host = await join(), a = await join();
  const e = await publish(host);
  await book(a, e);
  for (let i = 1; i <= 3; i++) assert.equal((await as(host)("POST", `/events/${e.id}/announcements`, { text: `Note ${i}` })).status, 201);
  const fourth = await as(host)("POST", `/events/${e.id}/announcements`, { text: "Note 4" });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.error, "tooMany");
  assert.equal((await inbox(a, "hostAnnouncement")).length, 3);
  assert.equal((await as(host)("GET", `/events/${e.id}/announcements`)).body.left, 0);
  t.tick(DAY);
  assert.equal((await as(host)("POST", `/events/${e.id}/announcements`, { text: "Note 4" })).status, 201);
});

test("off the team: 404 for announcing, reading and switching; a holder can't announce", async () => {
  const host = await join(), a = await join(), stranger = await join();
  const e = await publish(host);
  await book(a, e);
  for (const u of [a, stranger]) {
    assert.equal((await as(u)("POST", `/events/${e.id}/announcements`, { text: "hi" })).status, 404);
    assert.equal((await as(u)("GET", `/events/${e.id}/announcements`)).status, 404);
    assert.equal((await as(u)("PUT", `/events/${e.id}/auto-messages`, { thanks: false })).status, 404);
  }
  assert.equal((await t.call("GET", `/events/${e.id}/announcements`)).status, 401);
});

test("reminders: Tomorrow, Starting soon and Thanks each once, however many ticks", async () => {
  const host = await join(), a = await join();
  const e = await publish(host, 22 * HOUR, 23 * HOUR);
  await book(a, e);
  await tick();
  await tick();
  assert.equal((await inbox(a, "eventTomorrow")).length, 1);
  assert.match((await inbox(a, "eventTomorrow"))[0]!.text, /^Open Mic Night starts tomorrow at \d{1,2}:\d{2} (am|pm)\.$/);
  assert.equal((await rows(a, "eventTomorrow")).filter((d) => d.channel === "push").length, 1);
  assert.equal((await inbox(a, "eventStartingSoon")).length, 0);
  t.tick(21.5 * HOUR); // half an hour before the start
  await tick();
  await tick();
  assert.equal((await inbox(a, "eventStartingSoon")).length, 1);
  assert.equal((await inbox(a, "eventStartingSoon"))[0]!.text, "Open Mic Night starts in an hour.");
  assert.equal((await rows(a, "eventStartingSoon")).filter((d) => d.channel === "push").length, 1);
  t.tick(2 * HOUR); // after the end; still inside 09:00-21:00
  const h = ((t.now() + IST) % DAY) / HOUR;
  if (h < 9 || h >= 21) t.tick(((9 - h + 24) % 24) * HOUR);
  await tick();
  await tick();
  assert.equal((await inbox(a, "thanksForComing")).length, 1);
  assert.match((await inbox(a, "thanksForComing"))[0]!.text, /^Thanks for coming to Open Mic Night\./);
  assert.equal((await inbox(a, "eventTomorrow")).length, 1);
  assert.equal((await t.db.select().from(deliveries).where(like(deliveries.dedupeKey, `%:${e.id}`))).length >= 3, true);
});

test("a switched-off reminder sends nothing; the others still go", async () => {
  const host = await join(), a = await join();
  const e = await publish(host, 22 * HOUR, 23 * HOUR);
  await book(a, e);
  const put = await as(host)("PUT", `/events/${e.id}/auto-messages`, { tomorrow: false });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { tomorrow: false, startingSoon: true, thanks: true });
  await tick();
  assert.equal((await inbox(a, "eventTomorrow")).length, 0);
  assert.equal((await rows(a, "eventTomorrow")).length, 0);
  t.tick(21.5 * HOUR);
  await tick();
  assert.equal((await inbox(a, "eventStartingSoon")).length, 1);
});

test("six sends at once make exactly three", async () => {
  const host = await join(), a = await join();
  const e = await publish(host);
  await book(a, e);
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => as(host)("POST", `/events/${e.id}/announcements`, { text: `N${i}` })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 201, 201, 429, 429, 429]);
  assert.equal((await inbox(a, "hostAnnouncement")).length, 3);
});

test("a holder's booking on the same event during an announcement doesn't deadlock", async () => {
  const host = await join(), a = await join();
  const e = await publish(host);
  await book(a, e);
  let ann: ReturnType<ReturnType<typeof as>> | undefined;
  // The booking's order (bookings.ts mine()): the person first, then the event row shared.
  await t.db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, a.me.id)).for("update");
    ann = as(host)("POST", `/events/${e.id}/announcements`, { text: "Doors at 7" });
    await new Promise((r) => setTimeout(r, 300));
    await tx.select({ id: events.id }).from(events).where(eq(events.id, e.id)).for("share");
  });
  assert.equal((await ann!).status, 201);
  assert.equal((await inbox(a, "hostAnnouncement")).length, 1);
});

test("Crew reads but can't send or switch", async () => {
  const host = await join(), a = await join(), crew = await join();
  const e = await publish(host);
  await book(a, e);
  const at = new Date(t.now());
  await t.db.insert(teamRoles).values({ hostId: e.host, role: "crew", contact: "crew@example.com", userId: crew.me.id, addedBy: host.me.id, addedAt: at, acceptedAt: at, startedAt: at });
  assert.equal((await as(crew)("GET", `/events/${e.id}/announcements`)).status, 200);
  assert.equal((await as(crew)("POST", `/events/${e.id}/announcements`, { text: "hi" })).status, 404);
  assert.equal((await as(crew)("PUT", `/events/${e.id}/auto-messages`, { thanks: false })).status, 404);
  assert.equal((await inbox(a, "hostAnnouncement")).length, 0);
});

test("a draft or cancelled event, or one ended over a week ago, can't be announced on", async () => {
  const host = await join(), a = await join();
  const h = (await as(host)("POST", "/hosts", { name: `Jam Circle ${++hn}`, kind: "comedy-group", city: "Hyderabad" })).body as { id: string };
  const draft = (await as(host)("POST", `/hosts/${h.id}/events`, { title: "Open Mic Night" })).body as { id: string };
  assert.equal((await as(host)("POST", `/events/${draft.id}/announcements`, { text: "hi" })).body.error, "notNow");
  const gone = await publish(host);
  await book(a, gone);
  assert.equal((await as(host)("POST", `/events/${gone.id}/cancel`, { reason: "Venue flooded" })).status, 200);
  const r = await as(host)("POST", `/events/${gone.id}/announcements`, { text: "hi" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "notNow");
  const old = await publish(host, HOUR, 2 * HOUR);
  t.tick(2 * HOUR + 6 * DAY);
  assert.equal((await as(host)("POST", `/events/${old.id}/announcements`, { text: "Thanks all" })).status, 201);
  t.tick(DAY + 1);
  const late = await as(host)("POST", `/events/${old.id}/announcements`, { text: "Thanks all" });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "ended");
  assert.equal((await inbox(a, "hostAnnouncement")).length, 0);
});

test("a cancelled booking hears nothing; a suspended host's event sends no reminders", async () => {
  const host = await join(), a = await join(), b = await join();
  const e = await publish(host, 22 * HOUR, 23 * HOUR);
  const ticket = await book(a, e);
  await book(b, e);
  assert.equal((await as(a)("POST", `/me/tickets/${ticket.id}/cancel`)).status, 200);
  const r = await as(host)("POST", `/events/${e.id}/announcements`, { text: "Doors at 7" });
  assert.equal(r.body.reached, 1);
  await tick();
  assert.equal((await inbox(a, "hostAnnouncement")).length, 0);
  assert.equal((await inbox(a, "eventTomorrow")).length, 0);
  assert.equal((await inbox(b, "eventTomorrow")).length, 1);

  const c = await join();
  const quiet = await publish(host, 22 * HOUR, 23 * HOUR);
  await book(c, quiet);
  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, quiet.host));
  await tick();
  assert.equal((await inbox(c, "eventTomorrow")).length, 0);
});

test("a start moved inside the window reminds once", async () => {
  const host = await join(), a = await join();
  const e = await publish(host, 22 * HOUR, 23 * HOUR);
  await book(a, e);
  await tick();
  for (let i = 1; i <= 3; i++) {
    assert.equal((await as(host)("PATCH", `/events/${e.id}`, { startsAt: iso(22 * HOUR + i * 60_000) })).status, 200);
    await tick();
  }
  assert.equal((await inbox(a, "eventTomorrow")).length, 1);
  assert.equal((await rows(a, "eventTomorrow")).filter((d) => d.channel === "push").length, 1);
});

test("an announcement's email says why it came, not that it can't be switched off", () => {
  const m = emailFor("hostAnnouncement", { hostName: "Jam Circle", title: "Open Mic Night", text: "Doors at 7" });
  assert.match(m.text, /you have a ticket for this event/);
  assert.doesNotMatch(m.text, /can’t be switched off/);
});
