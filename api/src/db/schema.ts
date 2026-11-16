import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// The User flow's tables (Orbit flows: User). Migrated people keep their Unifesto ids, so `id` takes any UUID.
// Phone and email are the ways in by code; Google, Apple and passkeys get their own tables in their own slices.

const at = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"), // null only on migrated and host-added accounts, until About you
  // E.164, +91 only. Null for migrated "+0" placeholders and after "Not me, start fresh" moved the number away.
  phone: text("phone").unique(),
  phoneVerifiedAt: at("phone_verified_at"),
  email: text("email").unique(), // lowercased; an invite placeholder's is unverified until a code proves it
  emailVerifiedAt: at("email_verified_at"),
  dob: date("dob", { mode: "string" }), // only support changes it after sign-up
  gender: text("gender"),
  photo: text("photo"),
  // Suspended until `suspendedUntil`, or for good when that is null. Set in Galaxy.
  suspendedAt: at("suspended_at"),
  suspendedUntil: at("suspended_until"),
  suspensionReason: text("suspension_reason"),
  // Account deletion: asked for at `deletionRequestedAt`, runs at `deletionDueAt` (30 days on) unless kept. Once run,
  // `deletedAt` is set and the person's details are scrubbed; the row stays for bookings and payments.
  deletionRequestedAt: at("deletion_requested_at"),
  deletionDueAt: at("deletion_due_at"),
  deletedAt: at("deleted_at"),
  // When "Is this you?" was last answered yes: a phone code opened the account on a device it hadn't used. For 7 days a
  // phone code alone can't remove or replace the account's other ways in (User flow, the recycled-SIM guard).
  newDevicePhoneAt: at("new_device_phone_at"),
  // Orbit's platform owner: every staff feature, can't be removed or suspended. Set once by the migration; no route
  // sets it, and at most one account holds it.
  platformOwner: boolean("platform_owner").notNull().default(false),
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("users_one_platform_owner").on(t.platformOwner).where(sql`${t.platformOwner}`)]);

// A host: whoever runs events (Orbit flows: Hosts). Live at once, unverified until staff verify it.
export const hosts = pgTable("hosts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // the name in lowercase with hyphens, plus a short random ending
  kind: text("kind").notNull(),
  city: text("city").notNull(),
  status: text("status", { enum: ["live", "paused", "suspended", "archived"] }).notNull().default("live"),
  // Suspended along with this account, its only Admin; lifting that account's suspension lifts the host's.
  suspendedWith: uuid("suspended_with").references(() => users.id),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  about: text("about"), // plain text
  website: text("website"), // https only
  // ponytail: logo and banner aren't editable yet; uploads are their own slice, and the Unifesto migration fills them.
  logo: text("logo"),
  banner: text("banner"),
  // Private: no public page, and its events are link-only (Hosts flow).
  visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("public"),
  verifiedAt: at("verified_at"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  // A club under a host, one level deep (Hosts decision 3). Nothing is inherited.
  parentId: uuid("parent_id").references((): AnyPgColumn => hosts.id),
  suspendReason: text("suspend_reason"), // what staff said, shown to the host's Admins
  liftTo: text("lift_to", { enum: ["live", "paused"] }), // where a staff lift returns a staff-suspended host
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
}, (t) => [index().on(t.parentId)]);

// Every slug a host has had, the current one included: old links keep working and nobody can take a host's old link.
export const hostSlugs = pgTable("host_slugs", {
  slug: text("slug").primaryKey(),
  hostId: uuid("host_id").notNull().references(() => hosts.id),
  createdAt: at("created_at").notNull().defaultNow(),
});

// Follow keeps a host and gives no role (Discover flow). Hosts that go private or off the air are hidden, never deleted.
export const follows = pgTable(
  "follows",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hostId: uuid("host_id").notNull().references(() => hosts.id),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.hostId] }), index().on(t.hostId)],
);

// A place on a host's team, from invite to end. Only Admin for now; event roles come with events.
// An invite is keyed by the phone or email it was sent to; no account is made for it. Rows end, never go, so who was
// on a team stays known (staff can't act on a host they left in the last 30 days).
export const teamRoles = pgTable(
  "team_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    role: text("role", { enum: ["admin"] }).notNull(),
    contact: text("contact").notNull(), // E.164 or lowercased email the invite went to
    userId: uuid("user_id").references(() => users.id), // set on Accept
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    addedAt: at("added_at").notNull(),
    acceptedAt: at("accepted_at"),
    startedAt: at("started_at"), // Admin starts once the adder confirms it's the right person
    endedAt: at("ended_at"),
    endedBy: uuid("ended_by").references(() => users.id),
    endReason: text("end_reason", { enum: ["withdrawn", "removed", "left", "expired", "deleted"] }),
  },
  (t) => [
    uniqueIndex("team_roles_one_open_per_contact").on(t.hostId, t.contact).where(sql`${t.endedAt} is null`),
    // One open place per person on a host, so removing them removes them.
    uniqueIndex("team_roles_one_open_per_person").on(t.hostId, t.userId).where(sql`${t.endedAt} is null and ${t.userId} is not null`),
    index().on(t.userId),
    index().on(t.contact),
  ],
);

// A staff feature given to someone. It counts from `startsAt`: set when a second holder of Staff confirms it, or 24
// hours after the platform owner adds it. Ended rows stay, for the audit trail.
export const staffGrants = pgTable(
  "staff_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    feature: text("feature", { enum: ["people", "hosts", "queues", "money", "platform", "staff"] }).notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => users.id),
    addedAt: at("added_at").notNull(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    startsAt: at("starts_at"),
    endedAt: at("ended_at"),
    endedBy: uuid("ended_by").references(() => users.id),
  },
  (t) => [uniqueIndex("staff_grants_one_open").on(t.userId, t.feature).where(sql`${t.endedAt} is null`)],
);

// Every staff action, and staff reads of personal data, written in the same step as the change. Kept 8 years.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(), // "people.suspend", "staff.grant", "people.search"
    targetUser: uuid("target_user").references(() => users.id),
    targetHost: uuid("target_host").references(() => hosts.id), // each host shows its own history (Galaxy flow)
    reason: text("reason"),
    data: jsonb("data"),
    at: at("at").notNull(),
  },
  (t) => [index().on(t.targetUser), index().on(t.targetHost), index().on(t.actorId)],
);

// One row per device an account signs in on (plan section 6). A sign-out ends the row but keeps it, so the device
// still counts as known and a phone code there skips "Is this you?". Each sign-in gives the row a new id, so tokens
// from before a sign-out never work again.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceHash: text("device_hash").notNull(), // sha256 of the device id the API issued; the id itself stays on the device
    client: text("client", { enum: ["app", "web"] }).notNull(),
    name: text("name").notNull(), // "iPhone", "Chrome on macOS"
    refreshHash: text("refresh_hash").notNull(), // sha256 of the token's part after the session id
    // Good for 60 s after `rotatedAt`, for refreshes at once, and after that until `acked` (sessions.ts, refresh).
    prevRefreshHash: text("prev_refresh_hash"),
    rotatedAt: at("rotated_at").notNull().defaultNow(),
    acked: boolean("acked").notNull().default(false), // an access token from the last rotation has been used
    // The last code (or, later, passkey) proved on this device, and which way in it used. Changing a sign-in method
    // needs one in the last 10 minutes.
    freshAt: at("fresh_at"),
    freshVia: text("fresh_via", { enum: ["phone", "email"] }),
    createdAt: at("created_at").notNull().defaultNow(),
    lastActiveAt: at("last_active_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    endedAt: at("ended_at"),
  },
  (t) => [unique().on(t.userId, t.deviceHash), index().on(t.deviceHash), index().on(t.userId).where(sql`${t.endedAt} is null`)],
);

// Every terms acceptance, with the version accepted. A legal record, migrated as it is.
export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    document: text("document").notNull(), // "terms"
    version: integer("version").notNull(),
    client: text("client").notNull(), // app, web
    acceptedAt: at("accepted_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.document, t.version)],
);
