import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { TeamEvent, TicketType } from "@orbit/contract";
import { testApp } from "../testkit.ts";
import { events, hosts, teamRoles } from "../db/schema.ts";

// Discover slice 1: publish and cancel, ticket types, the poster, and the public reads.

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(6_000_000 + ++n * 11).padStart(9, "0")}`;
const HOUR = 3600_000, DAY = 24 * HOUR;

const join = async (p = phone()) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return { p, ...s.body } as { p: string; access: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
let hn = 0;
const start = async (u: P, name = `Punchline Collective ${++hn}`) => (await as(u)("POST", "/hosts", { name, kind: "comedy-group", city: "Hyderabad" })).body as { id: string; slug: string };
const draft = async (u: P, hostId: string, title = "Open Mic Night") => (await as(u)("POST", `/hosts/${hostId}/events`, { title })).body as { id: string; slug: string };
const place = { venue: "Hall", address: "Road 1", area: "Jubilee Hills", city: "Hyderabad", lat: 17.4, lng: 78.4 };
const iso = (ms: number) => new Date(t.now() + ms).toISOString();
const png = (w: number, h: number, color = "#1D372A") => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const upload = async (u: P, path: string, bytes: Uint8Array) => {
  const form = new FormData();
  form.set("image", new File([bytes as BlobPart], "p.png", { type: "image/png" }));
  const res = await t.app.request(path, { method: "PUT", headers: { authorization: `Bearer ${u.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
  return { status: res.status, body: (await res.json()) as any };
};
const poster = async (u: P, id: string) => assert.equal((await upload(u, `/events/${id}/poster`, await png(900, 1200))).status, 200);
const tier = (u: P, id: string, body: object = { name: "General", pricePaise: 0 }) => as(u)("POST", `/events/${id}/tickets`, body);

// A published event: poster, a place, a time, a ticket type.
const publish = async (u: P, hostId: string, o: { title?: string; place?: object | null; startsIn?: number; endsIn?: number; price?: number; category?: string; online?: boolean } = {}) => {
  const e = await draft(u, hostId, o.title);
  await poster(u, e.id);
  const set = await as(u)("PATCH", `/events/${e.id}`, {
    category: o.category ?? "comedy", startsAt: iso(o.startsIn ?? DAY), endsAt: iso(o.endsIn ?? DAY + 2 * HOUR),
    ...(o.place === null ? { online: true, onlineLink: "https://meet.example.com/secret-room" } : { place: o.place ?? place }),
    ...(o.online ? { online: true, onlineLink: "https://meet.example.com/secret-room" } : {}),
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await tier(u, e.id, { name: "General", pricePaise: o.price ?? 0 })).status, 201);
  const p = await as(u)("POST", `/events/${e.id}/publish`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return e;
};
// Lists are global, so the list tests start from none.
const clear = () => t.db.delete(events);
const pub = (path: string) => t.call("GET", path);
const slugsOf = (r: { body: { near?: any[]; elsewhere?: any[]; events?: any[] } }) => [...(r.body.near ?? []), ...(r.body.elsewhere ?? []), ...(r.body.events ?? [])].map((e) => e.slug);

test("publish lists what's missing, then succeeds once and only for a draft", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const no = await as(a)("POST", `/events/${e.id}/publish`);
  assert.equal(no.status, 409);
  assert.equal(no.body.error, "notReady");
  assert.deepEqual(no.body.missing, ["poster", "when", "where", "category", "tickets"]);
  assert.equal((await as(out)("POST", `/events/${e.id}/publish`)).status, 404);

  await poster(a, e.id);
  await as(a)("PATCH", `/events/${e.id}`, { category: "comedy", startsAt: iso(-2 * HOUR), endsAt: iso(-HOUR), online: true });
  await tier(a, e.id);
  // An end in the past is no "when"; online with no link is no "where".
  assert.deepEqual((await as(a)("POST", `/events/${e.id}/publish`)).body.missing, ["when", "where"]);
  await as(a)("PATCH", `/events/${e.id}`, { startsAt: iso(DAY), endsAt: iso(DAY + HOUR), onlineLink: "https://meet.example.com/x" });
  const ok = await as(a)("POST", `/events/${e.id}/publish`);
  assert.equal(ok.status, 200);
  const p = TeamEvent.parse(ok.body);
  assert.equal(p.status, "published");
  assert.ok(p.publishedAt);
  assert.ok(p.poster && p.tone);
  assert.equal((await as(a)("POST", `/events/${e.id}/publish`)).status, 409);
});

test("cancel needs a reason and a published event", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const d = await draft(a, h.id);
  assert.equal((await as(a)("POST", `/events/${d.id}/cancel`, { reason: "No" })).status, 409);
  const e = await publish(a, h.id);
  assert.equal((await as(a)("POST", `/events/${e.id}/cancel`, {})).status, 400);
  assert.equal((await as(out)("POST", `/events/${e.id}/cancel`, { reason: "Rain" })).status, 404);
  const r = await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Rain" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "cancelled");
  assert.equal(r.body.cancelReason, "Rain");
  assert.ok(r.body.cancelledAt);
  assert.equal((await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Rain" })).status, 409);
  assert.equal((await tier(a, e.id)).status, 409); // a cancelled event can't change
});

test("ticket types: CRUD, order, the 20 cap, admin only, locked after the end", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const one = await tier(a, e.id, { name: "Early bird", pricePaise: 29900, quantity: 10 });
  assert.equal(one.status, 201);
  const two = TicketType.parse((await tier(a, e.id, { name: "Free", pricePaise: 0 })).body);
  assert.equal(two.sortOrder, 1);
  assert.equal(two.perPersonLimit, 10);
  assert.deepEqual((await as(a)("GET", `/events/${e.id}/tickets`)).body.map((x: any) => x.name), ["Early bird", "Free"]);

  const up = await as(a)("PATCH", `/events/${e.id}/tickets/${one.body.id}`, { quantity: 20, note: "Cover" });
  assert.equal(up.body.quantity, 20);
  assert.equal(up.body.name, "Early bird");
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${one.body.id}`, { salesStartAt: iso(DAY) })).status, 200);
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${one.body.id}`, { salesEndAt: iso(HOUR) })).status, 400); // before the stored start
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${one.body.id}`, {})).status, 400);

  for (const m of [["GET", ""], ["POST", ""], ["PATCH", `/${one.body.id}`], ["DELETE", `/${one.body.id}`]] as const)
    assert.equal((await as(out)(m[0], `/events/${e.id}/tickets${m[1]}`, m[0] === "GET" || m[0] === "DELETE" ? undefined : { name: "x", pricePaise: 0 })).status, 404, m[0]);
  const other = await draft(a, h.id, "Other");
  assert.equal((await as(a)("PATCH", `/events/${other.id}/tickets/${one.body.id}`, { quantity: 5 })).status, 404);

  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${two.id}`)).status, 204);
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${two.id}`)).status, 404);
  for (let i = 0; i < 19; i++) assert.equal((await tier(a, e.id, { name: `T${i}`, pricePaise: 0 })).status, 201);
  const over = await tier(a, e.id);
  assert.equal(over.status, 409);
  assert.equal(over.body.error, "tooManyTickets");

  // Ended: locked.
  await t.db.update(events).set({ status: "published", startsAt: new Date(t.now() - 3 * HOUR), endsAt: new Date(t.now() - HOUR) }).where(eq(events.id, e.id));
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${one.body.id}`)).body.error, "ended");
  assert.equal((await as(a)("PATCH", `/events/${e.id}/tickets/${one.body.id}`, { quantity: 5 })).status, 409);
});

test("poster: 3:4 kept with a tone, other shapes refused, the old file deleted; the 4:3 is optional", async () => {
  const a = await join(), out = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  const bad = await upload(a, `/events/${e.id}/poster`, await png(1200, 900));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "wrongShape");
  assert.equal((await upload(a, `/events/${e.id}/poster`, new Uint8Array([1, 2, 3]))).body.error, "notImage");
  assert.equal((await upload(out, `/events/${e.id}/poster`, await png(900, 1200))).status, 404);
  assert.equal(t.media.files.keys().filter((k) => k.startsWith(`events/${e.id}/`)).length, 0);

  const first = await upload(a, `/events/${e.id}/poster`, await png(900, 1200, "#ff0000"));
  assert.equal(first.status, 200);
  assert.match(first.body.tone, /^#[0-9a-f]{6}$/);
  assert.ok(first.body.tone.slice(1, 3) > "c0" && first.body.tone.slice(3, 5) < "40"); // red
  assert.equal(t.media.files.keys().filter((k) => k.startsWith(`events/${e.id}/`)).length, 1);
  const second = await upload(a, `/events/${e.id}/poster`, await png(900, 1200, "#00ff00"));
  assert.equal(t.media.files.keys().filter((k) => k.startsWith(`events/${e.id}/`)).length, 1);
  assert.notEqual(second.body.poster, first.body.poster);
  assert.equal((await t.app.request(new URL(second.body.poster).pathname)).status, 200);
  assert.equal((await t.app.request(new URL(first.body.poster).pathname)).status, 404);

  const wide = await upload(a, `/events/${e.id}/wide`, await png(1200, 900, "#0000ff"));
  assert.equal(wide.status, 200);
  assert.match(wide.body.wideEdge, /^#[0-9a-f]{6}$/);
  assert.notEqual(wide.body.tone, second.body.tone);
  assert.equal((await as(a)("GET", `/events/${e.id}`)).body.tone, wide.body.tone);
  assert.equal((await upload(a, `/events/${e.id}/wide`, await png(900, 1200))).body.error, "wrongShape");
  const del = await as(a)("DELETE", `/events/${e.id}/wide`);
  assert.equal(del.body.tone, second.body.tone);
  const back = (await as(a)("GET", `/events/${e.id}`)).body;
  assert.equal(back.wide, null);
  assert.equal(back.wideEdge, null);
  assert.equal(t.media.files.keys().filter((k) => k.startsWith(`events/${e.id}/`)).length, 1);
});

test("public read: who sees what by link, and by lists", async () => {
  await clear();
  const a = await join();
  const h = await start(a);
  const pubd = await publish(a, h.id, { title: "Public One" });
  const dr = await draft(a, h.id, "Just A Draft");
  const link = await publish(a, h.id, { title: "Link Only" });
  await as(a)("PATCH", `/events/${link.id}`, { visibility: "link" });
  const cancelled = await publish(a, h.id, { title: "Cancelled One" });
  await as(a)("POST", `/events/${cancelled.id}/cancel`, { reason: "Rain" });
  const ended = await publish(a, h.id, { title: "Ended One" });
  await t.db.update(events).set({ startsAt: new Date(t.now() - 3 * HOUR), endsAt: new Date(t.now() - HOUR) }).where(eq(events.id, ended.id));
  const online = await publish(a, h.id, { title: "Secret Online", place: null });

  assert.equal((await pub(`/public/events/${dr.slug}`)).status, 404);
  assert.equal((await pub(`/public/events/nope`)).status, 404);
  for (const e of [pubd, link, cancelled, ended]) assert.equal((await pub(`/public/events/${e.slug}`)).status, 200, e.slug);
  const got = (await pub(`/public/events/${pubd.slug}`)).body;
  assert.equal(got.slug, pubd.slug);
  assert.equal(got.host.id, h.id);
  assert.equal(got.tiers.length, 1);
  assert.equal(got.tiers[0].left, got.tiers[0].quantity);
  assert.equal(got.pricePaise, 0);
  assert.equal(got.status, "published");
  assert.equal((await pub(`/public/events/${cancelled.slug}`)).body.status, "cancelled");

  const listed = slugsOf(await pub("/public/discover"));
  assert.deepEqual(listed.sort(), [pubd.slug, online.slug].sort());
  assert.deepEqual(slugsOf(await pub("/public/search")).sort(), [pubd.slug, online.slug].sort());

  // Old links still open.
  await as(a)("PATCH", `/events/${pubd.id}`, { slug: "public-one-renamed" });
  const old = await pub(`/public/events/${pubd.slug}`);
  assert.equal(old.status, 200);
  assert.equal(old.body.slug, "public-one-renamed");

  // The online link never leaves the team's read, nor the place id.
  for (const path of ["/public/discover", "/public/search", `/public/events/${online.slug}`, `/public/hosts/${h.slug}/events`]) {
    const text = JSON.stringify((await pub(path)).body);
    assert.ok(!text.includes("secret-room") && !text.includes("onlineLink") && !text.includes("placeId"), path);
  }

  // A private host's events open by link and are never listed; a paused host's are 404 and gone from lists.
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, h.id));
  assert.equal((await pub(`/public/events/${pubd.slug}`)).status, 200);
  assert.equal((await pub(`/public/events/${pubd.slug}`)).body.visibility, "link");
  assert.deepEqual(slugsOf(await pub("/public/discover")), []);
  assert.equal((await pub(`/public/hosts/${h.slug}/events`)).status, 404);
  await t.db.update(hosts).set({ visibility: "public", status: "paused" }).where(eq(hosts.id, h.id));
  assert.equal((await pub(`/public/events/${pubd.slug}`)).status, 404);
  assert.equal((await pub(`/public/events/${cancelled.slug}`)).status, 404);
  assert.deepEqual(slugsOf(await pub("/public/discover")), []);
});

test("discover: near within 25 km, the city fallback, online-only, and elsewhere", async () => {
  await clear();
  const a = await join();
  const h = await start(a);
  const at10 = await publish(a, h.id, { title: "Ten Away", place: { ...place, lat: 17.49, lng: 78.4 } }); // ~10 km north of 17.4
  const at40 = await publish(a, h.id, { title: "Forty Away", place: { ...place, lat: 17.76, lng: 78.4 } }); // ~40 km
  const noPoint = await publish(a, h.id, { title: "No Coordinates", place: { ...place, lat: 17.4, lng: 78.4 } });
  await t.db.update(events).set({ lat: null, lng: null }).where(eq(events.id, noPoint.id));
  const other = await publish(a, h.id, { title: "Other City", place: { ...place, city: "Mumbai", lat: 19.07, lng: 72.87 } });
  await t.db.update(events).set({ lat: null, lng: null }).where(eq(events.id, other.id));
  const online = await publish(a, h.id, { title: "Online Only", place: null });
  const also = await publish(a, h.id, { title: "Also Online", online: true, place: { ...place, lat: 28.6, lng: 77.2, city: "Delhi" } });

  const r = await pub("/public/discover?lat=17.4&lng=78.4&city=Hyderabad");
  assert.equal(r.status, 200);
  const near = r.body.near.map((e: any) => e.slug);
  assert.deepEqual(near.sort(), [at10.slug, noPoint.slug, online.slug].sort());
  assert.deepEqual(r.body.elsewhere.map((e: any) => e.slug).sort(), [at40.slug, other.slug, also.slug].sort());
  const km = r.body.near.find((e: any) => e.slug === at10.slug).distanceKm;
  assert.ok(km > 9 && km < 11, String(km));
  assert.equal(r.body.near.find((e: any) => e.slug === noPoint.slug).distanceKm, null);

  const none = await pub("/public/discover");
  assert.deepEqual(none.body.near, []);
  assert.equal(none.body.elsewhere.length, 6);
  assert.equal(none.body.elsewhere[0].distanceKm, null);
  // soonest first
  const starts = none.body.elsewhere.map((e: any) => e.startsAt);
  assert.deepEqual(starts, [...starts].sort());

  assert.equal((await pub("/public/discover?lat=17.4")).status, 400);
  assert.equal((await pub("/public/discover?lat=0&lng=0")).status, 400);
  assert.equal((await pub("/public/discover?lat=abc&lng=78")).status, 400);
});

// The clock can move both ways, so a test that needs a fixed date sets it before anyone signs in.
const THU = Date.parse("2026-12-03T12:00:00+05:30"), SAT = Date.parse("2026-12-05T00:00:00+05:30"), MON = Date.parse("2026-12-07T00:00:00+05:30");
const anchor = (ms: number) => t.tick(ms - t.now());
const setTimes = (id: string, from: number, to: number) => t.db.update(events).set({ startsAt: new Date(from), endsAt: new Date(to) }).where(eq(events.id, id));
const idsOf = (r: { body: any }, key = "events") => (r.body[key] as any[]).map((x) => x.slug ?? x.id);

test("search: words across title, host, area and category; the description is not searched; _ is literal; Free", async () => {
  await clear();
  const a = await join();
  const h = await start(a, "Zebra Laughs Club");
  const jam = await publish(a, h.id, { title: "Sunday Acoustic", category: "jams", place: { ...place, area: "Banjara Hills" } });
  const paid = await publish(a, h.id, { title: "Paid Night", price: 50000 });
  await as(a)("PATCH", `/events/${paid.id}`, { about: "Bring a kazoo" });
  const mix = await publish(a, h.id, { title: "Mixed Bag" });
  await tier(a, mix.id, { name: "VIP", pricePaise: 90000 });
  const ab = await publish(a, h.id, { title: "A_B" });
  const axb = await publish(a, h.id, { title: "AxB" });
  const s = async (q: string) => slugsOf(await pub(`/public/search?${q}`));
  assert.deepEqual(await s("q=acoustic"), [jam.slug]); // title
  assert.deepEqual((await s("q=zebra")).sort(), [jam.slug, paid.slug, mix.slug, ab.slug, axb.slug].sort()); // host name
  assert.deepEqual(await s("q=banjara"), [jam.slug]); // area
  assert.deepEqual(await s("q=jams"), [jam.slug]); // category label
  assert.deepEqual(await s("q=ACOUSTIC+zebra+banjara"), [jam.slug]); // every word, any field, any case
  assert.deepEqual(await s("q=acoustic+paid"), []);
  assert.deepEqual(await s("q=%25"), []); // a % is only itself
  assert.deepEqual(await s("q=kazoo"), []); // the description isn't searched
  assert.deepEqual(await s("q=a_"), [ab.slug]); // and _ is no wildcard: not "AxB"
  assert.deepEqual((await pub("/public/search?q=zebra")).body.hosts.map((x: any) => x.id), [h.id]);
  assert.ok((await pub("/public/search?q=hyderabad")).body.hosts.some((x: any) => x.id === h.id)); // by city

  // Free: it has tiers and every one is price 0. The mixed one isn't; the paid one isn't.
  const free = await s("free=1");
  assert.ok(free.includes(jam.slug) && free.includes(ab.slug));
  assert.ok(!free.includes(paid.slug) && !free.includes(mix.slug));
  assert.deepEqual(await s("category=jams"), [jam.slug]);

  for (const bad of ["when=never", "free=maybe", "category=nope", `q=${"x".repeat(101)}`, "lat=17", "q=a%00b", "city=a%00b"]) assert.equal((await pub(`/public/search?${bad}`)).status, 400, bad);
  assert.equal((await pub("/public/discover?city=a%00b")).status, 400);
});

test("search never returns what the public can't see, and no host that isn't public and live", async () => {
  await clear();
  const a = await join();
  const h1 = await start(a, "Quokka Collective"), h2 = await start(a, "Quokka Private Club"), h3 = await start(a, "Quokka Paused Club");
  const open = await publish(a, h1.id, { title: "Quokka Public" });
  await draft(a, h1.id, "Quokka Draft");
  const link = await publish(a, h1.id, { title: "Quokka Link" });
  await as(a)("PATCH", `/events/${link.id}`, { visibility: "link" });
  await publish(a, h2.id, { title: "Quokka Private Show" });
  await publish(a, h3.id, { title: "Quokka Paused Show" });
  await t.db.update(hosts).set({ visibility: "private" }).where(eq(hosts.id, h2.id));
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h3.id));
  const r = await pub("/public/search?q=quokka");
  assert.deepEqual(idsOf(r), [open.slug]);
  assert.deepEqual(idsOf(r, "hosts"), [h1.slug]);
});

test("When chips use [startsAt, endsAt): overlap, the edges, and running events stay upcoming", async () => {
  await clear();
  anchor(THU);
  const a = await join();
  const h = await start(a);
  const long = await publish(a, h.id, { title: "Marathon Stay" });
  await setTimes(long.id, SAT - 4 * HOUR, SAT + DAY + 20 * HOUR); // Fri 8 pm to Sun 8 pm
  const endsAtStart = await publish(a, h.id, { title: "Ends At Saturday" });
  await setTimes(endsAtStart.id, SAT - 2 * HOUR, SAT); // ends exactly as the weekend starts: out
  const startsAtEnd = await publish(a, h.id, { title: "Starts At Monday" });
  await setTimes(startsAtEnd.id, MON, MON + 2 * HOUR); // starts exactly as it ends: out
  const inside = await publish(a, h.id, { title: "Saturday Morning" });
  await setTimes(inside.id, SAT + 10 * HOUR, SAT + 12 * HOUR);
  const running = await publish(a, h.id, { title: "Already Running" });
  await setTimes(running.id, t.now() - HOUR, t.now() + 5 * HOUR); // started, not ended: still upcoming
  const when = async (w: string) => (await slugsOf(await pub(`/public/search?when=${w}`))).sort();
  assert.deepEqual(await when("weekend"), [long.slug, inside.slug].sort());
  assert.deepEqual(await when("today"), [running.slug]);
  assert.deepEqual(await when("week"), [long.slug, endsAtStart.slug, startsAtEnd.slug, inside.slug, running.slug].sort());

  // One clock: a started event is in discover and on its host's upcoming list until its end.
  assert.ok(slugsOf(await pub("/public/discover")).includes(running.slug));
  assert.ok((await pub(`/public/hosts/${h.slug}/events`)).body.upcoming.some((e: any) => e.slug === running.slug));

  // Saturday 9 pm: Marathon is mid-event, the rest of Saturday is over.
  anchor(SAT + 21 * HOUR);
  assert.deepEqual(await when("weekend"), [long.slug]);
  assert.deepEqual(await when("today"), [long.slug]);
  assert.ok(!slugsOf(await pub("/public/discover")).includes(inside.slug)); // ended
});

test("discover east-west distance and a city match in any case", async () => {
  await clear();
  const a = await join();
  const h = await start(a);
  const e24 = await publish(a, h.id, { title: "East 24", place: { ...place, lat: 17.4, lng: 78.63 } }); // ~24.4 km
  const e26 = await publish(a, h.id, { title: "East 26", place: { ...place, lat: 17.4, lng: 78.65 } }); // ~26.5 km
  const bare = await publish(a, h.id, { title: "Bare City" });
  await t.db.update(events).set({ lat: null, lng: null }).where(eq(events.id, bare.id));
  const r = await pub("/public/discover?lat=17.4&lng=78.4&city=HYDERABAD");
  assert.deepEqual(idsOf(r, "near").sort(), [e24.slug, bare.slug].sort());
  assert.deepEqual(idsOf(r, "elsewhere"), [e26.slug]);
  assert.ok(Math.abs(r.body.near.find((e: any) => e.slug === e24.slug).distanceKm - 24.4) < 0.3);
  assert.deepEqual(idsOf(await pub("/public/discover?city=hyderabad"), "near").sort(), [e24.slug, e26.slug, bare.slug].sort());
});

test("a published event keeps what publishing needed; its last ticket type stays; an ended one can't be cancelled", async () => {
  const a = await join();
  const h = await start(a);
  const e = await publish(a, h.id);
  for (const body of [{ startsAt: null }, { endsAt: null }, { category: null }, { place: null }]) {
    const r = await as(a)("PATCH", `/events/${e.id}`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, "needed");
  }
  // A place may be swapped, or dropped once it's online with a link.
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { place: { ...place, venue: "Hall 2", address: "Road 2" } })).status, 200);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { online: true, onlineLink: "https://meet.example.com/x", place: null })).status, 200);
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { onlineLink: null })).body.error, "needed");
  assert.equal((await as(a)("PATCH", `/events/${e.id}`, { online: false })).body.error, "needed");
  // A draft may still clear them.
  const d = await draft(a, h.id);
  await as(a)("PATCH", `/events/${d.id}`, { category: "comedy" });
  assert.equal((await as(a)("PATCH", `/events/${d.id}`, { category: null })).status, 200);

  const [only] = (await as(a)("GET", `/events/${e.id}/tickets`)).body;
  const last = await as(a)("DELETE", `/events/${e.id}/tickets/${only.id}`);
  assert.equal(last.status, 409);
  assert.equal(last.body.error, "lastTicket");
  const second = await tier(a, e.id, { name: "Second", pricePaise: 0 });
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${only.id}`)).status, 204);
  assert.equal((await as(a)("DELETE", `/events/${e.id}/tickets/${second.body.id}`)).status, 409);

  await t.db.update(events).set({ startsAt: new Date(t.now() - 3 * HOUR), endsAt: new Date(t.now() - HOUR) }).where(eq(events.id, e.id));
  const c = await as(a)("POST", `/events/${e.id}/cancel`, { reason: "Too late" });
  assert.equal(c.status, 409);
  assert.equal(c.body.error, "ended");
});

test("the host page's past list leaves out cancelled and link-only; a paused host's page is 404", async () => {
  const a = await join();
  const h = await start(a);
  const shown = await publish(a, h.id, { title: "Shown Past" });
  const hidden = await publish(a, h.id, { title: "Link Past" });
  await as(a)("PATCH", `/events/${hidden.id}`, { visibility: "link" });
  const called = await publish(a, h.id, { title: "Cancelled Past" });
  await as(a)("POST", `/events/${called.id}/cancel`, { reason: "Rain" });
  for (const e of [shown, hidden, called]) await t.db.update(events).set({ startsAt: new Date(t.now() - 3 * HOUR), endsAt: new Date(t.now() - HOUR) }).where(eq(events.id, e.id));
  const r = await pub(`/public/hosts/${h.slug}/events`);
  assert.deepEqual(idsOf(r, "past"), [shown.slug]);
  await t.db.update(hosts).set({ status: "paused" }).where(eq(hosts.id, h.id));
  assert.equal((await pub(`/public/hosts/${h.slug}/events`)).status, 404);
});

test("odd text in a link is a 404, never a 500", async () => {
  const a = await join();
  const h = await start(a);
  for (const path of ["/public/events/a%00b", "/public/events/UPPER", `/public/hosts/a%00b/events`, "/public/hosts/a%00b"]) assert.equal((await pub(path)).status, 404, path);
  assert.equal((await pub(`/public/hosts/${h.slug}`)).status, 200);
});

test("refusals: a non-Admin and a removed seat get 404, a suspended host hostClosed, and uploads are checked", async () => {
  const a = await join(), crew = await join(), gone = await join();
  const h = await start(a);
  const e = await draft(a, h.id);
  await t.db.insert(teamRoles).values({ hostId: h.id, role: "crew", contact: `+91${crew.p}`, userId: crew.me.id, addedBy: a.me.id, addedAt: new Date(t.now()), acceptedAt: new Date(t.now()), startedAt: new Date(t.now()) });
  await t.db.insert(teamRoles).values({ hostId: h.id, role: "admin", contact: `+91${gone.p}`, userId: gone.me.id, addedBy: a.me.id, addedAt: new Date(t.now()), acceptedAt: new Date(t.now()), startedAt: new Date(t.now()), endedAt: new Date(t.now()), endReason: "removed" });
  const img = await png(900, 1200);
  for (const u of [crew, gone]) {
    assert.equal((await as(u)("POST", `/events/${e.id}/publish`)).status, 404);
    assert.equal((await as(u)("GET", `/events/${e.id}/tickets`)).status, 404);
    assert.equal((await tier(u, e.id)).status, 404);
    assert.equal((await upload(u, `/events/${e.id}/poster`, img)).status, 404);
    assert.equal((await upload(u, `/events/${e.id}/wide`, await png(1200, 900))).status, 404);
    assert.equal((await as(u)("DELETE", `/events/${e.id}/wide`)).status, 404);
  }

  // Uploads: too big, too small, and not to a cancelled event.
  const big = await upload(a, `/events/${e.id}/poster`, new Uint8Array(5 * 1024 * 1024 + 1000));
  assert.equal(big.status, 413);
  assert.equal(big.body.error, "tooBig");
  const small = await upload(a, `/events/${e.id}/poster`, await png(300, 400));
  assert.equal(small.body.error, "tooSmall");
  assert.equal(t.media.files.keys().filter((k) => k.startsWith(`events/${e.id}/`)).length, 0);

  const pub1 = await publish(a, h.id, { title: "To Cancel" });
  await as(a)("POST", `/events/${pub1.id}/cancel`, { reason: "Rain" });
  const keys = () => t.media.files.keys().filter((k) => k.startsWith(`events/${pub1.id}/`)).length;
  const before = keys();
  assert.equal((await upload(a, `/events/${pub1.id}/poster`, img)).body.error, "cancelled");
  assert.equal((await upload(a, `/events/${pub1.id}/wide`, await png(1200, 900))).body.error, "cancelled");
  assert.equal((await as(a)("DELETE", `/events/${pub1.id}/wide`)).body.error, "cancelled");
  assert.equal(keys(), before);

  await t.db.update(hosts).set({ status: "suspended" }).where(eq(hosts.id, h.id));
  for (const r of [await as(a)("POST", `/events/${e.id}/publish`), await tier(a, e.id), await upload(a, `/events/${e.id}/poster`, img), await as(a)("DELETE", `/events/${e.id}/wide`)])
    assert.equal(r.body.error, "hostClosed");
});

test("host events: every upcoming soonest first, then the latest 12 past", async () => {
  const a = await join();
  const h = await start(a);
  const later = await publish(a, h.id, { title: "Later", startsIn: 5 * DAY, endsIn: 5 * DAY + HOUR });
  const soon = await publish(a, h.id, { title: "Soon", startsIn: DAY, endsIn: DAY + HOUR });
  const hidden = await publish(a, h.id, { title: "Hidden" });
  await as(a)("PATCH", `/events/${hidden.id}`, { visibility: "link" });
  const gone = await publish(a, h.id, { title: "Gone" });
  await as(a)("POST", `/events/${gone.id}/cancel`, { reason: "Rain" });
  const past: string[] = [];
  for (let i = 0; i < 14; i++) {
    const e = await publish(a, h.id, { title: `Past ${i}` });
    await t.db.update(events).set({ startsAt: new Date(t.now() - (i + 2) * DAY), endsAt: new Date(t.now() - (i + 2) * DAY + HOUR) }).where(eq(events.id, e.id));
    past.push(e.slug);
  }
  await as(a)("PATCH", `/events/${soon.id}`, { slug: "soon-renamed" });
  const r = await pub(`/public/hosts/${h.slug}/events`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.upcoming.map((e: any) => e.title), ["Soon", "Later", "Hidden"].filter((x) => x !== "Hidden"));
  assert.equal(r.body.past.length, 12);
  assert.deepEqual(r.body.past.map((e: any) => e.slug), past.slice(0, 12)); // newest first
  assert.equal(later.slug === r.body.upcoming[1].slug, true);
  assert.equal((await pub("/public/hosts/nope/events")).status, 404);
});
