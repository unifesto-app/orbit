import { z } from "zod";
import { allCities } from "./cities.ts";

// Roles (Orbit flows: Roles, settled 16 Nov 2026): a person's host teams and staff access, as the API sends them.

// Orbit's staff: one Staff role with access feature by feature. The platform owner holds every feature.
export const STAFF_FEATURES = ["people", "hosts", "queues", "money", "platform", "staff"] as const;
export const StaffFeature = z.enum(STAFF_FEATURES);
export type StaffFeature = z.infer<typeof StaffFeature>;

// Hosts (Orbit flows: Hosts, "Becoming a host"): start one with a name, a kind and a city from the city list.
export const HOST_KINDS = {
  "college-club": "College club",
  "comedy-group": "Comedy group",
  "jam-circle": "Jam circle",
  "cafe-meetup": "Café meetup",
  "startup-community": "Startup community",
  company: "Company",
  "housing-society": "Housing society",
  venue: "Venue",
  other: "Other",
} as const;
export const HostKind = z.enum(Object.keys(HOST_KINDS) as [keyof typeof HOST_KINDS, ...(keyof typeof HOST_KINDS)[]]);

// Only roles that have started: an invite not yet accepted, or an Admin not yet confirmed, adds nothing.
export const Team = z.object({
  hostId: z.string(),
  kind: z.string(), // a HostKind; plain text so an older app still reads a kind added later
  name: z.string(),
  owner: z.boolean(),
  admin: z.boolean(),
  desk: z.boolean(), // a Venue's counter seat: role crew with no event (Play: At the desk)
  events: z.record(z.string(), z.enum(["Curator", "Co-curator", "Crew"])), // empty until events exist
});
export type Team = z.infer<typeof Team>;
export const Staff = z.object({ owner: z.boolean(), features: z.array(StaffFeature), confirmed: z.boolean() });
export type Staff = z.infer<typeof Staff>;
export const Roles = z.object({ teams: z.array(Team), staff: Staff.nullable() });
export type Roles = z.infer<typeof Roles>;

// POST /hosts
export const CityName = z.string().refine((c) => allCities.some((x) => x.name === c), "Pick a city from the list");
export const StartHost = z.object({
  name: z.string().trim().min(1).max(100),
  kind: HostKind,
  city: CityName,
});

// POST /hosts/:id/team: a phone number or email, the same field as sign-in.
// `role: "desk"` is for a Venue's counter; absent means Admin.
export const InviteAdmin = z.object({ to: z.string().min(1).max(254), role: z.enum(["admin", "desk"]).optional() });

// Galaxy, People: suspending needs a reason; no `until` closes the account for good.
export const Suspend = z.object({ reason: z.string().trim().min(3).max(500), until: z.iso.datetime().nullable() });
export const Lift = z.object({ reason: z.string().trim().min(3).max(500) });

// Galaxy, Platform › Staff. Each is a risky action, so each takes a written reason (Galaxy flow).
const reason = z.string().trim().min(3).max(500);
export const GrantFeatures = z.object({ userId: z.uuid(), features: z.array(StaffFeature).min(1), reason });
export const StaffReason = z.object({ reason }); // confirming or taking away a feature
