import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { PHOTO_MAX_BYTES } from "@orbit/contract";
import { testApp } from "../testkit.ts";
import { users } from "../db/schema.ts";
import { runDeletions } from "./deletion.ts";

let t: Awaited<ReturnType<typeof testApp>>;
before(async () => (t = await testApp()));
after(() => t.close());

const device = { name: "iPhone", client: "app" as const };
const DAY = 24 * 60 * 60_000;
let n = 0;
const phone = () => `8${String(5_000_000 + ++n * 11).padStart(9, "0")}`;
const key = (to: string) => `+91${to}`;

type A = { p: string; access: string; device: string; me: { id: string } };
const join = async (): Promise<A> => {
  const p = phone();
  t.tick(30_000);
  assert.equal((await t.call("POST", "/auth/code", { to: p })).status, 200);
  const v = await t.call("POST", "/auth/code/verify", { to: p, code: t.lastCode(key(p)), device });
  const s = await t.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
  assert.equal(s.body.step, "signedIn");
  return { p, ...s.body } as A;
};
const as = (access: string) => (m: string, path: string, body?: unknown) => t.call(m, path, body, access);

const img = (w: number, h = w) => sharp({ create: { width: w, height: h, channels: 3, background: "#295EFF" } });
const upload = async (access: string | null, form: FormData) => {
  const res = await t.app.request("/me/photo", {
    method: "PUT",
    headers: { ...(access ? { authorization: `Bearer ${access}` } : {}), "x-forwarded-for": "203.0.113.7" },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const send = (access: string | null, bytes: Uint8Array, type = "image/jpeg") => {
  const form = new FormData();
  form.set("photo", new File([bytes as BlobPart], "p.jpg", { type }));
  return upload(access, form);
};
const photoOf = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!.photo;
const get = (link: string) => {
  const u = new URL(link);
  return t.app.request(u.pathname + u.search);
};

test("upload: square JPEG with EXIF is stored as a clean 1024 WebP and served", async () => {
  const a = await join();
  const jpg = await img(2000).withExif({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "17/1 22/1 0/1" } }).jpeg().toBuffer();
  assert.ok((await sharp(jpg).metadata()).exif);
  const r = await send(a.access, jpg);
  assert.equal(r.status, 200);
  assert.match(r.body.photo, new RegExp(`^https://api\\.test/media/users/${a.me.id}/[\\w-]{22}\\.webp$`));
  const res = await get(r.body.photo);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("cache-control"), "public, max-age=86400");
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  assert.equal(meta.exif, undefined);
  assert.equal((await as(a.access)("GET", "/me")).body.photo, r.body.photo);
  assert.equal(t.media.files.keys().filter((k) => k.includes(a.me.id)).length, 1);
});

test("replace (PNG, then a JPEG labelled text/plain) and remove", async () => {
  const a = await join();
  const mine = () => t.media.files.keys().filter((k) => k.includes(a.me.id));
  const first = (await send(a.access, await img(600).jpeg().toBuffer())).body.photo;
  const second = await send(a.access, await img(600).png().toBuffer(), "image/png");
  assert.equal(second.status, 200);
  assert.notEqual(second.body.photo, first);
  assert.equal(mine().length, 1);
  assert.equal((await get(first)).status, 404);
  assert.equal((await get(second.body.photo)).status, 200);
  const third = await send(a.access, await img(600).jpeg().toBuffer(), "text/plain");
  assert.equal(third.status, 200);
  assert.notEqual(third.body.photo, second.body.photo);
  assert.equal(mine().length, 1);
  assert.equal((await get(second.body.photo)).status, 404);

  const d = await as(a.access)("DELETE", "/me/photo");
  assert.equal(d.status, 200);
  assert.equal(d.body.photo, null);
  assert.equal(mine().length, 0);
  const again = await as(a.access)("DELETE", "/me/photo");
  assert.equal(again.status, 200);
  assert.equal(again.body.photo, null);
});

test("refusals change nothing", async () => {
  const a = await join();
  const ok = (await send(a.access, await img(500).jpeg().toBuffer())).body.photo;
  const keys = t.media.files.keys();
  const same = async () => {
    assert.deepEqual(t.media.files.keys(), keys);
    assert.equal(await photoOf(a.me.id), ok);
  };

  let r = await send(a.access, await img(1000, 800).jpeg().toBuffer());
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "notSquare");
  await same();

  r = await send(a.access, await img(300).gif().toBuffer());
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "notImage");
  await same();

  r = await send(a.access, new TextEncoder().encode("hello, not a picture"));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "notImage");
  await same();

  r = await send(a.access, new Uint8Array(PHOTO_MAX_BYTES + 1));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "tooBig");
  await same();

  const form = new FormData();
  form.set("other", "x");
  r = await upload(a.access, form);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid");
  await same();

  r = await send(null, await img(300).jpeg().toBuffer());
  assert.equal(r.status, 401);
  await same();
});

test("one account's upload and remove leave another's photo alone", async () => {
  const a = await join();
  const b = await join();
  const pa = (await send(a.access, await img(400).jpeg().toBuffer())).body.photo;
  const pb = (await send(b.access, await img(400).jpeg().toBuffer())).body.photo;
  await send(b.access, await img(400).png().toBuffer(), "image/png");
  await as(b.access)("DELETE", "/me/photo");
  assert.equal(await photoOf(a.me.id), pa);
  assert.equal((await get(pa)).status, 200);
  assert.equal((await get(pb)).status, 404);
});

test("media route: malformed or missing paths are 404", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const name = `${"a".repeat(22)}.webp`;
  for (const p of [`/media/users/not-a-uuid/x.webp`, `/media/other/${id}/${name}`, `/media/users/${id}/${name}`, `/media/hosts/${id}/short.webp`]) {
    assert.equal((await t.app.request(p)).status, 404, p);
  }
});

test("account deletion removes the photo file", async () => {
  const a = await join();
  await send(a.access, await img(400).jpeg().toBuffer());
  assert.ok(t.media.files.keys().some((k) => k.includes(a.me.id)));
  assert.equal((await as(a.access)("POST", "/me/deletion")).status, 200);
  t.tick(30 * DAY + 60_000);
  await runDeletions(t.db, async () => {}, t.now(), t.media);
  assert.equal(t.media.files.keys().filter((k) => k.includes(a.me.id)).length, 0); // other tests' files stay
});

// The cap is the middleware's, before the body is read: a body this big that isn't even a form would otherwise be 400.
test("a body far over the cap is refused before it's read", async () => {
  const a = await join();
  const res = await t.app.request("/me/photo", {
    method: "PUT",
    headers: { authorization: `Bearer ${a.access}`, "x-forwarded-for": "203.0.113.7", "content-type": "multipart/form-data; boundary=x" },
    body: new Uint8Array(6 * 1024 * 1024),
  });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as any).error, "tooBig");
  assert.equal(await photoOf(a.me.id), null);
});

test("two uploads at once leave one file, the one the account points at", async () => {
  const a = await join();
  const [x, y] = await Promise.all([send(a.access, await img(400).jpeg().toBuffer()), send(a.access, await img(500).png().toBuffer())]);
  assert.equal(x.status, 200);
  assert.equal(y.status, 200);
  const mine = t.media.files.keys().filter((k) => k.includes(a.me.id));
  assert.equal(mine.length, 1);
  assert.equal(await photoOf(a.me.id), `https://api.test/media/${mine[0]}`);
});

// The day-30 sweep scrubbed the row while this request was on its way: nothing goes onto the deleted account, and the
// new file doesn't stay behind.
test("an upload or remove landing after the account was deleted changes nothing", async () => {
  const a = await join();
  const first = await send(a.access, await img(300).jpeg().toBuffer());
  assert.equal(first.status, 200);
  await t.db.update(users).set({ deletedAt: new Date(t.now()) }).where(eq(users.id, a.me.id));
  const late = await send(a.access, await img(400).jpeg().toBuffer());
  assert.equal(late.status, 401);
  assert.equal(late.body.error, "signedOut");
  assert.equal((await as(a.access)("DELETE", "/me/photo")).status, 401);
  assert.deepEqual(t.media.files.keys().filter((k) => k.includes(a.me.id)), [first.body.photo.slice("https://api.test/media/".length)]);
  assert.equal(await photoOf(a.me.id), first.body.photo);
});

// Each query string would be its own Cloudflare cache entry, so its own bucket read: refused like a missing file.
test("a photo link with a query string is a 404", async () => {
  const a = await join();
  const r = await send(a.access, await img(300).jpeg().toBuffer());
  assert.equal((await get(r.body.photo)).status, 200);
  for (const q of ["?1", "?v=2", "?a=b&c=d"]) assert.equal((await get(r.body.photo + q)).status, 404, q);
});

test("without media: 503 notSetUp", async () => {
  const t2 = await testApp({ media: false });
  try {
    const p = phone();
    assert.equal((await t2.call("POST", "/auth/code", { to: p })).status, 200);
    const v = await t2.call("POST", "/auth/code/verify", { to: p, code: t2.lastCode(key(p)), device });
    const s = await t2.call("POST", "/auth/signup", { signup: v.body.signup, name: "Riya Kapoor", dob: "2000-05-01", device });
    const form = new FormData();
    form.set("photo", new File([await img(300).jpeg().toBuffer() as BlobPart], "p.jpg", { type: "image/jpeg" }));
    const res = await t2.app.request("/me/photo", { method: "PUT", headers: { authorization: `Bearer ${s.body.access}`, "x-forwarded-for": "203.0.113.7" }, body: form });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as any).error, "notSetUp");
  } finally {
    await t2.close();
  }
});
