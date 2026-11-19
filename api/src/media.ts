import { randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Hono } from "hono";
import { type ContentShape, isSquare, isStrip, mediaRatio } from "@orbit/contract";
import { fail, isUuid } from "./http.ts";

// Uploaded images (owner, 17 Nov 2026: a private S3 bucket, served by the API behind Cloudflare's cache). Keys are
// `<kind>/<owner id>/<random>.webp`: people's photos under users/, host logos under hosts/. Every upload gets a new key,
// so a cached copy is never stale, and the file it replaces is deleted, so nothing is left behind (User doc, Profile).
// A link works for anyone who has it; the random part is what keeps it private.

export type Files = {
  put(key: string, bytes: Uint8Array, type: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; type: string } | null>;
  remove(key: string): Promise<void>;
};
// `url` is where GET /media/... answers, such as https://api.heyorbit.in/media. The database keeps whole links.
export type Media = { files: Files; url: string };

export type Kind = "users" | "hosts" | "content";
export const newKey = (kind: Kind, ownerId: string) => `${kind}/${ownerId}/${randomBytes(16).toString("base64url")}.webp`;
export const linkOf = (m: Media, key: string) => `${m.url}/${key}`;
// Only a link this API made for this owner is a file it may delete: never another's, nor one from elsewhere.
const keyOf = (m: Media, link: string | null, kind: Kind, ownerId: string) => {
  const key = link?.startsWith(`${m.url}/`) ? link.slice(m.url.length + 1) : null;
  return key && new RegExp(`^${kind}/${ownerId}/[\\w-]{22}\\.webp$`).test(key) ? key : null;
};

// The file a link points at is gone. A failure leaves one file behind, logged; it never fails the change it follows.
export const drop = async (m: Media, link: string | null, kind: Kind, ownerId: string) => {
  const key = keyOf(m, link, kind, ownerId);
  if (key) await m.files.remove(key).catch((e) => console.error(`[media] couldn't delete ${key}`, e));
};

// An App content image (owner, 19 Nov 2026: "Ad strips image uplaod also instead of text", "also add custom ads in
// carousel"): any staff may replace another's, so the owner segment is the uploader and any uploader's file may go.
export const dropContent = async (m: Media, link: string | null) => {
  const key = link?.startsWith(`${m.url}/`) ? link.slice(m.url.length + 1) : null;
  if (key && /^content\/[0-9a-f-]{36}\/[\w-]{22}\.webp$/.test(key)) await m.files.remove(key).catch((e) => console.error(`[media] couldn't delete ${key}`, e));
};

const SIDE = 1024; // the most a photo or logo is kept at; Account draws it at 96 points
// A 5 MB PNG can unpack to a huge image. 40 million pixels (about 6300 square, a 48 MP phone photo cropped square)
// keeps one decode near 160 MB on the 4 GB box.
const MAX_PIXELS = 40_000_000;

// A JPG, PNG or WebP that is square, saved again as a WebP no bigger than 1024 × 1024. Saving it again drops the
// location and camera details a phone writes into it, and anything else that isn't the picture. The type comes from the
// bytes, never from what the upload says. Never cropped: a photo that isn't square is refused.
// One at a time across the whole API, so decodes never stack up on the box (orbit-api's memory limit counts on it).
// ponytail: one queue; a pool of two or three if uploads ever wait on each other.
type Square = { bytes: Uint8Array } | { error: "notImage" | "notSquare" };
let turn: Promise<unknown> = Promise.resolve();
export function squareImage(input: Uint8Array): Promise<Square> {
  const mine = turn.then(() => resave(input));
  turn = mine.catch(() => {}); // a failed one never holds up the next
  return mine;
}

async function resave(input: Uint8Array): Promise<Square> {
  // Loaded here, not at the top: a sharp that can't load on the server takes uploads down, not the whole API.
  const { default: sharp } = await import("sharp");
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "")) return { error: "notImage" };
    if (!isSquare(meta.width ?? 0, meta.height ?? 0)) return { error: "notSquare" };
    const out = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate() // upright by the photo's own orientation, which is then dropped with the rest
      .resize(SIDE, SIDE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out) };
  } catch {
    return { error: "notImage" }; // not an image, cut short, or too big to open
  }
}

// An App content image, in the shape it's for ("Allow 4.5:1 for ads"): a strip 4.5:1 or wide 4:3, never cropped, kept at
// most 1350 or 1200 wide. `edge` is the saved image's top row, averaged as #rrggbb: it fills the space above a slide
// while the image loads. Same queue as squareImage.
type Content = { bytes: Uint8Array; edge: string } | { error: "notImage" | "wrongShape" | "tooSmall" };
// The least an image may be wide, so a phone never stretches a thumbnail across the screen.
const MIN_WIDTH: Record<ContentShape, number> = { strip: 900, wide: 800 };
export function contentImage(input: Uint8Array, shape: ContentShape): Promise<Content> {
  const mine = turn.then(() => resaveContent(input, shape));
  turn = mine.catch(() => {});
  return mine;
}

async function resaveContent(input: Uint8Array, shape: ContentShape): Promise<Content> {
  const { default: sharp } = await import("sharp");
  try {
    const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "")) return { error: "notImage" };
    // Upright, as it's saved and shown: a phone photo can be stored sideways with an orientation tag.
    const { width: w = 0, height: h = 0 } = meta.autoOrient;
    if (!(shape === "strip" ? isStrip(w, h) : mediaRatio(w, h) === "4:3")) return { error: "wrongShape" };
    if (w < MIN_WIDTH[shape]) return { error: "tooSmall" };
    const out = await sharp(input, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(shape === "strip" ? 1350 : 1200, undefined, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const saved = await sharp(out).metadata();
    // On the app's Charcoal, as a see-through top row shows there. stats() reads its input, not the steps before it, so
    // the row is flattened to its own buffer first.
    const row = await sharp(out).extract({ left: 0, top: 0, width: saved.width!, height: 1 }).flatten({ background: "#121215" }).toBuffer();
    const { channels } = await sharp(row).stats();
    const edge = "#" + channels.slice(0, 3).map((c) => Math.round(c.mean).toString(16).padStart(2, "0")).join("");
    return { bytes: new Uint8Array(out), edge };
  } catch {
    return { error: "notImage" };
  }
}

// Local runs and tests. Lost on restart.
export function memoryFiles(): Files & { keys(): string[] } {
  const all = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    put: async (key, bytes, type) => void all.set(key, { bytes, type }),
    get: async (key) => all.get(key) ?? null,
    remove: async (key) => void all.delete(key),
    keys: () => [...all.keys()],
  };
}

// The bucket, with the server's own AWS credentials (the orbit-box role). The role needs s3:ListBucket on the bucket as
// well as get, put and delete on its objects: without it S3 answers a missing file with "access denied", not "no such key".
export function s3Files(bucket: string, region: string): Files {
  const s3 = new S3Client({ region });
  return {
    put: async (key, bytes, type) => void (await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type }))),
    get: async (key) => {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: await r.Body!.transformToByteArray(), type: r.ContentType ?? "application/octet-stream" };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    remove: async (key) => void (await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))),
  };
}

// GET /media/<kind>/<owner id>/<name>.webp, for anyone. Cloudflare keeps each for a day, so a removed photo is gone from
// its cache by the next day. Anything else, a query string included, is the same 404 as a missing file.
export function mediaRoutes(media: Media | undefined) {
  const app = new Hono();
  app.get("/media/:kind/:owner/:name", async (c) => {
    const { kind, owner, name } = c.req.param();
    // No query string: Cloudflare would keep a copy per string, each first one a bucket read and a transfer from the box.
    const ok = !new URL(c.req.url).search && (kind === "users" || kind === "hosts" || kind === "content") && isUuid(owner) && /^[\w-]{22}\.webp$/.test(name);
    const file = ok && media ? await media.files.get(`${kind}/${owner}/${name}`) : null;
    if (!file) return fail(c, 404, "notFound", "There's nothing here.");
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": file.type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    });
  });
  return app;
}
