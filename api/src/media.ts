import { randomBytes } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Hono } from "hono";
import { isSquare } from "@orbit/contract";
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

export type Kind = "users" | "hosts";
export const newKey = (kind: Kind, ownerId: string) => `${kind}/${ownerId}/${randomBytes(16).toString("base64url")}.webp`;
export const linkOf = (m: Media, key: string) => `${m.url}/${key}`;
// Only a link this API made is a file it may delete.
export const keyOf = (m: Media, link: string | null) => (link?.startsWith(`${m.url}/`) ? link.slice(m.url.length + 1) : null);

// The file a link points at is gone. A failure leaves one file behind, logged; it never fails the change it follows.
export const drop = async (m: Media, link: string | null) => {
  const key = keyOf(m, link);
  if (key) await m.files.remove(key).catch((e) => console.error(`[media] couldn't delete ${key}`, e));
};

const SIDE = 1024; // the most a photo or logo is kept at; Account draws it at 96 points
// A 5 MB PNG can unpack to a huge image. 40 million pixels (about 6300 square, a 48 MP phone photo cropped square)
// keeps one decode near 160 MB on the 4 GB box.
const MAX_PIXELS = 40_000_000;

// A JPG, PNG or WebP that is square, saved again as a WebP no bigger than 1024 × 1024. Saving it again drops the
// location and camera details a phone writes into it, and anything else that isn't the picture. The type comes from the
// bytes, never from what the upload says. Never cropped: a photo that isn't square is refused.
export async function squareImage(input: Uint8Array): Promise<{ bytes: Uint8Array } | { error: "notImage" | "notSquare" }> {
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
// its cache by the next day. Anything else is the same 404 as a missing file.
export function mediaRoutes(media: Media | undefined) {
  const app = new Hono();
  app.get("/media/:kind/:owner/:name", async (c) => {
    const { kind, owner, name } = c.req.param();
    const ok = (kind === "users" || kind === "hosts") && isUuid(owner) && /^[\w-]{22}\.webp$/.test(name);
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
