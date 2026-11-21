import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { careersRoutes, pruneApplications } from "./careers.ts";
import { testApp } from "./testkit.ts";
import { applications, auditLog, openings, staffGrants } from "./db/schema.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const DAY = 24 * 3600_000;
let n = 0;
let ip = 0; // a new address per apply, so the hourly limit never trips
const staff = async (...features: string[]) => {
  const to = `8${String(6_000_000 + ++n * 13).padStart(9, "0")}`;
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to });
  const v = await t.call("POST", "/auth/code/verify", { to, code: t.lastCode(`+91${to}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  for (const feature of features as any[])
    await t.db.insert(staffGrants).values({ userId: s.body.me.id, feature, addedBy: s.body.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return (m: string, path: string, body?: unknown) => t.call(m, path, body, s.body.access);
};

const opening = (o: object = {}) => ({ title: "Product Designer", team: "Design", place: "Remote in India", kind: "full", about: "Make Orbit look right.", does: ["Design screens"], needs: ["Taste"], status: "open", ...o });
const pdf = () => new File([new TextEncoder().encode("%PDF-1.4 fake")], "cv.pdf", { type: "application/pdf" });
const apply = (slug: string, o: { resume?: File | null; turnstile?: string; email?: string; app?: typeof t.app; fields?: Record<string, string>; ip?: string } = {}) => {
  const f = new FormData();
  f.set("name", "Asha Rao");
  f.set("email", o.email ?? "asha@example.com");
  if (o.resume !== null) f.set("resume", o.resume ?? pdf());
  if (o.turnstile) f.set("turnstile", o.turnstile);
  for (const [k, v] of Object.entries(o.fields ?? {})) f.set(k, v);
  return (o.app ?? t.app).request(`/public/openings/${slug}/apply`, { method: "POST", headers: { "x-forwarded-for": o.ip ?? `198.51.100.${++ip}` }, body: f });
};

test("careers", async () => {
  const people = await staff("people");
  const plain = await staff();
  const draft = (await people("POST", "/galaxy/openings", opening({ status: "draft", title: "Draft Role" }))).body;
  const open = (await people("POST", "/galaxy/openings", opening())).body;
  const closed = (await people("POST", "/galaxy/openings", opening({ status: "closed", title: "Closed Role" }))).body;
  assert.match(open.slug, /^product-designer-[0-9a-f]{6}$/);

  // a draft isn't public, in the list or by slug
  const list = await t.app.request("/public/openings");
  assert.equal(list.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(((await list.json()) as any).openings.map((o: any) => o.slug), [open.slug]);
  assert.equal((await t.app.request(`/public/openings/${draft.slug}`)).status, 404);
  assert.equal((await t.app.request(`/public/openings/${open.slug}`)).status, 200);

  // a closed opening takes no applications
  assert.equal((await apply(closed.slug)).status, 404);

  // a non-PDF résumé is refused, whatever its name says
  const fake = new File([new TextEncoder().encode("<html>")], "cv.pdf", { type: "application/pdf" });
  const bad = await apply(open.slug, { resume: fake });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as any).error, "notPdf");
  assert.equal((await apply(open.slug, { resume: null })).status, 400);

  // a good apply, then the same email again
  assert.equal((await apply(open.slug)).status, 204);
  const again = await apply(open.slug);
  assert.equal(again.status, 204);
  assert.equal((await t.db.select().from(applications)).length, 1, "the first is kept");
  assert.equal(t.media.files.keys().filter((k) => k.startsWith("resumes/")).length, 1, "the repeat left no file");

  // the résumé key is not served by /media
  const [row] = await t.db.select().from(applications);
  assert.match(row!.resumeKey, /^resumes\/[0-9a-f-]{36}\/[\w-]{22}\.pdf$/);
  assert.equal((await t.app.request(`/media/${row!.resumeKey}`)).status, 404);
  assert.equal((await t.app.request(`/media/resumes/${open.slug}/x.pdf`)).status, 404);

  // Galaxy needs People
  for (const [m, p] of [["GET", "/galaxy/openings"], ["GET", `/galaxy/openings/${open.id}/applications`], ["GET", `/galaxy/applications/${row!.id}/resume`], ["DELETE", `/galaxy/applications/${row!.id}`]] as const)
    assert.equal((await plain(m, p)).status, 404, p);
  assert.equal((await t.call("GET", "/galaxy/openings")).status, 401);
  const all = (await people("GET", "/galaxy/openings")).body.openings;
  assert.equal(all.length, 3);
  assert.deepEqual(all.find((o: any) => o.id === open.id) && [all.find((o: any) => o.id === open.id).applications, all.find((o: any) => o.id === open.id).fresh], [1, 1]);
  const apps = await people("GET", `/galaxy/openings/${open.id}/applications`);
  assert.equal(apps.body.total, 1);
  assert.equal(apps.body.applications[0].phone, undefined);
  assert.equal((await people("PUT", `/galaxy/applications/${row!.id}`, { status: "shortlisted" })).status, 204);
  assert.equal((await people("GET", "/galaxy/openings")).body.openings.find((o: any) => o.id === open.id).fresh, 0);
});

test("résumé download and delete", async () => {
  const people = await staff("people");
  const o = (await people("POST", "/galaxy/openings", opening({ title: "Another" }))).body;
  assert.equal((await apply(o.slug, { email: "b@example.com" })).status, 204);
  const [row] = await t.db.select().from(applications).where(eq(applications.email, "b@example.com"));
  // t.call parses JSON, so read the file through the app with the same token
  const sess = await staffToken();
  const dl = await t.app.request(`/galaxy/applications/${row!.id}/resume`, { headers: { authorization: `Bearer ${sess}` } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  assert.equal(dl.headers.get("content-disposition"), 'attachment; filename="asha-rao-resume.pdf"');
  assert.equal(dl.headers.get("cache-control"), "private, no-store");
  assert.equal(dl.headers.get("x-content-type-options"), "nosniff");
  assert.match(await dl.text(), /^%PDF-/);
  assert.equal((await t.db.select().from(auditLog)).filter((a) => a.action === "careers.resume.read").length, 1);
  const del = await t.app.request(`/galaxy/applications/${row!.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sess}` } });
  assert.equal(del.status, 204);
  assert.equal(await t.media.files.get(row!.resumeKey), null);
  assert.equal((await t.db.select().from(openings)).length >= 1, true);
  const acts = (await t.db.select().from(auditLog)).map((a) => a.action);
  assert.ok(acts.includes("careers.application.delete"));
  assert.equal((await t.app.request(`/galaxy/applications/${row!.id}`, { method: "DELETE", headers: { authorization: `Bearer ${sess}` } })).status, 404);
});

test("apply limits and bad links", async () => {
  const people = await staff("people");
  const o = (await people("POST", "/galaxy/openings", opening({ title: "Limits" }))).body;
  const same = "203.0.113.77";
  for (let i = 1; i <= 10; i++) assert.equal((await apply(o.slug, { ip: same, email: `lim${i}@example.com` })).status, 204, `try ${i}`);
  const many = await apply(o.slug, { ip: same, email: "lim11@example.com" });
  assert.equal(many.status, 429);
  assert.equal(((await many.json()) as any).error, "tooMany");

  const big = await apply(o.slug, { resume: new File([new Uint8Array(5 * 1024 * 1024 + 64 * 1024)], "cv.pdf") });
  assert.equal(big.status, 413);
  assert.equal(((await big.json()) as any).error, "tooBig");

  const before = t.media.files.keys().length;
  for (const fields of [{ linkedin: "javascript:alert(1)" }, { link: "https://a.b/\u0000" }] as Record<string, string>[]) {
    const r = await apply(o.slug, { email: "evil@example.com", fields });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as any).error, "invalid");
  }
  assert.equal((await t.db.select().from(applications).where(eq(applications.email, "evil@example.com"))).length, 0);
  assert.equal(t.media.files.keys().length, before);
});

test("editing openings and applications", async () => {
  const people = await staff("people");
  const plain = await staff();
  const made = (await people("POST", "/galaxy/openings", opening({ title: "Old Title", pay: "10 LPA" }))).body;
  const put = await people("PUT", `/galaxy/openings/${made.id}`, opening({ title: "New Title" }));
  assert.equal(put.status, 200);
  const got = (await people("GET", `/galaxy/openings/${made.id}`)).body;
  assert.equal(got.slug, made.slug);
  assert.equal(got.title, "New Title");
  assert.equal(got.pay, undefined);
  assert.equal((await people("PUT", "/galaxy/openings/00000000-0000-4000-8000-000000000000", opening())).status, 404);

  assert.equal((await apply(made.slug, { email: "edit@example.com" })).status, 204);
  const [row] = await t.db.select().from(applications).where(eq(applications.email, "edit@example.com"));
  assert.equal((await people("PUT", `/galaxy/applications/${row!.id}`, { status: "maybe" })).status, 400);
  assert.equal((await plain("POST", "/galaxy/openings", opening())).status, 404);
  assert.equal((await plain("PUT", `/galaxy/openings/${made.id}`, opening())).status, 404);
  assert.equal((await plain("PUT", `/galaxy/applications/${row!.id}`, { status: "hired" })).status, 404);

  await people("GET", `/galaxy/openings/${made.id}/applications`);
  assert.ok((await t.db.select().from(auditLog)).some((a) => a.action === "careers.applications.list"));

  // a failed file delete fails the request and keeps the row
  const files = t.media.files;
  const remove = files.remove;
  files.remove = async () => {
    throw new Error("s3 down");
  };
  try {
    assert.equal((await people("DELETE", `/galaxy/applications/${row!.id}`)).status, 500);
  } finally {
    files.remove = remove;
  }
  assert.equal((await t.db.select().from(applications).where(eq(applications.id, row!.id))).length, 1);
  assert.equal((await people("DELETE", `/galaxy/applications/${row!.id}`)).status, 204);
});

test("with Turnstile set up, an apply without a good token is refused", async () => {
  const f = (async (_url: string, init?: RequestInit) => Response.json({ success: JSON.parse(String(init?.body)).response === "good" })) as unknown as typeof fetch;
  const p = await testApp({ proof: { enforce: false, apple: { appId: "TEAM123456.in.heyorbit.app" }, turnstile: { secret: "s" }, fetch: f } });
  try {
    await p.db.insert(openings).values({ slug: "x-1", title: "X", team: "T", place: "P", kind: "full", about: "A", does: [], needs: [], status: "open" });
    const no = await apply("x-1", { app: p.app });
    assert.equal(no.status, 403);
    assert.equal(((await no.json()) as any).error, "unproven");
    assert.equal((await apply("x-1", { app: p.app, turnstile: "bad" })).status, 403);
    assert.equal((await apply("x-1", { app: p.app, turnstile: "good" })).status, 204);
  } finally {
    await p.close();
  }
});

// The first test's last step needs a raw token; keep the latest one here.
async function staffToken() {
  const to = `8${String(7_000_000 + ++n * 13).padStart(9, "0")}`;
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to });
  const v = await t.call("POST", "/auth/code/verify", { to, code: t.lastCode(`+91${to}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  await t.db.insert(staffGrants).values({ userId: s.body.me.id, feature: "people", addedBy: s.body.me.id, addedAt: new Date(t.now() - 2 * DAY), startsAt: new Date(t.now() - DAY) });
  return s.body.access as string;
}

// An application `age` days old (by its created_at) on an opening with `status`; returns its file key.
let seq = 0;
const stale = async (status: "open" | "closed" | "draft", age: number, openingId?: string) => {
  const slug = `prune-${++seq}`;
  const id = openingId ?? (await t.db.insert(openings).values({ slug, title: slug, team: "T", place: "P", kind: "full", about: "A", does: [], needs: [], status }).returning())[0]!.id;
  const key = `resumes/${id}/${slug}.pdf`;
  await t.media.files.put(key, new Uint8Array([1]), "application/pdf");
  await t.db.insert(applications).values({ openingId: id, name: "A", email: `${slug}@example.com`, resumeKey: key, createdAt: new Date(t.now() - age * DAY) });
  return key;
};
const failing = (fail: (k: string) => boolean) => {
  const files = t.media.files;
  const remove = files.remove;
  const calls: string[] = [];
  files.remove = async (k: string) => {
    calls.push(k);
    if (fail(k)) throw new Error("s3 down");
    return remove.call(files, k);
  };
  return { calls, restore: () => void (files.remove = remove) };
};
const gone = async (k: string) => (await t.media.files.get(k)) === null;

test("prune: age and opening status decide", async () => {
  const old = await stale("closed", 366);
  const recent = await stale("closed", 364);
  const live = await stale("open", 400);
  const draft = await stale("draft", 400);
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 2);
  assert.ok(await gone(old) && (await gone(draft)));
  for (const k of [recent, live]) assert.ok(await t.media.files.get(k), k);
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 0);
  // moving now forward ages the kept closed one out, not the open one
  t.tick(2 * DAY);
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 1);
  assert.ok(await gone(recent));
  assert.ok(await t.media.files.get(live));
});

test("prune: a reopened, closed-again opening goes by the application's age", async () => {
  const k = await stale("closed", 400); // closed again yesterday: no closing time is kept, only the age counts
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 1);
  assert.ok(await gone(k));
});

test("prune: more than 200 stale applications go in one run", async () => {
  const [o] = await t.db.insert(openings).values({ slug: "prune-many", title: "m", team: "T", place: "P", kind: "full", about: "A", does: [], needs: [], status: "closed" }).returning();
  const rows = Array.from({ length: 450 }, (_, i) => ({ openingId: o!.id, name: "A", email: `many${i}@example.com`, resumeKey: `resumes/${o!.id}/many${i}.pdf`, createdAt: new Date(t.now() - 500 * DAY) }));
  for (const r of rows) await t.media.files.put(r.resumeKey, new Uint8Array([1]), "application/pdf");
  await t.db.insert(applications).values(rows);
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 450);
  assert.equal((await t.db.select().from(applications).where(eq(applications.openingId, o!.id))).length, 0);
  assert.equal(t.media.files.keys().filter((k) => k.includes("/many")).length, 0);
});

test("prune: a failed file delete keeps its row; a bucket that is down ends the run", async () => {
  const stuck = await stale("closed", 400);
  const fine = await stale("closed", 400);
  let f = failing((k) => k === stuck);
  try {
    assert.equal(await pruneApplications(t.db, t.media, t.now()), 1);
  } finally {
    f.restore();
  }
  assert.ok(await t.media.files.get(stuck));
  assert.ok(await gone(fine));
  assert.equal((await t.db.select().from(applications).where(eq(applications.resumeKey, stuck))).length, 1);
  assert.equal(await pruneApplications(t.db, t.media, t.now()), 1, "the next run takes it");

  // every delete throws, with more rows than one batch: one batch is tried, nothing is deleted
  const [o] = await t.db.insert(openings).values({ slug: "prune-down", title: "d", team: "T", place: "P", kind: "full", about: "A", does: [], needs: [], status: "closed" }).returning();
  const rows = Array.from({ length: 250 }, (_, i) => ({ openingId: o!.id, name: "A", email: `down${i}@example.com`, resumeKey: `resumes/${o!.id}/down${i}.pdf`, createdAt: new Date(t.now() - 500 * DAY) }));
  await t.db.insert(applications).values(rows);
  f = failing(() => true);
  try {
    assert.equal(await pruneApplications(t.db, t.media, t.now()), 0);
  } finally {
    f.restore();
  }
  assert.equal(f.calls.length, 200, "one batch, not every row");
  assert.equal((await t.db.select().from(applications).where(eq(applications.openingId, o!.id))).length, 250);
  await t.db.delete(applications).where(eq(applications.openingId, o!.id));
});

test("a mail that throws or never resolves still answers 204 and keeps the application", async () => {
  const people = await staff("people");
  const o = (await people("POST", "/galaxy/openings", opening({ title: "Mail Fails" }))).body;
  for (const [email, mail] of [
    ["throws@example.com", async () => { throw new Error("ses down"); }],
    ["sync@example.com", () => { throw new Error("sync"); }],
    ["hangs@example.com", () => new Promise<void>(() => {})],
  ] as const) {
    const app = new Hono().route("/", careersRoutes({ db: t.db, store: t.store, secret: "test-secret-that-is-at-least-32-characters", media: t.media, mail, now: t.now } as any));
    assert.equal((await apply(o.slug, { app, email })).status, 204, email);
    await new Promise((r) => setImmediate(r));
    assert.equal((await t.db.select().from(applications).where(eq(applications.email, email))).length, 1, email);
  }
});

test("the applicant gets one email for a new application", async () => {
  const people = await staff("people");
  const o = (await people("POST", "/galaxy/openings", opening({ title: "Mail Role" }))).body;
  const mine = () => t.mails.filter((m) => m.to === "mail@example.com");
  assert.equal((await apply(o.slug, { resume: new File([new TextEncoder().encode("<html>")], "cv.pdf"), email: "mail@example.com" })).status, 400);
  assert.equal(mine().length, 0, "a refused one sends none");
  assert.equal((await apply(o.slug, { email: "mail@example.com" })).status, 204);
  await new Promise((r) => setImmediate(r));
  assert.equal(mine().length, 1);
  assert.match(mine()[0]!.subject, /Mail Role/);
  assert.equal((await apply(o.slug, { email: "mail@example.com" })).status, 204);
  await new Promise((r) => setImmediate(r));
  assert.equal(mine().length, 1, "a repeat sends none");
});
