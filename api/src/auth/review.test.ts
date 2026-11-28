import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { testApp } from "../testkit.ts";
import { activity, hosts, stations, users, venues } from "../db/schema.ts";
import { activeCounts } from "../analytics.ts";
import { reviewFrom } from "./review.ts";
import { seedReview } from "./review-seed.ts";

// App Store and Play reviewers' sign-in (auth/review.ts, PM X20).

const CODE = "481203";
const [ORBIT, LAUNCH, STATION] = ["orbit-review@example.com", "launch-review@example.com", "station-review@example.com"];
const review = reviewFrom(CODE, ` ${ORBIT}, ${LAUNCH.toUpperCase()},${STATION} `)!;
const device = { name: "iPhone", client: "app" as const };

// Everything logged while `f` runs, to check no code or review email is ever in it.
const logged: string[] = [];
const keep = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
const orig = { log: console.log, error: console.error, warn: console.warn };
before(() => Object.assign(console, { log: keep, error: keep, warn: keep }));
after(() => {
  Object.assign(console, orig);
  for (const line of logged) for (const secret of [CODE, ORBIT, LAUNCH, STATION]) assert.ok(!line.includes(secret), `logged: ${line}`);
});

let t: Awaited<ReturnType<typeof testApp>>;
// Closed to everyone (OPEN_TO set, nobody on it): the review emails still get in.
before(async () => {
  t = await testApp({ codes: { openTo: new Set(), dailyCap: Infinity, review } });
  await seedReview(t.db, review, t.now());
});
after(() => t?.close());

const send = (to: string) => {
  t.tick(30_000);
  return t.call("POST", "/auth/code", { to });
};
const verify = (to: string, code: string) => t.call("POST", "/auth/code/verify", { to, code, device });
const signIn = async (to: string) => {
  const s = await send(to);
  assert.deepEqual(s.body, { retryIn: 30 }); // the same answer as any send, with no code in it
  const v = await verify(to, CODE);
  assert.equal(v.body.step, "signedIn", JSON.stringify(v.body)); // no phone step, no About you
  return v.body;
};

test("reviewFrom: off unless both are set, and refuses a weak code or a bad list", () => {
  assert.equal(reviewFrom(undefined, undefined), null);
  assert.equal(reviewFrom(" ", ""), null);
  assert.throws(() => reviewFrom(CODE, undefined));
  assert.throws(() => reviewFrom(undefined, ORBIT));
  for (const weak of ["111111", "121212", "12345", "1234567", "abcdef"]) assert.throws(() => reviewFrom(weak, ORBIT), weak);
  assert.throws(() => reviewFrom(CODE, "not-an-email"));
  assert.throws(() => reviewFrom(CODE, "a@x.in,b@x.in,c@x.in,d@x.in"));
  assert.deepEqual(review.accounts.map((a) => [a.app, a.email]), [["orbit", ORBIT], ["launch", LAUNCH], ["station", STATION]]);
});

test("each review account signs straight in with the fixed code, and nothing is sent", async () => {
  const o = await signIn(ORBIT);
  assert.equal(o.me.email, ORBIT);
  assert.deepEqual(o.me.teams, []);

  const l = await signIn(LAUNCH);
  assert.equal(l.me.teams.length, 1);
  assert.equal(l.me.teams[0].admin, true); // what Event Partner looks for

  const s = await signIn(STATION);
  assert.equal(s.me.teams.length, 1);
  assert.equal(s.me.teams[0].kind, "venue"); // what Play Partner looks for
  assert.ok(s.me.teams[0].admin);
  const st = await t.call("GET", `/venues/${s.me.teams[0].hostId}`, undefined, s.access);
  assert.equal(st.status, 200, JSON.stringify(st.body));
  assert.equal(st.body.stations.length, 1);

  assert.equal(t.sent.length, 0);
});

test("the demo host and venue are private: no public page, no public slots", async () => {
  const rows = await t.db.select().from(hosts);
  assert.equal(rows.length, 2);
  for (const h of rows) {
    assert.equal(h.visibility, "private");
    assert.equal((await t.call("GET", `/public/hosts/${h.slug}`)).status, 404);
  }
  const venue = rows.find((h) => h.kind === "venue")!;
  assert.equal((await t.call("GET", `/public/venues/${venue.id}/slots`)).status, 404);
});

test("a reviewer can't make a host public, and a host they start is private", async () => {
  const l = await signIn(LAUNCH);
  const id = l.me.teams[0].hostId;
  const r = await t.call("PATCH", `/hosts/${id}`, { visibility: "public" }, l.access);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "reviewPrivate");
  assert.equal((await t.call("PATCH", `/hosts/${id}`, { about: "Still a demo" }, l.access)).status, 200);
  const made = await t.call("POST", "/hosts", { name: "Reviewer's club", kind: "college-club", city: "Hyderabad" }, l.access);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const [h] = await t.db.select().from(hosts).where(eq(hosts.name, "Reviewer's club"));
  assert.equal(h!.visibility, "private");
});

test("seeding again changes nothing", async () => {
  const before = { users: (await t.db.select().from(users)).length, hosts: (await t.db.select().from(hosts)).length };
  await seedReview(t.db, review, t.now());
  await seedReview(t.db, review, t.now());
  assert.equal((await t.db.select().from(users)).length, before.users);
  assert.equal((await t.db.select().from(hosts)).length, before.hosts);
  assert.equal((await t.db.select().from(venues)).length, 1);
  assert.equal((await t.db.select().from(stations)).length, 1);
  assert.equal((await signIn(ORBIT)).me.email, ORBIT);
});

test("a wrong code counts toward the limits, as any other", async () => {
  await send(ORBIT);
  for (let i = 0; i < 5; i++) assert.equal((await verify(ORBIT, "000000")).body.error, "wrongCode");
  assert.equal((await verify(ORBIT, CODE)).body.error, "tooMany");
  t.tick(15 * 60_000);
  await signIn(ORBIT);
});

test("the fixed code is used up once, like any code", async () => {
  await send(ORBIT);
  assert.equal((await verify(ORBIT, CODE)).body.step, "signedIn");
  assert.equal((await verify(ORBIT, CODE)).body.error, "codeExpired");
});

test("a real email never takes the fixed code, and its own code still goes", async () => {
  const t2 = await testAppReview(); // open, so a real email gets codes
  try {
    for (const to of ["someone@example.com", "9876543210"]) {
      t2.tick(30_000);
      assert.equal((await t2.call("POST", "/auth/code", { to })).status, 200);
      const sent = t2.sent.at(-1)!;
      assert.equal(sent.to.kind === "phone" ? sent.to.e164 : sent.to.email, to.includes("@") ? to : `+91${to}`);
      if (sent.code !== CODE) assert.equal((await t2.call("POST", "/auth/code/verify", { to, code: CODE, device })).body.error, "wrongCode");
    }
  } finally {
    await t2.close();
  }
});

test("a review email on a real person's account is left out: a real code, never the fixed one", async () => {
  const t2 = await testAppReview();
  try {
    const at = new Date(t2.now());
    await t2.db.insert(users).values({ name: "Real Person", phone: "+919876543210", phoneVerifiedAt: at, email: ORBIT, emailVerifiedAt: at, dob: "1995-01-01" });
    await seedReview(t2.db, review, t2.now());
    assert.equal((await t2.db.select().from(users).where(eq(users.email, ORBIT)))[0]!.phone, "+919876543210"); // untouched
    t2.tick(30_000);
    assert.equal((await t2.call("POST", "/auth/code", { to: ORBIT })).status, 200);
    assert.equal(t2.sent.length, 1); // a real code went to them
    if (t2.lastCode(ORBIT) !== CODE) assert.equal((await t2.call("POST", "/auth/code/verify", { to: ORBIT, code: CODE, device })).body.error, "wrongCode");
  } finally {
    await t2.close();
  }
});

test("Galaxy tags a review account, and analytics leave them out", async () => {
  const t2 = await testAppReview();
  try {
    // A real person, made the platform owner, to read Galaxy.
    t2.tick(30_000);
    await t2.call("POST", "/auth/code", { to: "9876543210" });
    const v = await t2.call("POST", "/auth/code/verify", { to: "9876543210", code: t2.lastCode("+919876543210"), device });
    const s = await t2.call("POST", "/auth/signup", { signup: v.body.signup, name: "Owner", dob: "1990-01-01", device });
    await t2.db.update(users).set({ platformOwner: true }).where(eq(users.id, s.body.me.id));
    const as = (path: string) => t2.call("GET", path, undefined, s.body.access);
    const dash = async () => (await as("/galaxy/dashboard")).body.people.total;
    const stats = async () => (await as("/galaxy/analytics")).body;
    const [d0, a0] = [await dash(), await stats()];

    await seedReview(t2.db, review, t2.now());
    const ids = (await t2.db.select().from(users)).filter((u) => u.phone?.startsWith("+9100000000")).map((u) => u.id);
    assert.equal(ids.length, 3);
    for (const id of ids) await t2.db.insert(activity).values({ userId: id, day: new Date(t2.now() + 330 * 60_000).toISOString().slice(0, 10), platform: "ios" });

    assert.equal(await dash(), d0);
    const a1 = await stats();
    assert.deepEqual(a1.active, a0.active);
    assert.deepEqual(a1.follows, a0.follows);
    assert.deepEqual(a1.ages, a0.ages);
    assert.deepEqual(await activeCounts(t2.db, t2.now()), a0.active);

    const page = await as(`/galaxy/people/${ids[0]}`);
    assert.equal(page.body.review, true);
    assert.equal((await as(`/galaxy/people/${s.body.me.id}`)).body.review, false);
  } finally {
    await t2.close();
  }
});

test("unset, review emails are ordinary emails: a real code is sent", async () => {
  const t2 = await testApp();
  try {
    await seedReview(t2.db, review, t2.now()); // even with accounts left from an earlier setting
    t2.tick(30_000);
    assert.equal((await t2.call("POST", "/auth/code", { to: ORBIT })).status, 200);
    assert.equal(t2.sent.length, 1);
    if (t2.lastCode(ORBIT) !== CODE) assert.equal((await t2.call("POST", "/auth/code/verify", { to: ORBIT, code: CODE, device })).body.error, "wrongCode");
  } finally {
    await t2.close();
  }
});

test("the app's proof is still needed for a review email", async () => {
  const t2 = await testApp({ codes: { openTo: null, dailyCap: Infinity, review }, proof: { enforce: true, apple: { appIds: ["9AH3Z5C5DH.in.heyorbit.app"] } } });
  try {
    await seedReview(t2.db, review, t2.now());
    const r = await t2.call("POST", "/auth/code", { to: ORBIT });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "unproven");
    // Nothing was kept, so the fixed code alone opens nothing.
    assert.equal((await t2.call("POST", "/auth/code/verify", { to: ORBIT, code: CODE, device })).body.error, "codeExpired");
  } finally {
    await t2.close();
  }
});

// Its own database, open to everyone, with the review emails set. Each empties the database, so these run after `t`'s.
const testAppReview = () => testApp({ codes: { openTo: null, dailyCap: Infinity, review } });
