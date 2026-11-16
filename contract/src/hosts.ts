import { z } from "zod";
import { CityName, HostKind } from "./roles.ts";

// Hosts without events (Orbit flows: Hosts, Galaxy and Discover): the profile, its edits, and what the app and web read.

// The host's link: orbit.unifesto.app/h/<slug>.
export const HostSlug = z
  .string()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, with no hyphen at either end");

// PATCH /hosts/:id: Admins change any of these. Logo and banner come with uploads.
export const EditHost = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: HostSlug,
    kind: HostKind,
    city: CityName,
    about: z.string().max(2000).nullable(), // plain text
    website: z.url({ protocol: /^https$/ }).max(200).nullable(), // https only
    visibility: z.enum(["public", "private"]),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Change at least one thing");

// PUT /galaxy/hosts/:id/parent: make it a club of another host, or null to clear. A risky action, so a reason.
export const SetParent = z.object({ parentId: z.uuid().nullable(), reason: z.string().trim().min(3).max(500) });

// What anyone reads of a public, live host: GET /hosts/by-slug/:slug. The slug is the current one, so a client that
// came by an old link redirects. `followers` is null under 10 (Discover decision 16); `following` is null signed out.
const Link = z.object({ slug: z.string(), name: z.string() });
export const PublicHost = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: HostKind,
  city: z.string(),
  verified: z.boolean(),
  about: z.string().nullable(),
  website: z.string().nullable(),
  logo: z.string().nullable(),
  banner: z.string().nullable(),
  parent: Link.nullable(),
  clubs: z.array(Link),
  followers: z.number().nullable(),
  following: z.boolean().nullable(),
});
export type PublicHost = z.infer<typeof PublicHost>;

// The team's view: GET /hosts/:id and what PATCH returns.
export const HostPage = PublicHost.omit({ followers: true, following: true }).extend({
  status: z.enum(["live", "paused", "suspended", "archived"]),
  visibility: z.enum(["public", "private"]),
  suspendReason: z.string().nullable(),
  followers: z.number(),
  owner: z.boolean(), // the person reading is the owner
});
export type HostPage = z.infer<typeof HostPage>;
