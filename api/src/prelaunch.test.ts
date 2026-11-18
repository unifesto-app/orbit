import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { type Contact, FEATURES } from "@orbit/contract";
import type { Mail } from "./auth/senders.ts";
import { testApp } from "./testkit.ts";
import { auditLog, interest, sessions, staffGrants, users } from "./db/schema.ts";
import { welcomeEmail } from "./prelaunch-email.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
let n = 0;
const join = async () => {
  const p = `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
  t.tick(30_000);
  await t.call("POST", "/auth/code", { to: p });
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(`+91${p}`), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  return s.body as { access: string; me: { id: string } };
};
const post = async (path: string, ip: string, body: unknown) =>
  t.app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
const send = async (phone: string, ip = "203.0.113.7") => (await post("/public/interest/code", ip, { phone })).status;
// From a given address, as Caddy would set it.
const from = async (ip: string, body: unknown) => (await post("/public/interest", ip, body)).status;
const count = async () => (await t.call("GET", "/public/interest")).body.count as number;
const rows = (phone: string) => t.db.select().from(interest).where(eq(interest.phone, phone));
// The welcome email is sent without being awaited.
const settle = () => new Promise((r) => setTimeout(r, 50));
const sign = { name: "Riya Kapoor", email: "riya@example.com", dob: "2000-05-01", features: [] as string[] };
// Sends a fresh code (past the 30 s resend gap) and joins from `ip`.
const joinWith = async (phone: string, ip: string, extra: object = {}) => {
  t.tick(30_000);
  assert.equal(await send(phone, ip), 200);
  return from(ip, { ...sign, phone, code: t.lastCode(`+91${phone.slice(-10)}`), ...extra });
};

test("the waitlist counts people, not taps, and tells nobody who has joined", async () => {
  const meta = { country: "IN", userAgent: "Mozilla/5.0", utm: { utm_source: "instagram" }, screen: "390x844@3" };
  const before = await count();
  const code = await t.call("POST", "/public/interest/code", { phone: "9812345678" });
  assert.deepEqual([code.status, code.body], [200, { retryIn: 30 }]);
  const body = { name: "  Riya Kapoor ", phone: "9812345678", email: "Meera@Example.com ", dob: "2000-05-01", code: t.lastCode("+919812345678"), features: ["slots", "host", "slots"], meta };
  assert.equal((await t.call("POST", "/public/interest", body)).status, 204);
  await settle();
  const mine = t.mails.filter((m) => m.to === "meera@example.com");
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.subject, "You’re on the Orbit waitlist");
  for (const x of [mine[0]!.html, mine[0]!.text]) {
    assert.ok(x.includes("You’re in, Riya."));
    assert.ok(x.includes(FEATURES.slots) && x.includes(FEATURES.host) && !x.includes(FEATURES.fests));
  }
  assert.equal(await count(), before + 1);
  const [row] = await rows("+919812345678");
  assert.equal(row!.name, "Riya Kapoor");
  assert.equal(row!.email, "meera@example.com");
  assert.equal(row!.dob, "2000-05-01");
  assert.deepEqual(row!.features, ["slots", "host"]);
  assert.equal(row!.ip, "203.0.113.7"); // the request's address, never the body's
  assert.deepEqual(row!.utm, { utm_source: "instagram" });
  assert.equal(row!.country, "IN");
});

test("joining again with the same number is fine and keeps the first details", async () => {
  const before = await count();
  t.tick(30_000);
  assert.equal(await send("9812345678"), 200);
  const r = await t.call("POST", "/public/interest", { ...sign, name: "Someone Else", phone: "+91 98123 45678", code: t.lastCode("+919812345678") });
  assert.equal(r.status, 204);
  assert.equal(await count(), before);
  assert.equal((await rows("+919812345678"))[0]!.name, "Riya Kapoor");
  await settle();
  assert.equal(t.mails.filter((m) => m.to === "meera@example.com" || m.to === "riya@example.com").length, 1); // no second email
});

test("a wrong code, or no code sent, stores nothing", async () => {
  const before = await count();
  t.tick(30_000);
  assert.equal(await send("9822222222"), 200);
  const real = t.lastCode("+919822222222")!;
  const wrong = real === "000000" ? "111111" : "000000";
  const w = await t.call("POST", "/public/interest", { ...sign, phone: "9822222222", code: wrong });
  assert.deepEqual([w.status, w.body.error], [400, "wrongCode"]);
  const e = await t.call("POST", "/public/interest", { ...sign, phone: "9833333333", code: "123456" });
  assert.deepEqual([e.status, e.body.error], [400, "codeExpired"]);
  assert.equal(await count(), before);
  assert.equal((await rows("+919822222222")).length + (await rows("+919833333333")).length, 0);
});

test("under 18 is refused without spending the code", async () => {
  const before = await count();
  const d = new Date(t.now());
  const almost = new Date(Date.UTC(d.getUTCFullYear() - 18, d.getUTCMonth(), d.getUTCDate() + 2)).toISOString().slice(0, 10); // 17 until tomorrow (+2: India may be a day ahead of UTC)
  t.tick(30_000);
  assert.equal(await send("9844444444"), 200);
  const code = t.lastCode("+919844444444");
  const r = await t.call("POST", "/public/interest", { ...sign, dob: almost, phone: "9844444444", code });
  assert.deepEqual([r.status, r.body.error], [403, "under18"]);
  assert.equal(await count(), before);
  assert.equal((await t.call("POST", "/public/interest", { ...sign, phone: "9844444444", code })).status, 204);
  assert.equal(await count(), before + 1);
});

test("bad numbers and features are refused", async () => {
  t.tick(60_000);
  const bad = await t.call("POST", "/public/interest/code", { phone: "12345" });
  assert.deepEqual([bad.status, bad.body.error], [400, "invalid"]);
  const abroad = await t.call("POST", "/public/interest/code", { phone: "+447911123456" });
  assert.deepEqual([abroad.status, abroad.body.error], [400, "abroad"]);
  const j = await t.call("POST", "/public/interest", { ...sign, phone: "12345", code: "123456" });
  assert.deepEqual([j.status, j.body.error], [400, "invalid"]);
  const a = await t.call("POST", "/public/interest", { ...sign, phone: "+447911123456", code: "123456" });
  assert.deepEqual([a.status, a.body.error], [400, "abroad"]);
  const f = await t.call("POST", "/public/interest", { ...sign, phone: "9855555555", code: "123456", features: ["teleport"] });
  assert.deepEqual([f.status, f.body.error], [400, "invalid"]);
});

test("hostile input is refused quickly, never a 500", async () => {
  t.tick(60_000);
  const ok = { ...sign, phone: "9866666666", code: "123456" };
  const started = Date.now();
  assert.equal(await from("198.51.100.1", { ...ok, name: "a\u0000b" }), 400);
  assert.equal(await from("198.51.100.1", { ...ok, name: "b".repeat(9000) }), 400); // over the body cap
  assert.equal((await post("/public/interest/code", "198.51.100.1", { phone: "9".repeat(9000) })).status, 400);
  assert.ok(Date.now() - started < 500);
  assert.equal(await from("198.51.100.1", { ...ok, meta: { userAgent: "x\u0000" } }), 400);
  assert.equal(await from("198.51.100.1", { ...ok, meta: { utm: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])) } }), 400);
  assert.equal(await from("198.51.100.1", "not json"), 400);
});

test("ten joins a minute from one address, one IPv6 /64 counting as one", async () => {
  t.tick(60_000);
  const num = (i: number) => `97000${String(i).padStart(5, "0")}`;
  // Codes first (each waits out the resend gap), then the joins together inside one minute.
  const attempt = async (ip: string, ids: number[]) => {
    for (const i of ids) {
      t.tick(30_000);
      assert.equal(await send(num(i), ip), 200);
    }
    t.tick(60_000);
    const out: number[] = [];
    for (const i of ids) out.push(await from(ip, { ...sign, phone: num(i), code: t.lastCode(`+91${num(i)}`) }));
    return out;
  };
  const v4 = await attempt("192.0.2.9", Array.from({ length: 11 }, (_, i) => i));
  assert.deepEqual(v4, [...Array(10).fill(204), 429]);
  const ips = [...Array.from({ length: 10 }, (_, i) => `2001:db8:1:2::${i + 1}`), "2001:db8:1:2:ffff::1"];
  for (const [k, ip] of ips.entries()) {
    t.tick(30_000);
    assert.equal(await send(num(20 + k), ip), 200);
  }
  t.tick(60_000);
  const out: number[] = [];
  for (const [k, ip] of ips.entries()) out.push(await from(ip, { ...sign, phone: num(20 + k), code: t.lastCode(`+91${num(20 + k)}`) }));
  assert.deepEqual(out, [...Array(10).fill(204), 429]);
  assert.equal(await joinWith(num(31), "2001:db8:1:3::1"), 204); // another network
  assert.equal((await rows(`+91${num(10)}`)).length + (await rows(`+91${num(30)}`)).length, 0);
});

test("only holders of People see the list, and each read is logged", async () => {
  const someone = await join();
  assert.equal((await t.call("GET", "/galaxy/prelaunch")).status, 401);
  assert.equal((await t.call("GET", "/galaxy/prelaunch", undefined, someone.access)).status, 404);
  const day = 24 * 3600_000;
  const grant = (feature: "hosts" | "people") =>
    t.db.insert(staffGrants).values({ userId: someone.me.id, feature, addedBy: someone.me.id, addedAt: new Date(t.now() - 2 * day), startsAt: new Date(t.now() - day) });
  await grant("hosts");
  assert.equal((await t.call("GET", "/galaxy/prelaunch", undefined, someone.access)).status, 404);
  await grant("people");
  await t.db.insert(interest).values({ email: "old@example.com", createdAt: new Date(2026, 0, 1) }); // from before the phone sign-up
  const list = await t.call("GET", "/galaxy/prelaunch", undefined, someone.access);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, (await t.call("GET", "/public/interest")).body.count);
  const people = list.body.people as any[];
  assert.equal(people.length, list.body.total); // under a page: every row so far
  const riya = people.find((p) => p.phone === "+919812345678");
  assert.equal(riya.name, "Riya Kapoor");
  assert.equal(riya.dob, "2000-05-01");
  assert.deepEqual(riya.features, ["slots", "host"]);
  assert.equal(riya.country, "IN");
  assert.equal(riya.region, undefined); // what the visit didn't give is left out
  assert.deepEqual({ ...people.at(-1), id: 0, createdAt: 0 }, { id: 0, createdAt: 0, email: "old@example.com", name: null, phone: null, dob: null, features: [], ip: null }); // newest first
  assert.equal((await t.db.select().from(auditLog).where(eq(auditLog.action, "prelaunch.list"))).length, 1);
});

const made = async () => (await t.db.select().from(users)).length;

test("a waitlist code does not sign in, even past the opening gate", async () => {
  const verify = async (phone: string) => {
    const before = await made();
    const r = await t.call("POST", "/auth/code/verify", { to: phone.slice(-10), code: t.lastCode(phone), device });
    assert.equal(r.status, 400);
    assert.ok(["codeExpired", "wrongCode"].includes(r.body.error));
    assert.equal(await made(), before);
    assert.equal(r.body.access, undefined);
  };
  t.tick(30_000);
  assert.equal(await send("9877000001"), 200);
  await verify("+919877000001");
  await t.close();
  t = await testApp({ codes: { openTo: new Set(["+919999999999"]), dailyCap: Infinity } });
  assert.equal(await send("9877000002"), 200);
  await verify("+919877000002");
  assert.equal((await t.db.select().from(sessions)).length, 0);
  await t.close();
  t = await testApp();
});

test("a sign-in code does not join the waitlist", async () => {
  const before = await count();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: "9877000003" })).status, 200);
  const r = await t.call("POST", "/public/interest", { ...sign, phone: "9877000003", code: t.lastCode("+919877000003") });
  assert.equal(r.status, 400);
  assert.equal(await count(), before);
  assert.equal((await rows("+919877000003")).length, 0);
});

test("a waitlist send does not replace a pending sign-in code", async () => {
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: "9877000004" })).status, 200);
  const first = t.lastCode("+919877000004");
  t.tick(30_000);
  assert.equal(await send("9877000004"), 200);
  const v = await t.call("POST", "/auth/code/verify", { to: "9877000004", code: first, device });
  assert.equal(v.status, 200);
});

test("enforced, the waitlist code send needs a proof and sends nothing without one", async () => {
  const f = (async (_url: string, init?: RequestInit) =>
    Response.json({ success: JSON.parse(String(init?.body)).response === "good" })) as unknown as typeof fetch;
  const p = await testApp({ proof: { enforce: true, apple: { appId: "TEAM123456.in.heyorbit.app" }, turnstile: { secret: "s" }, fetch: f } });
  try {
    const go = (body: object) => p.app.request("/public/interest/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const no = await go({ phone: "9877000005" });
    assert.equal(no.status, 403);
    assert.equal(((await no.json()) as any).error, "unproven");
    assert.equal((await go({ phone: "9877000005", proof: { kind: "web", token: "bad" } })).status, 403);
    assert.equal(p.sent.length, 0);
    assert.equal((await go({ phone: "9877000005", proof: { kind: "web", token: "good" } })).status, 200);
    assert.ok(p.lastCode("+919877000005"));
  } finally {
    await p.close();
  }
});

test("with Turnstile set, the waitlist send needs a proof even when enforce is off; sign-in does not", async () => {
  const f = (async (_url: string, init?: RequestInit) =>
    Response.json({ success: JSON.parse(String(init?.body)).response === "good" })) as unknown as typeof fetch;
  const p = await testApp({ proof: { enforce: false, apple: { appId: "TEAM123456.in.heyorbit.app" }, turnstile: { secret: "s" }, fetch: f } });
  try {
    const go = (body: object) => p.app.request("/public/interest/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const no = await go({ phone: "9877000006" });
    assert.equal(no.status, 403);
    assert.equal(((await no.json()) as any).error, "unproven");
    assert.equal(p.lastCode("+919877000006"), undefined);
    assert.equal((await go({ phone: "9877000006", proof: { kind: "web", token: "bad" } })).status, 403);
    assert.equal(p.sent.length, 0);
    assert.equal((await go({ phone: "9877000006", proof: { kind: "web", token: "good" } })).status, 200);
    assert.ok(p.lastCode("+919877000006"));
    assert.equal((await p.call("POST", "/auth/code", { to: "9877000007" })).status, 200); // sign-in follows enforce
  } finally {
    await p.close();
  }
  // No Turnstile configured (the shared app): unchanged, no proof needed.
  t.tick(30_000);
  assert.equal(await send("9877000008"), 200);
});

test("the sign-in opening gate does not block the waitlist", async () => {
  await t.close();
  t = await testApp({ codes: { openTo: new Set(["+919999999999"]), dailyCap: Infinity } });
  assert.equal((await t.call("POST", "/auth/code", { to: "9811111111" })).status, 403); // sign-in is still gated
  assert.equal(await send("9811111111"), 200);
  assert.ok(t.lastCode("+919811111111"));
});

test("a name with HTML is escaped in the welcome email and the join still works", async () => {
  const to = "xss@example.com";
  assert.equal(await joinWith("9877100001", "203.0.113.21", { name: "<img src=x onerror=alert(1)> Riya", email: to }), 204);
  await settle();
  const m = t.mails.filter((x) => x.to === to);
  assert.equal(m.length, 1);
  assert.ok(!m[0]!.html.includes("<img src=x"));
  assert.ok(m[0]!.html.includes("You’re in.") && !m[0]!.html.includes("onerror")); // not a name, so not greeted at all
  assert.equal((await rows("+919877100001")).length, 1);
});

test("a bad email is refused before the code is spent", async () => {
  const before = await count();
  const mails = t.mails.length;
  t.tick(30_000);
  assert.equal(await send("9877100002", "203.0.113.22"), 200);
  const code = t.lastCode("+919877100002");
  for (const email of ["nope", "a@b", "a b@example.com", "", "x@@example.com"]) {
    const r = await t.call("POST", "/public/interest", { ...sign, email, phone: "9877100002", code });
    assert.deepEqual([r.status, r.body.error], [400, "invalid"]);
  }
  assert.equal((await t.call("POST", "/public/interest", { ...sign, email: undefined, phone: "9877100002", code })).status, 400);
  assert.equal(await count(), before);
  assert.equal((await rows("+919877100002")).length, 0);
  await settle();
  assert.equal(t.mails.length, mails);
  assert.equal((await t.call("POST", "/public/interest", { ...sign, email: "good@example.com", phone: "9877100002", code })).status, 204); // same code still works
});

test("two numbers may share one email", async () => {
  const to = "shared@example.com";
  assert.equal(await joinWith("9877100003", "203.0.113.23", { email: to }), 204);
  assert.equal(await joinWith("9877100004", "203.0.113.24", { email: to }), 204);
  await settle();
  assert.equal(t.mails.filter((m) => m.to === to).length, 2);
  assert.equal((await rows("+919877100003")).length + (await rows("+919877100004")).length, 2);
});

const mailTo = (to: string) => t.mails.filter((x) => x.to === to);

test("a name that opens with a link, or hides behind a blank, is not greeted by name", async () => {
  const link = "link@example.com";
  assert.equal(await joinWith("9877100005", "203.0.113.25", { name: "www.evil.example/claim Riya", email: link }), 204);
  const blank = "blank@example.com";
  assert.equal(await joinWith("9877100006", "203.0.113.26", { name: "You⠀won Riya", email: blank }), 204);
  await settle();
  assert.equal(mailTo(link).length, 1);
  for (const x of [mailTo(link)[0]!.html, mailTo(link)[0]!.text]) {
    assert.ok(x.includes("You’re in."));
    assert.ok(!x.includes("evil.example"));
  }
  assert.equal(mailTo(blank).length, 1);
  for (const x of [mailTo(blank)[0]!.html, mailTo(blank)[0]!.text]) {
    assert.ok(x.includes("You’re in."));
    assert.ok(!x.includes("You’re in, "));
  }
});

test("a normal name is greeted by its first word, replies go to the contact address, no web fonts", async () => {
  const to = "meera@example.org";
  assert.equal(await joinWith("9877100007", "203.0.113.27", { name: "Meera Rao", email: to }), 204);
  await settle();
  const [m] = mailTo(to);
  assert.ok(m!.html.includes("You’re in, Meera.") && m!.text.includes("You’re in, Meera."));
  assert.equal(m!.replyTo, "hello@heyorbit.in");
  assert.ok(!m!.html.includes("fonts.googleapis.com"));
});

test("a welcome email that throws or rejects never fails the join", async () => {
  const { createApp } = await import("./app.ts");
  const sent: { to: Contact; code: string }[] = [];
  const failing: Mail[] = [
    () => {
      throw new Error("boom");
    },
    async () => {
      throw new Error("rejected");
    },
  ];
  for (const [i, mail] of failing.entries()) {
    const a = createApp({
      db: t.db,
      store: t.store,
      secret: "test-secret-that-is-at-least-32-characters",
      now: t.now,
      send: async (to, code) => void sent.push({ to, code }),
      notify: async () => {},
      mail,
    });
    const phone = `98771100${i}0`;
    const h = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${40 + i}` };
    t.tick(30_000);
    assert.equal((await a.request("/public/interest/code", { method: "POST", headers: h, body: JSON.stringify({ phone }) })).status, 200);
    const code = sent.filter((s) => s.to.kind === "phone" && s.to.e164 === `+91${phone}`).at(-1)!.code;
    const r = await a.request("/public/interest", { method: "POST", headers: h, body: JSON.stringify({ ...sign, phone, code }) });
    assert.equal(r.status, 204);
    await settle();
    assert.equal((await rows(`+91${phone}`)).length, 1);
  }
});

test("the welcome email keeps its dark-in-every-client scaffolding", () => {
  const { html } = welcomeEmail({ name: "Meera Rao", features: Object.keys(FEATURES).slice(0, 2) as Parameters<typeof welcomeEmail>[0]["features"] });
  for (const s of ['<body class="body', "u + .body .gs", "u + .body .gd", "[data-ogsc]", "linear-gradient(", 'name="color-scheme" content="dark"'])
    assert.ok(html.includes(s), s);
  assert.ok(html.includes('<span class="gd">You’re in, Meera.</span>'));
  assert.ok(html.includes("</span> <span"));
  assert.ok(!html.includes("</span></span></span><span"));
});
