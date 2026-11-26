import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { DEFAULT_CONTENT, IMAGE_LINK } from "@orbit/contract";
import { testApp } from "./testkit.ts";
import { dropContent } from "./media.ts";
import { appContent, auditLog, staffGrants, users } from "./db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
const e164 = (p: string) => `+91${p}`;
const DAY = 24 * 3600_000;

const verify = async (to: string) => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to })).status, 200);
  return t.call("POST", "/auth/code/verify", { to, code: t.lastCode(e164(to)), device });
};
const join = async (p = phone()) => {
  const v = await verify(p);
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as { p: string; access: string; refresh: string; me: { id: string } };
};
type P = Awaited<ReturnType<typeof join>>;
const as = (u: P) => (m: string, path: string, body?: unknown) => t.call(m, path, body, u.access);
const give = async (u: P, ...features: string[]) => {
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: u.me.id, feature, addedBy: u.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
};
const audits = async (action: string) => (await t.db.select().from(auditLog)).filter((a) => a.action === action);
const staff = async () => {
  const u = await join();
  await give(u, "platform");
  return as(u);
};
const clear = async () => {
  await t.db.delete(appContent);
};
const ad = (o: Record<string, unknown> = {}) => ({ kicker: "Offer", title: "Title", line: "A line", colour: "forest", href: "/search", places: ["home"], ...o });

test("1 public read of an empty table is the defaults, cached a minute", async () => {
  await clear();
  const r = await t.app.request("/public/app-content");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(await r.json(), DEFAULT_CONTENT);
});

test("2 only staff with platform get in", async () => {
  await clear();
  assert.equal((await t.call("GET", "/galaxy/app-content")).status, 401);
  assert.equal((await t.call("PUT", "/galaxy/app-content/asks", { value: [], at: null })).status, 401);
  const plain = as(await join());
  assert.equal((await plain("GET", "/galaxy/app-content")).status, 404);
  assert.equal((await plain("PUT", "/galaxy/app-content/asks", { value: [], at: null })).status, 404);
  const p = await join();
  await give(p, "people");
  assert.equal((await as(p)("GET", "/galaxy/app-content")).status, 404);
  const ok = await (await staff())("GET", "/galaxy/app-content");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.saved, { ads: null, help: null, asks: null, featured: null, promoted: null, interests: null });
});

test("3 first save shows on both reads, names the saver, and is audited", async () => {
  await clear();
  const s = await staff();
  const before = (await audits("content.set")).length;
  const r = await s("PUT", "/galaxy/app-content/asks", { value: ["Jazz tonight"], at: null });
  assert.equal(r.status, 200);
  assert.equal(new Date(r.body.at).toISOString(), r.body.at);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Jazz tonight"]);
  const g = await s("GET", "/galaxy/app-content");
  assert.deepEqual(g.body.content.asks, ["Jazz tonight"]);
  assert.equal(g.body.saved.asks.by, "Riya Kapoor");
  assert.equal(g.body.saved.asks.at, r.body.at);
  const rows = await audits("content.set");
  assert.equal(rows.length, before + 1);
  assert.deepEqual(rows.at(-1)!.data, { key: "asks", value: ["Jazz tonight"] });
});

test("4 stale saves get 409 and write nothing", async () => {
  await clear();
  const a = await staff();
  const first = await a("PUT", "/galaxy/app-content/asks", { value: ["One"], at: null });
  assert.equal(first.status, 200);
  const dup = await a("PUT", "/galaxy/app-content/asks", { value: ["Two"], at: null });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, "changed");
  t.tick(1000);
  const b = await a("PUT", "/galaxy/app-content/asks", { value: ["Three"], at: first.body.at });
  assert.equal(b.status, 200);
  const old = await a("PUT", "/galaxy/app-content/asks", { value: ["Four"], at: first.body.at });
  assert.equal(old.status, 409);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Three"]);
  assert.equal((await audits("content.set")).filter((x) => (x.data as any).key === "asks" && ["Two", "Four"].includes((x.data as any).value[0])).length, 0);
});

test("5 bad saves are refused", async () => {
  await clear();
  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/app-content/nope", { value: [], at: null })).status, 404);
  const evil = await s("PUT", "/galaxy/app-content/ads", { value: [ad({ href: "https://evil.test" })], at: null });
  assert.equal(evil.status, 400);
  assert.equal(evil.body.error, "invalid");
  assert.match(evil.body.message, /^Ad 1:/);
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [ad({ colour: "#ff0000" })], at: null })).status, 400);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["a", "b", "c", "d", "e", "f", "g"], at: null })).status, 400);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["x".repeat(33 * 1024)], at: null })).status, 400);
  // A name every object has is still nothing here, never a server error.
  for (const k of ["constructor", "toString", "__proto__"]) assert.equal((await s("PUT", `/galaxy/app-content/${k}`, { value: [], at: null })).status, 404, k);
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [ad({ href: "constructor" })], at: null })).status, 400);
  // An end before its start.
  const backwards = await s("PUT", "/galaxy/app-content/ads", { value: [ad({ starts: "2026-11-25T21:00:00+05:30", ends: "2026-11-25T18:00:00+05:30" })], at: null });
  assert.equal(backwards.status, 400);
  assert.match(backwards.body.message, /^Ad 1: End it after it starts/);
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["Jams", "jams"], at: null })).status, 400);
  assert.equal((await t.db.select().from(appContent)).length, 0);
  assert.equal((await audits("content.set")).filter((x) => (x.data as any).key === "ads").length, 0);
});

test("5b an ad keeps its start and end, India time and all", async () => {
  await clear();
  const s = await staff();
  const timed = ad({ starts: "2026-11-25T18:00:00+05:30", ends: "2026-11-25T21:00:00+05:30" });
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [timed], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.ads, [timed]);
});

test("6 a stored list that no longer reads falls back to its default", async () => {
  await clear();
  await t.db.insert(appContent).values({ key: "help", value: "garbage", updatedAt: new Date(t.now()) });
  await t.db.insert(appContent).values({ key: "asks", value: ["Kept"], updatedAt: new Date(t.now()) });
  const r = (await t.call("GET", "/public/app-content")).body;
  assert.deepEqual(r.help, DEFAULT_CONTENT.help);
  assert.deepEqual(r.asks, ["Kept"]);
});

test("7 saved values come back trimmed", async () => {
  await clear();
  const s = await staff();
  assert.equal((await s("PUT", "/galaxy/app-content/asks", { value: ["  Padded  "], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.asks, ["Padded"]);
});

// ---- images, featured, promoted ----
const png = (width: number, height: number, background = "#1d372a") => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
const staffUser = async () => {
  const u = await join();
  await give(u, "platform");
  return u;
};
const upload = async (u: P, shape: string | null, bytes?: Uint8Array | null, type = "image/png", field = "image") => {
  const fd = new FormData();
  if (bytes) fd.append(field, new File([bytes as BlobPart], "a.png", { type }));
  return t.app.request(`/galaxy/app-content/image${shape === null ? "" : `?shape=${shape}`}`, { method: "POST", headers: { authorization: `Bearer ${u.access}` }, body: fd });
};
const up = async (u: P, shape: "strip" | "wide") => {
  const r = await upload(u, shape, await (shape === "strip" ? png(1350, 300) : png(1200, 900)));
  assert.equal(r.status, 201);
  return (await r.json()) as { url: string; edge: string };
};
const pathOf = (url: string) => new URL(url).pathname;
const keyOf = (url: string) => pathOf(url).slice("/media/".length);

test("8 a strip upload is stored, served, and audited", async () => {
  await clear();
  const u = await staffUser();
  const r = await upload(u, "strip", await png(1350, 300));
  assert.equal(r.status, 201);
  const b = (await r.json()) as { url: string; edge: string };
  assert.ok(b.url.startsWith(`https://api.test/media/content/${u.me.id}/`));
  assert.match(b.url, IMAGE_LINK);
  // lossy WebP: each channel may drift a little from the fill
  const d = [1, 3, 5].map((i) => Math.abs(parseInt(b.edge.slice(i, i + 2), 16) - parseInt("1d372a".slice(i - 1, i + 1), 16)));
  assert.match(b.edge, /^#[0-9a-f]{6}$/);
  assert.ok(d.every((x) => x <= 3), b.edge);
  assert.ok(t.media.files.keys().includes(keyOf(b.url)));
  const g = await t.app.request(pathOf(b.url));
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("content-type"), "image/webp");
  assert.equal(g.headers.get("cache-control"), "public, max-age=86400");
  assert.ok((await audits("content.image")).some((a) => (a.data as any).url === b.url));
});

test("9 a wide upload works; wrong shapes and bad uploads are refused", async () => {
  await clear();
  const u = await staffUser();
  assert.equal((await upload(u, "wide", await png(1200, 900))).status, 201);
  const a = await upload(u, "strip", await png(1200, 900));
  assert.equal(a.status, 400);
  const ab = (await a.json()) as any;
  assert.equal(ab.error, "wrongShape");
  assert.match(ab.message, /1350 × 300/);
  const w = await upload(u, "wide", await png(1350, 300));
  assert.equal(w.status, 400);
  assert.equal(((await w.json()) as any).error, "wrongShape");
  const txt = await upload(u, "strip", new TextEncoder().encode("hello"), "text/plain");
  assert.equal(txt.status, 400);
  assert.equal(((await txt.json()) as any).error, "notImage");
  assert.equal((await upload(u, "round", await png(1350, 300))).status, 400);
  assert.equal((await upload(u, null, await png(1350, 300))).status, 400);
  assert.equal((await upload(u, "strip", null)).status, 400);
  const big = await upload(u, "strip", Buffer.concat([await png(1350, 300), Buffer.alloc(5 * 1024 * 1024 + 100_000)]));
  assert.equal(big.status, 413);
  assert.equal(((await big.json()) as any).error, "tooBig");
  const plain = await join();
  assert.equal((await upload(plain, "strip", await png(1350, 300))).status, 404);
  const out = await t.app.request("/galaxy/app-content/image?shape=strip", { method: "POST", body: new FormData() });
  assert.equal(out.status, 401);
});

test("10 an ad with an uploaded image saves; another host's image is refused", async () => {
  await clear();
  const u = await staffUser();
  const s = as(u);
  const { url } = await up(u, "strip");
  const mine = { title: "Card offer", image: url, colour: "forest", places: ["home"] };
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [mine], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.ads, [mine]);
  await clear();
  const evil = { ...mine, image: "https://evil.test/media/content/6f1c2d3e-0000-4000-8000-000000000000/abcdefghijklmnopqrstuv.webp" };
  const r = await s("PUT", "/galaxy/app-content/ads", { value: [evil], at: null });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid");
  assert.equal(r.body.message, "Ad 1: Upload the image again.");
  assert.equal((await t.db.select().from(appContent)).length, 0);
});

test("11 featured takes picks and image slides, and refuses bad ones", async () => {
  await clear();
  const u = await staffUser();
  const s = as(u);
  const { url, edge } = await up(u, "wide");
  const value = [
    { kind: "pick", href: "/event/open-mic-night" },
    { kind: "image", image: url, edge, label: "Card offer", action: "See offer", href: "/account/payment" },
  ];
  assert.equal((await s("PUT", "/galaxy/app-content/featured", { value, at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.featured, value);
  const pick = await s("PUT", "/galaxy/app-content/featured", { value: [{ kind: "pick", href: "/search" }], at: null });
  assert.equal(pick.status, 400);
  assert.match(pick.body.message, /^Slide 1:/);
  const noEdge = await s("PUT", "/galaxy/app-content/featured", { value: [{ kind: "image", image: url, label: "x" }], at: null });
  assert.equal(noEdge.status, 400);
});

test("12 promoted takes events only, once each; fresh reads are the defaults", async () => {
  await clear();
  const fresh = (await t.call("GET", "/public/app-content")).body;
  assert.deepEqual(fresh.promoted, DEFAULT_CONTENT.promoted);
  assert.deepEqual(fresh.featured, []);
  const s = await staff();
  const host = await s("PUT", "/galaxy/app-content/promoted", { value: [{ href: "/host/x" }], at: null });
  assert.equal(host.status, 400);
  assert.match(host.body.message, /^Event 1:/);
  assert.equal((await s("PUT", "/galaxy/app-content/promoted", { value: [{ href: "/event/a" }, { href: "/event/a" }], at: null })).status, 400);
  assert.equal((await s("PUT", "/galaxy/app-content/promoted", { value: [{ href: "/event/a" }], at: null })).status, 200);
  assert.deepEqual((await t.call("GET", "/public/app-content")).body.promoted, [{ href: "/event/a" }]);
});

test("13 replacing an image deletes the old file; refused saves delete nothing", async () => {
  await clear();
  const u = await staffUser();
  const s = as(u);
  const A = await up(u, "strip");
  const mk = (image: string) => [{ title: "Offer", image, colour: "forest", places: ["home"] }];
  const first = await s("PUT", "/galaxy/app-content/ads", { value: mk(A.url), at: null });
  assert.equal(first.status, 200);
  const B = await up(u, "strip");
  const stale = await s("PUT", "/galaxy/app-content/ads", { value: mk(B.url), at: null });
  assert.equal(stale.status, 409);
  const bad = await s("PUT", "/galaxy/app-content/ads", { value: [{ ...mk(B.url)[0], colour: "red" }], at: first.body.at });
  assert.equal(bad.status, 400);
  assert.ok(t.media.files.keys().includes(keyOf(A.url)));
  t.tick(1000);
  const ok = await s("PUT", "/galaxy/app-content/ads", { value: mk(B.url), at: first.body.at });
  assert.equal(ok.status, 200);
  assert.ok(!t.media.files.keys().includes(keyOf(A.url)));
  assert.ok(t.media.files.keys().includes(keyOf(B.url)));
});

// ---- review fixes: orientation, size, transparency, shared images ----
const tilted = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#1d372a" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
const sizeOf = async (url: string) => {
  const f = await t.media.files.get(keyOf(url));
  const m = await sharp(f!.bytes).metadata();
  return [m.width, m.height];
};
const errOf = async (r: Response) => ((await r.json()) as any).error;

test("14 shape is judged upright: orientation 6 swaps width and height", async () => {
  await clear();
  const u = await staffUser();
  const ok = await upload(u, "wide", await tilted(900, 1200), "image/jpeg");
  assert.equal(ok.status, 201);
  assert.deepEqual(await sizeOf(((await ok.json()) as any).url), [1200, 900]);
  const bad = await upload(u, "wide", await tilted(1200, 900), "image/jpeg");
  assert.equal(bad.status, 400);
  assert.equal(await errOf(bad), "wrongShape");
  assert.equal((await upload(u, "strip", await tilted(300, 1350), "image/jpeg")).status, 201);
});

test("15 too-small images are refused", async () => {
  await clear();
  const u = await staffUser();
  const s = await upload(u, "strip", await png(450, 100));
  assert.equal(s.status, 400);
  assert.equal(await errOf(s), "tooSmall");
  const w = await upload(u, "wide", await png(400, 300));
  assert.equal(w.status, 400);
  assert.equal(await errOf(w), "tooSmall");
});

test("16 a see-through top row gets the Charcoal edge, not its hidden colour", async () => {
  await clear();
  const u = await staffUser();
  const img = await sharp({ create: { width: 1350, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r = await upload(u, "strip", img);
  assert.equal(r.status, 201);
  const { edge } = (await r.json()) as { edge: string };
  const d = [1, 3, 5].map((i) => Math.abs(parseInt(edge.slice(i, i + 2), 16) - parseInt("121215".slice(i - 1, i + 1), 16)));
  assert.ok(d.every((x) => x <= 3), edge);
});

test("17 an image another list still shows is not deleted", async () => {
  await clear();
  const u = await staffUser();
  const s = as(u);
  const A = await up(u, "wide");
  const ad = { title: "Offer", image: A.url, colour: "forest", places: ["home"] };
  const slide = { kind: "image", image: A.url, edge: A.edge, label: "x" };
  const a1 = await s("PUT", "/galaxy/app-content/ads", { value: [ad], at: null });
  assert.equal(a1.status, 200);
  const f1 = await s("PUT", "/galaxy/app-content/featured", { value: [slide], at: null });
  assert.equal(f1.status, 200);
  t.tick(1000);
  assert.equal((await s("PUT", "/galaxy/app-content/ads", { value: [], at: a1.body.at })).status, 200);
  assert.ok(t.media.files.keys().includes(keyOf(A.url)));
  t.tick(1000);
  assert.equal((await s("PUT", "/galaxy/app-content/featured", { value: [], at: f1.body.at })).status, 200);
  assert.ok(!t.media.files.keys().includes(keyOf(A.url)));
});

test("18 dropContent leaves keys that aren't App content images", async () => {
  const id = "6f1c2d3e-0000-4000-8000-000000000000";
  const name = "abcdefghijklmnopqrstuv";
  const keys = [`users/${id}/${name}.webp`, `content/${id}/short.webp`, `content/not-a-uuid/${name}.webp`];
  for (const k of keys) await t.media.files.put(k, new Uint8Array([1]), "image/webp");
  for (const k of keys) await dropContent(t.media, `${t.media.url}/${k}`);
  await dropContent(t.media, `https://evil.test/media/content/${id}/${name}.webp`);
  const have = t.media.files.keys();
  for (const k of keys) assert.ok(have.includes(k), k);
});

test("19 interests: staff hide and reorder the offered categories, only known ones, each once, at least one", async () => {
  await clear();
  const s = await staff();
  for (const value of [[], ["comedy", "comedy"], ["comedy", "nightlife"], "comedy"])
    assert.equal((await s("PUT", "/galaxy/app-content/interests", { value, at: null })).status, 400, JSON.stringify(value));
  const put = await s("PUT", "/galaxy/app-content/interests", { value: ["sports", "comedy"], at: null });
  assert.equal(put.status, 200);
  assert.deepEqual((await (await t.app.request("/public/app-content")).json()).interests, ["sports", "comedy"]);
  assert.equal((await s("PUT", "/galaxy/app-content/interests", { value: ["jams"], at: null })).status, 409);
  // A category an older stored list holds that this build doesn't know is left out, never the whole list.
  await t.db.update(appContent).set({ value: ["sports", "nightlife"] }).where(eq(appContent.key, "interests"));
  assert.deepEqual((await (await t.app.request("/public/app-content")).json()).interests, ["sports"]);
});
