import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AgendaItem, AutoMessages, BroadcastChannel, BroadcastSegment, EventDetails, FaqItem, PersonLink, RequestEvent, RequestHost, Week } from "@orbit/contract";

// The User flow's tables (Orbit flows: User). Migrated people keep their Unifesto ids, so `id` takes any UUID.
// Phone and email are the ways in by code; Google and Apple live in `identities`, passkeys in `passkeys`.

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
  city: text("city"), // for new events nearby: a name from @orbit/contract's allCities, never a Google place; seen by nobody else
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
  // The kinds of event they like (category slugs, GET/PUT /me/interests): null until picked or skipped, [] once skipped.
  interests: jsonb("interests").$type<string[]>(),
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
  liftTo: text("lift_to", { enum: ["live", "paused", "archived"] }), // where a staff lift returns a staff-suspended host
  // How Orbit's 5% fee splits (owner, 25 Nov 2026): 3% from the buyer + 2% from the host, or 5% from the buyer + 0%; the
  // host's Admins pick it (PATCH /hosts/:id), staff can set it in Galaxy Fees. `feeIncluded` (Galaxy Fees only) carves
  // the buyer fee out of the price instead of adding it. Each payment freezes both at sale.
  feePlan: text("fee_plan", { enum: ["3+2", "5+0"] }).notNull().default("3+2"),
  feeIncluded: boolean("fee_included").notNull().default(false),
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
    notify: text("notify", { enum: ["all", "off"] }).notNull().default("all"), // its new events: told, or not
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.hostId] }), index().on(t.hostId)],
);

// What a person saved and the lists they made (Saved events and lists doc). Private: nothing public reads these.
// An event that can't be opened any more (draft, host off the air) keeps its row, hidden by the reads, never deleted.
export const saves = pgTable(
  "saves",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    savedAt: at("saved_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] }), index().on(t.eventId)],
);

// I'm interested on an event's page (orbit-pm X13), apart from Save: its count is public, who never is.
export const eventInterests = pgTable(
  "event_interests",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    at: at("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] }), index().on(t.eventId)],
);

// The id is the app's own (`l_…`), so it can draw a new list before the API answers.
export const lists = pgTable(
  "lists",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    name: text("name").notNull(),
    touchedAt: at("touched_at").notNull().defaultNow(), // made, or last added to
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const listEvents = pgTable(
  "list_events",
  {
    userId: uuid("user_id").notNull(),
    listId: text("list_id").notNull(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.listId, t.eventId] }),
    index().on(t.eventId),
    foreignKey({ columns: [t.userId, t.listId], foreignColumns: [lists.userId, lists.id] }).onDelete("cascade"),
  ],
);

// A place on a host's team, from invite to end. Admin or crew; crew with no event on a Venue host is Desk (Play: the
// counter). Event roles come with events.
// An invite is keyed by the phone or email it was sent to; no account is made for it. Rows end, never go, so who was
// on a team stays known (staff can't act on a host they left in the last 30 days).
export const teamRoles = pgTable(
  "team_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    role: text("role", { enum: ["admin", "crew"] }).notNull(),
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

// ---------- Events (Orbit flows: Hosts, Discover): a host's event from draft to cancelled, and its ticket types ----------

// An event. Saved as a draft from its name on, so everything but the title is empty until the host fills it in; what
// publishing needs is checked at publish, not here. There's no unpublish: a published event is edited or cancelled. A
// draft, or a cancelled event with no money on it, can be deleted.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => hosts.id),
    slug: text("slug").notNull().unique(), // global: heyorbit.in/event/<slug>; the title plus 6 random characters, made at creation
    status: text("status", { enum: ["draft", "published", "cancelled"] }).notNull().default("draft"),
    // Public in discover, or reachable only by its link (Discover decision 10). A private host's events are all link-only.
    visibility: text("visibility", { enum: ["public", "link"] }).notNull().default("public"),
    title: text("title").notNull(),
    // A slug from @orbit/contract's categories. Null on a draft; checked in the contract like `hosts.kind`, with no
    // database list because the category list changes.
    category: text("category"),
    startsAt: at("starts_at"),
    endsAt: at("ends_at"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"), // India time unless the host changes it (Hosts flow)
    // The place. The contract needs all of it; the database is looser on purpose, since an event stored without
    // coordinates still matches by city name (Discover flow). Coordinates are for nearby search and the event-day window.
    venue: text("venue"),
    address: text("address"),
    area: text("area"), // the locality cards show: "Jubilee Hills"
    city: text("city"), // a name from @orbit/contract's allCities
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    placeId: text("place_id"), // the place search's id: "At [venue]" is offered when it matches a Venue host's place
    online: boolean("online").notNull().default(false), // alone it shows "Online"; with a venue, "Also online"
    onlineLink: text("online_link"), // private: comes with the ticket, never on the page; may be added after `online` is set
    // Images (Discover slice 1): the 3:4 poster, and an optional 4:3 the page shows instead; `wideEdge` is the 4:3's top
    // row as #rrggbb; each tone is the image's dominant colour, a card tint while it loads.
    poster: text("poster"),
    posterTone: text("poster_tone"),
    wide: text("wide"),
    wideEdge: text("wide_edge"),
    wideTone: text("wide_tone"),
    about: text("about"), // plain text
    agenda: jsonb("agenda").$type<AgendaItem[]>().notNull().default([]),
    faq: jsonb("faq").$type<FaqItem[]>().notNull().default([]),
    terms: jsonb("terms").$type<string[]>().notNull().default([]), // the host's own, shown above Orbit's defaults
    vibes: jsonb("vibes").$type<string[]>().notNull().default([]), // "What it's like" tags, after the category
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    publishedAt: at("published_at"), // when it first went live; later edits don't move it
    cancelledAt: at("cancelled_at"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"), // the host's reason, which every ticket holder gets
    // The host's switches for the automatic reminders to ticket holders (notifications PR 10).
    autoMessages: jsonb("auto_messages").$type<AutoMessages>().notNull().default({ tomorrow: true, startingSoon: true, thanks: true }),
    // What the category's page shows beyond the basics (@orbit/contract's EventDetails, checked there only), the meetup
    // switch letting checked-in guests meet in the app, and an age shown on the page (not checked at booking yet).
    details: jsonb("details").$type<EventDetails>().notNull().default({}),
    inRoom: boolean("in_room").notNull().default(false),
    minAge: integer("min_age").$type<18 | 21>(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("events_ends_after_starts", sql`${t.endsAt} is null or ${t.startsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    // The place is all or nothing; the point comes with a venue and sits inside India, as the contract's Place does.
    check("events_place_all_or_nothing", sql`(${t.venue} is null) = (${t.address} is null) and (${t.venue} is null) = (${t.area} is null) and (${t.venue} is null) = (${t.city} is null)`),
    check("events_point_both_or_neither", sql`(${t.lat} is null) = (${t.lng} is null)`),
    check("events_point_needs_venue", sql`${t.lat} is null or ${t.venue} is not null`),
    check("events_min_age", sql`${t.minAge} in (18, 21)`),
        check("events_point_in_india", sql`${t.lat} is null or (${t.lat} between 6 and 37.5 and ${t.lng} between 68 and 97.5)`),
    index().on(t.hostId, t.startsAt), // a host's events
    index().on(t.status, t.startsAt), // discover lists
    index().on(t.status, t.endsAt), // "upcoming" is until the end
  ],
);

// Every slug an event has had, the current one included: old links redirect to the current one (307) and are never
// given to another event.
export const eventSlugs = pgTable("event_slugs", {
  slug: text("slug").primaryKey(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  createdAt: at("created_at").notNull().defaultNow(),
});

// A kind of ticket on an event ("General", "Early bird"). Price is whole paise, 0 for free.
export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }), // deleting a draft takes its tiers; one with money on it is held by the bookings FK
    name: text("name").notNull(),
    pricePaise: integer("price_paise").notNull().default(0),
    quantity: integer("quantity"), // null: no limit
    salesStartAt: at("sales_start_at"),
    salesEndAt: at("sales_end_at"),
    note: text("note"), // "One ticket covers four people"
    perPersonLimit: integer("per_person_limit").notNull().default(10), // most one person can book in a go (Booking flow)
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("ticket_types_per_person_limit", sql`${t.perPersonLimit} between 1 and 10`),
    check("ticket_types_price_not_negative", sql`${t.pricePaise} >= 0`),
    check("ticket_types_quantity_positive", sql`${t.quantity} is null or ${t.quantity} > 0`),
    check("ticket_types_sales_end_after_start", sql`${t.salesEndAt} is null or ${t.salesStartAt} is null or ${t.salesEndAt} > ${t.salesStartAt}`),
    index().on(t.eventId),
  ],
);

// ---------- People on events and what's inside a fest (orbit-pm X14), set by staff in Galaxy ----------

// Someone on an event's page: a speaker, a guest, a judge. A name on a page, not an account; "persons", since Galaxy's
// People are accounts. ponytail: no photo column; the app draws a monogram until uploads come for people.
export const persons = pgTable("persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  headline: text("headline").notNull(),
  bio: text("bio"),
  links: jsonb("links").$type<PersonLink[]>().notNull().default([]), // up to 5, https (contract)
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

// Who's on an event, with their role there, in `position` order. A role belongs to the event: a judge at one can speak at another.
export const eventPeople = pgTable(
  "event_people",
  {
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.personId] }), index().on(t.personId), check("event_people_role_length", sql`char_length(${t.role}) between 1 and 30`)],
);

// One thing inside a fest: a competition, a performance, a workshop or the food. It comes with the fest's booking.
export const festItems = pgTable(
  "fest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: ["Competition", "Performance", "Workshop", "Food"] }).notNull(),
    when: text("when").notNull(), // "10:30 AM", "All day"
    where: text("where").notNull(),
    about: text("about").notNull(),
    team: text("team"),
    prize: text("prize"),
    actHostId: uuid("act_host_id").references(() => hosts.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.eventId, t.position)],
);

// ---------- Bookings (Orbit flows: Booking and tickets): one ticket type, one QR admitting `quantity` ----------

// A booking is its ticket (P12.1). `qr`, `code` (the 8 characters the crew types when a QR won't scan) and `link`
// (heyorbit.in/t/<link>) are random, unsigned and unique: scanners look them up. The link changes on a cancel (null).
// Rows stay for good, an account's deletion included (the user row stays too).
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id), // no cascade: a ticket type with bookings can't be deleted
    quantity: integer("quantity").notNull(),
    status: text("status", { enum: ["confirmed", "cancelled", "cancelledByHost"] }).notNull().default("confirmed"),
    source: text("source", { enum: ["orbit", "host", "other"] }).notNull().default("orbit"), // where it came from (Booking d16); never shown to the buyer
    qr: text("qr").notNull().unique(),
    code: text("code").notNull().unique(),
    link: text("link").unique(),
    createdAt: at("created_at").notNull().defaultNow(),
    cancelledAt: at("cancelled_at"),
    // Check-in (checkin.ts): how many of `quantity` are in, and the first admit's when and who. Attended is admitted > 0.
    admitted: integer("admitted").notNull().default(0),
    checkedInAt: at("checked_in_at"),
    checkedInBy: uuid("checked_in_by").references(() => users.id),
  },
  (t) => [
    check("bookings_quantity_range", sql`${t.quantity} between 1 and 10`),
    check("bookings_admitted_in_quantity", sql`${t.admitted} between 0 and ${t.quantity}`),
    index().on(t.userId, t.createdAt),
    index().on(t.ticketTypeId, t.status),
    index().on(t.eventId, t.status),
    // One live booking per person per ticket type (another type of the same event is a second booking, d12).
    uniqueIndex("bookings_one_live_per_type").on(t.userId, t.ticketTypeId).where(sql`${t.status} = 'confirmed'`),
  ],
);

// ---------- Play (Orbit flows: Play): a Venue's stations and every claim on them ----------

// One row per Venue host that takes bookings by the hour.
export const venues = pgTable(
  "venues",
  {
    hostId: uuid("host_id")
      .primaryKey()
      .references(() => hosts.id),
    address: text("address").notNull(),
    area: text("area").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    placeId: text("place_id"),
    deskPhone: text("desk_phone").notNull(),
    week: jsonb("week").$type<Week>().notNull(), // Sunday first; [first hour, last hour] in India time, past 24 runs into the morning; null is closed
    cutoffMinutes: integer("cutoff_minutes").notNull().default(120), // up to how long before a start a player can cancel for the price back (Play decision 12)
    logsWalkIns: boolean("logs_walk_ins").notNull().default(false),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("venues_cutoff_in_a_day", sql`${t.cutoffMinutes} between 0 and 1440`),
    check("venues_point_in_india", sql`${t.lat} between 6 and 37.5 and ${t.lng} between 68 and 97.5`),
  ],
);

// One row per station type ("Gaming PC", "5-a-side football"): booked by count, never a named machine.
export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => venues.hostId),
    name: text("name").notNull(),
    unit: text("unit").notNull(), // what one is called: "PC", "pitch"
    tile: text("tile", { enum: ["gaming", "sports"] }).notNull(),
    count: integer("count").notNull(),
    whole: boolean("whole").notNull(), // booked whole by one group: pitches and courts
    step: integer("step").notNull(), // minutes between starts
    pricePaise: integer("price_paise").notNull(), // an hour, for one
    coopPaise: integer("coop_paise"), // two or three on one (gaming)
    offPeakFrom: integer("off_peak_from"),
    offPeakTo: integer("off_peak_to"),
    offPeakWeekdays: boolean("off_peak_weekdays"),
    offPeakPaise: integer("off_peak_paise"),
    games: text("games"),
    archivedAt: at("archived_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("stations_count_range", sql`${t.count} between 1 and 200`),
    check("stations_step", sql`${t.step} in (30, 60)`),
    check("stations_price_not_negative", sql`${t.pricePaise} >= 0`), // 0: a free slot, booked with no payment
    check("stations_coop_positive", sql`${t.coopPaise} is null or ${t.coopPaise} > 0`),
    check(
      "stations_off_peak_all_or_nothing",
      sql`(${t.offPeakFrom} is null) = (${t.offPeakTo} is null) and (${t.offPeakFrom} is null) = (${t.offPeakWeekdays} is null) and (${t.offPeakFrom} is null) = (${t.offPeakPaise} is null)`,
    ),
    check(
      "stations_off_peak_sane",
      sql`${t.offPeakFrom} is null or (${t.offPeakFrom} >= 0 and ${t.offPeakFrom} < ${t.offPeakTo} and ${t.offPeakTo} <= 24 and ${t.offPeakPaise} < ${t.pricePaise})`,
    ),
    index().on(t.hostId),
  ],
);

// Every claim on a station type: a booking (held, then paid), a walk-in or a block.
export const stationClaims = pgTable(
  "station_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    kind: text("kind", { enum: ["booking", "walkin", "block"] }).notNull(),
    // - held: a player is paying; counts until hold_ends_at (10 minutes). Lapsing needs no job.
    // - paid: firm. A booking whose money landed (booking slice), or a block.
    // - checked_in: someone's here. A booking after the first admit, or a walk-in (they're at the counter).
    // - freed: a walk-in the desk freed early (the minus): ends_at moved to that moment, so it still counts up to then.
    // - ended: a block lifted early: ends_at moved to that moment, likewise.
    // - refunded, released (a no-show the desk let go): never count.
    // A claim takes `count` stations on [starts_at, ends_at) when status is paid, checked_in, freed or ended, or held
    // with hold_ends_at after now (slots/rules.ts `counts`, the one place that says so; pass the injected now).
    status: text("status", { enum: ["held", "paid", "checked_in", "ended", "freed", "refunded", "released"] }).notNull(),
    count: integer("count").notNull(),
    // No check that times sit on the step grid: a walk-in freed early ends "now", and the next may start then.
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    holdEndsAt: at("hold_ends_at"),
    userId: uuid("user_id").references(() => users.id), // a booking's person (holder, then booker); null for walk-ins and blocks
    reason: text("reason"), // a block's why
    admitted: integer("admitted").notNull().default(0),
    checkedInAt: at("checked_in_at"),
    checkedInBy: uuid("checked_in_by").references(() => users.id),
    releasedAt: at("released_at"),
    releasedBy: uuid("released_by").references(() => users.id),
    // A confirmed booking's ticket, as bookings' (32-character QR token, 8-character code): set on confirm only, null for
    // holds, walk-ins and blocks. Never logged.
    qr: text("qr").unique(),
    code: text("code").unique(),
    createdBy: uuid("created_by").references(() => users.id), // who added it at the counter, or the player for a hold
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("station_claims_count_positive", sql`${t.count} > 0`),
    check("station_claims_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    check("station_claims_held_has_end", sql`${t.status} <> 'held' or ${t.holdEndsAt} is not null`),
    check("station_claims_admitted_in_count", sql`${t.admitted} between 0 and ${t.count}`),
    index().on(t.stationId, t.startsAt),
    index().on(t.userId),
  ],
);

// "Hear if it frees up" (Play 18): a player asked about a slot that was full for them. The sweep (slots/alerts.ts)
// pushes once when it fits again and sets sent_at. Waiting: sent_at null and starts_at ahead; expired: sent_at null and
// starts_at passed (derived, no column).
export const slotAlerts = pgTable(
  "slot_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    count: integer("count").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    sentAt: at("sent_at"),
  },
  (t) => [
    check("slot_alerts_count_positive", sql`${t.count} > 0`),
    check("slot_alerts_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    uniqueIndex("slot_alerts_one_open").on(t.userId, t.stationId, t.startsAt).where(sql`${t.sentAt} is null`),
    index("slot_alerts_waiting").on(t.startsAt).where(sql`${t.sentAt} is null`),
    index().on(t.createdAt),
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
    // The last way in proved on this device, and which. Changing a sign-in method needs one in the last 10 minutes.
    freshAt: at("fresh_at"),
    freshVia: text("fresh_via", { enum: ["phone", "email", "google", "apple", "passkey"] }),
    // When the Google, Apple or passkey that made it fresh was added to the account: only one from before "Is this
    // you?" lifts the 7-day hold (security.ts, heldUntil). An email's is read off the account instead.
    freshSince: at("fresh_since"),
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

// ---------- The PM board (owner, 17 Nov 2026): Galaxy's /pm-board and Claude Code's "orbit-pm" (api/src/pm) ----------

// A workstream, keyed by a short code ("S", "P").
export const pmTracks = pgTable("pm_tracks", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: at("created_at").notNull().defaultNow(),
});

// A task, keyed by its own code ("P13"). Never deleted: DROPPED says it won't happen.
export const pmTasks = pgTable(
  "pm_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    trackKey: text("track_key")
      .notNull()
      .references(() => pmTracks.key),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["NEXT", "PLANNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "PARKED", "DROPPED"] })
      .notNull()
      .default("PLANNED"),
    owner: text("owner"), // free text: a person, or "Claude"
    dueDate: date("due_date", { mode: "string" }),
    sortOrder: integer("sort_order").notNull().default(0),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.trackKey, t.sortOrder), index().on(t.status)],
);

// A Claude Code token: "opm_" and 32 random bytes, kept only as its SHA-256. Made and revoked by the platform owner;
// it works only while the account that made it is still the platform owner.
export const pmTokens = pgTable("pm_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "laptop"
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  lastUsedAt: at("last_used_at"),
  revokedAt: at("revoked_at"),
  revokedBy: uuid("revoked_by").references(() => users.id),
  createdAt: at("created_at").notNull().defaultNow(),
});

// Every change to the board, and notes, append-only. `actor` is the shown name; the ids say who it really was.
export const pmActivity = pgTable(
  "pm_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => pmTasks.id),
    actor: text("actor").notNull(), // "Abhinavtej (Galaxy)", "Claude (laptop)"
    userId: uuid("user_id").references(() => users.id),
    tokenId: uuid("token_id").references(() => pmTokens.id),
    message: text("message").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.createdAt), index().on(t.taskId, t.createdAt)],
);

// Google and Apple, one of each per account (User flow, Sign-in methods). `subject` is the provider's own user id; the
// email is as the provider gave it, Apple's maybe a private relay address. Not matched to anything after linking.
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google", "apple"] }).notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    // Apple only: the refresh token its authorization code gave, revoked when Apple is removed or the account deleted
    // (Apple's rule for apps that offer account deletion). Null when Apple's key isn't set up.
    appleRefresh: text("apple_refresh"),
    createdAt: at("created_at").notNull().defaultNow(),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [unique().on(t.provider, t.subject), unique().on(t.userId, t.provider)],
);

// Passkeys (WebAuthn, RP ID heyorbit.in): each a way in, named after the device that made it.
export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(), // base64url, as the authenticator gave it
    publicKey: text("public_key").notNull(), // COSE key, base64url
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>(),
    name: text("name").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    lastUsedAt: at("last_used_at"),
  },
  (t) => [index().on(t.userId)],
);

// Prelaunch interest from the landing page (contract/src/prelaunch.ts): a name, a WhatsApp number a code proved, a
// date of birth and the features wanted, with what the visit said about itself. Rows from before 18 Nov 2026 hold an
// email only. Seen in Galaxy's Prelaunch by holders of People.
export const interest = pgTable("interest", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email"), // lowercased; where the welcome email went (the first waitlist's only field); not unique, as a family may share one
  name: text("name"),
  phone: text("phone").unique(), // +91…, proved by a WhatsApp code
  dob: date("dob", { mode: "string" }),
  features: jsonb("features").$type<string[]>(),
  ip: text("ip"), // the API's own read of the visitor's address (http.ts, clientIp)
  country: text("country"),
  region: text("region"),
  city: text("city"),
  userAgent: text("user_agent"),
  acceptLanguage: text("accept_language"),
  referrer: text("referrer"),
  utm: jsonb("utm").$type<Record<string, string>>(),
  timezone: text("timezone"),
  language: text("language"),
  screen: text("screen"),
  createdAt: at("created_at").notNull().defaultNow(),
});

// The site's own visit log (contract/src/visit.ts): one row per page view, keyed by the browser's view id. The visitor is
// a code from a salt that changes daily; no address is kept. Rows older than 180 days are deleted (server.ts).
export const visit = pgTable(
  "visit",
  {
    id: uuid("id").primaryKey(),
    at: at("at").notNull(),
    visitor: text("visitor").notNull(),
    path: text("path").notNull(),
    source: text("source").notNull(),
    app: text("app"),
    os: text("os"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    ms: integer("ms"),
    lcp: integer("lcp"),
    inp: integer("inp"),
    ttfb: integer("ttfb"),
    cls: doublePrecision("cls"),
    started: boolean("started").notNull().default(false),
    code: boolean("code").notNull().default(false),
    joined: boolean("joined").notNull().default(false),
    applied: boolean("applied").notNull().default(false), // a careers view the Apply form was sent from
  },
  (t) => [index("visit_at_idx").on(t.at)],
);

// The words in the app that Orbit itself writes (ad strips, help answers, chat chips), one row per list, edited in Galaxy's App content page. Lists and their shapes are in contract/src/content.ts.
export const appContent = pgTable("app_content", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: at("updated_at").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

// The activity log (contract/src/analytics.ts; owner, 19 Nov 2026: "user analytics, mau, dau etc"): one row per person
// per IST day per platform, from their signed-in requests (activity.ts, markActive). Kept 90 days (owner: "90 days"):
// older days are summed into activityDays and deleted (server.ts). Deleted with the account (auth/deletion.ts).
export const activity = pgTable(
  "activity",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day", { mode: "string" }).notNull(),
    platform: text("platform", { enum: ["ios", "android", "web", "app"] }).notNull(),
    version: text("version"), // the app's, "1.0.0"; none on the web or an older build
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.platform] }), index("activity_day_idx").on(t.day)],
);

// Each day's totals once its activity rows are swept, with no people in them, so long-term charts outlive the 90 days.
export const activityDays = pgTable("activity_days", {
  day: date("day", { mode: "string" }).primaryKey(),
  active: integer("active").notNull(), // distinct people that day
  ios: integer("ios").notNull(),
  android: integer("android").notNull(),
  web: integer("web").notNull(),
  app: integer("app").notNull(),
});

// Careers (contract/src/careers.ts; owner, 22 Nov 2026: "careers page at heyorbit.in/careers, link to galaxy", "Openings
// + applications"). `slug` is made from the first title and never changes, so a shared link never breaks.
export const openings = pgTable(
  "openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    team: text("team").notNull(),
    place: text("place").notNull(),
    kind: text("kind", { enum: ["full", "intern", "part", "contract"] }).notNull(),
    pay: text("pay"),
    about: text("about").notNull(),
    does: jsonb("does").$type<string[]>().notNull(),
    needs: jsonb("needs").$type<string[]>().notNull(),
    status: text("status", { enum: ["draft", "open", "closed"] }).notNull().default("draft"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [index("openings_status_idx").on(t.status)],
);

// One per person per opening. No cascade: an opening can be deleted only while nobody has applied (the key refuses it
// otherwise), so applications are never lost with it.
// The résumé is a private file (resumes/<opening>/<random>.pdf), never under /media; `ip` is kept for abuse only.
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openingId: uuid("opening_id").notNull().references(() => openings.id),
    name: text("name").notNull(),
    email: text("email").notNull(), // lowercased
    phone: text("phone"),
    linkedin: text("linkedin"),
    link: text("link"),
    note: text("note"),
    resumeKey: text("resume_key").notNull(),
    status: text("status", { enum: ["new", "reviewing", "shortlisted", "rejected", "hired"] }).notNull().default("new"),
    ip: text("ip"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [unique("applications_opening_email_uq").on(t.openingId, t.email), index("applications_opening_idx").on(t.openingId, t.createdAt)],
);

// Notifications (contract/src/notifications.ts; build plan approved 26 Nov 2026). The kinds are code; these hold what
// changes at run time and what was sent.

// A kind's channel switched off by staff (kind "*" is the whole channel). No row means on. Read from Galaxy's slice.
export const notificationSwitches = pgTable(
  "notification_switches",
  {
    kind: text("kind").notNull(),
    channel: text("channel", { enum: ["email", "push", "inbox"] }).notNull(),
    offBy: uuid("off_by").notNull().references(() => users.id),
    offAt: at("off_at").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.channel] })],
);

// Staff's rewording of a kind on one channel. Read from the templates slice.
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    kind: text("kind").notNull(),
    channel: text("channel", { enum: ["email", "push", "inbox"] }).notNull(),
    subject: text("subject"),
    title: text("title"),
    body: text("body").notNull(),
    updatedBy: uuid("updated_by").notNull().references(() => users.id),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.channel] })],
);

// What a person can find later in one app's inbox, written even when nothing interrupts them. Gone after 180 days
// (server.ts) and with the account on day 30 (auth/deletion.ts).
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    app: text("app", { enum: ["orbit", "launch", "station", "crew"] }).notNull(),
    kind: text("kind").notNull(),
    type: text("type").notNull(),
    fromName: text("from_name").notNull(), // "Orbit", or the host's name
    text: text("text").notNull(),
    picture: jsonb("picture"),
    opens: jsonb("opens"), // the app's Opens shape, e.g. {"to":"security"}
    dedupeKey: text("dedupe_key").notNull(),
    readAt: at("read_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("inbox_items_user_dedupe_uq").on(t.userId, t.dedupeKey),
    index("inbox_items_user_app_idx").on(t.userId, t.app, t.createdAt),
    index("inbox_items_created_idx").on(t.createdAt),
  ],
);

// The queue and the delivery log in one: a row per send on one channel to one address or device. The worker
// (notifications.ts) claims due rows; a skipped row is written on purpose, with its reason. Gone after 180 days.
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    contact: text("contact"), // the contact a notice was addressed to, when it was
    kind: text("kind").notNull(),
    channel: text("channel", { enum: ["email", "push", "inbox"] }).notNull(), // inbox: only a kill switch's skipped row
    target: text("target").notNull().default(""), // the email address; '' on a skipped row that has none
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "held", "sending", "sent", "delivered", "failed", "dropped", "skipped"] }).notNull(),
    reason: text("reason"),
    tries: integer("tries").notNull().default(0),
    runAt: at("run_at").notNull(),
    lockedUntil: at("locked_until"),
    providerId: text("provider_id"),
    broadcastId: uuid("broadcast_id").references((): AnyPgColumn => broadcasts.id, { onDelete: "set null" }),
    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, { onDelete: "set null" }),
    createdAt: at("created_at").notNull().defaultNow(),
    sentAt: at("sent_at"),
  },
  (t) => [
    unique("deliveries_dedupe_uq").on(t.dedupeKey, t.channel, t.target),
    index("deliveries_due_idx").on(t.runAt).where(sql`${t.status} in ('queued', 'held', 'sending')`),
    index("deliveries_user_idx").on(t.userId, t.createdAt),
    index("deliveries_created_idx").on(t.createdAt),
    index("deliveries_provider_idx").on(t.providerId).where(sql`${t.providerId} is not null`), // SES bounce lookups
  ],
);

// Addresses SES told us bounced for good or complained (ses-hook.ts), stored lower-case. Notification emails to them are
// skipped (notifications.ts); sign-in codes still go.
export const emailSuppressions = pgTable("email_suppressions", {
  address: text("address").primaryKey(),
  reason: text("reason", { enum: ["bounce", "complaint"] }).notNull(),
  at: at("at").notNull(),
});

// The person's notification settings. No row means every default (me-notifications.ts); `switches` holds only the keys
// that differ from theirs ("push.near", "email.follows").
export const notificationPrefs = pgTable("notification_prefs", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  push: boolean("push").notNull().default(true),
  switches: jsonb("switches").$type<Record<string, boolean>>().notNull().default({}),
  quiet: boolean("quiet").notNull().default(true), // quiet hours, 22:00 to 07:00 India time
  updatedAt: at("updated_at").notNull().defaultNow(),
});

// A sign-in's push token, one per session: a sign-out ends the session and so the device. A token lives on one row.
// Gone after 270 days unseen.
export const pushDevices = pgTable(
  "push_devices",
  {
    sessionId: uuid("session_id").primaryKey().references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    app: text("app", { enum: ["orbit", "launch", "station", "crew"] }).notNull(),
    platform: text("platform", { enum: ["ios", "android"] }).notNull(),
    env: text("env", { enum: ["sandbox", "production"] }).notNull(),
    token: text("token").notNull().unique(),
    seenAt: at("seen_at").notNull(),
  },
  (t) => [index().on(t.userId)],
);

// Event Requests (contract/src/requests.ts; Hosts flow H1.1–H1.7): asking to host, answered by staff. Approving makes
// the host and its draft event and keeps their ids here. Rows stay, so a person's past requests stay known.
export const eventRequests = pgTable(
  "event_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    status: text("status", { enum: ["open", "changes", "approved", "declined", "withdrawn"] }).notNull().default("open"),
    note: text("note"), // staff's, to the requester, on changes or decline
    host: jsonb("host").$type<RequestHost>().notNull(),
    event: jsonb("event").$type<RequestEvent>(),
    hostId: uuid("host_id").references(() => hosts.id),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }), // a draft may be deleted later
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: at("decided_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // One open request per person: open, or sent back for changes.
    uniqueIndex("event_requests_one_open_per_user").on(t.userId).where(sql`${t.status} in ('open', 'changes')`),
    index("event_requests_status_idx").on(t.status, t.createdAt),
    index("event_requests_user_idx").on(t.userId, t.createdAt),
  ],
);

// A host's message to an event's ticket holders (notifications PR 10): everyone, or those not yet checked in. At most 3
// a day per event, counted from these rows. Rows stay with their event.
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id),
    text: text("text").notNull(),
    audience: text("audience", { enum: ["everyone", "notCheckedIn"] }).notNull(),
    reached: integer("reached").notNull().default(0), // ticket holders at send time
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.eventId, t.createdAt)],
);

// ---------- Money (Orbit flows: Money; X2): Razorpay payments, refunds and payouts. Whole paise, always integers ----------

// One Razorpay order and the payment that lands on it, with the terms frozen at the moment it was made. `created` until
// money lands (verify, webhook or the poller all settle it once); `refundPending` when it landed but no seat could be
// given. `merchant`: which Razorpay account took it (a new company takes over later). Rows stay for good.
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["ticket", "slot"] }).notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    hostId: uuid("host_id").notNull().references(() => hosts.id),
    eventId: uuid("event_id").references(() => events.id),
    ticketTypeId: uuid("ticket_type_id").references(() => ticketTypes.id),
    claimId: uuid("claim_id").references(() => stationClaims.id),
    quantity: integer("quantity").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    plan: text("plan", { enum: ["3+2", "5+0"] }).notNull(),
    buyerFeeBps: integer("buyer_fee_bps").notNull(),
    buyerFeePaise: integer("buyer_fee_paise").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    commissionPaise: integer("commission_paise").notNull(),
    feeIncluded: boolean("fee_included").notNull(),
    gstFeePaise: integer("gst_fee_paise").notNull().default(0), // GST waits (Money decision 12)
    gstCommissionPaise: integer("gst_commission_paise").notNull().default(0),
    amountPaise: integer("amount_paise").notNull(), // what the buyer pays
    merchant: text("merchant").notNull().default("orbit"),
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    razorpayPaymentId: text("razorpay_payment_id").unique(),
    razorpayFeePaise: integer("razorpay_fee_paise"), // Razorpay's own fee and tax, once it reports them
    razorpayTaxPaise: integer("razorpay_tax_paise"),
    status: text("status", { enum: ["created", "paid", "refundPending", "refunded", "expired", "failed"] }).notNull().default("created"),
    bookingId: uuid("booking_id").references(() => bookings.id),
    // A slot payment that booked its claim (settle's success): the venue's sale. Paid twice or too late, it stays false.
    slotBooked: boolean("slot_booked").notNull().default(false),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    check("payments_amounts", sql`${t.amountPaise} > 0 and ${t.quantity} > 0 and ${t.unitPricePaise} > 0`),
    check("payments_status", sql`${t.status} in ('created', 'paid', 'refundPending', 'refunded', 'expired', 'failed')`),
    check("payments_plan", sql`${t.plan} in ('3+2', '5+0')`),
    // A ticket is for an event's ticket type; a slot for a Station claim.
    check(
      "payments_kind",
      sql`(${t.kind} = 'ticket' and ${t.eventId} is not null and ${t.ticketTypeId} is not null) or (${t.kind} = 'slot' and ${t.claimId} is not null)`,
    ),
    // One open order per person per ticket type: a second tap gets the same order ("You're already paying").
    uniqueIndex("payments_one_open_per_type").on(t.userId, t.ticketTypeId).where(sql`${t.status} = 'created'`),
    index().on(t.status, t.createdAt),
    index().on(t.hostId, t.createdAt),
    index().on(t.eventId),
  ],
);

// Money going back. The row is written first with its own id, which goes to Razorpay as the receipt, so a retry finds the
// refund it already made instead of sending twice. `razorpayPaymentId`: the Razorpay payment it refunds (a second payment
// on one order is refunded on its own).
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").notNull().references(() => payments.id),
    razorpayPaymentId: text("razorpay_payment_id").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    reason: text("reason").notNull(),
    kind: text("kind", { enum: ["auto", "staff", "request"] }).notNull(),
    status: text("status", { enum: ["requested", "sent", "processed", "failed"] }).notNull().default("requested"),
    razorpayRefundId: text("razorpay_refund_id").unique(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: at("next_attempt_at"), // null: not retried on its own (sent, done, or out of retries)
    by: uuid("by").references(() => users.id), // the staff member, for kind staff
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    check("refunds_amount_positive", sql`${t.amountPaise} > 0`),
    check("refunds_status", sql`${t.status} in ('requested', 'sent', 'processed', 'failed')`),
    check("refunds_kind", sql`${t.kind} in ('auto', 'staff', 'request')`),
    index().on(t.paymentId),
    index().on(t.status, t.nextAttemptAt),
  ],
);

// Bank transfers to hosts, by hand, each with its UTR once paid (6 to 40 characters, stored upper case, never reused).
// `eventId` null: a Venue's slot money, asked for as one (X4). `askedBy`: who asked, a host Admin (`fromHost`) or staff.
export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id").notNull().references(() => hosts.id),
    eventId: uuid("event_id").references(() => events.id),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status", { enum: ["requested", "paid", "cancelled"] }).notNull().default("requested"),
    utr: text("utr").unique(),
    reason: text("reason"),
    askedBy: uuid("asked_by").references(() => users.id),
    fromHost: boolean("from_host").notNull().default(false),
    by: uuid("by").notNull().references(() => users.id), // who last changed it
    at: at("at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    check("payouts_amount_positive", sql`${t.amountPaise} > 0`),
    check("payouts_utr", sql`${t.utr} is null or (length(${t.utr}) between 6 and 40 and ${t.utr} = upper(${t.utr}))`),
    check("payouts_status", sql`${t.status} in ('requested', 'paid', 'cancelled')`),
    index().on(t.eventId),
    index().on(t.hostId),
    index().on(t.hostId, t.createdAt),
  ],
);

// Where Orbit pays a host (Money flow, bank account): an account number and IFSC, or a UPI ID. It starts `checking`;
// staff check it by hand in Galaxy (no penny drop) and verify or reject it; a replacement starts checking again. The
// full number and UPI ID are for Galaxy's Money holders alone: never logged, never sent to the host apps, which see the
// bank's name and the last 4.
export const payoutAccounts = pgTable(
  "payout_accounts",
  {
    hostId: uuid("host_id")
      .primaryKey()
      .references(() => hosts.id),
    kind: text("kind", { enum: ["bank", "upi"] }).notNull(),
    holder: text("holder").notNull(),
    accountNumber: text("account_number"),
    ifsc: text("ifsc"),
    upi: text("upi"),
    bankName: text("bank_name").notNull(),
    last4: text("last4").notNull(),
    state: text("state", { enum: ["checking", "verified", "rejected"] }).notNull().default("checking"),
    reason: text("reason"), // staff's why, on a rejection
    checkedBy: uuid("checked_by").references(() => users.id),
    checkedAt: at("checked_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    check("payout_accounts_kind", sql`(${t.kind} = 'bank' and ${t.accountNumber} is not null and ${t.ifsc} is not null and ${t.upi} is null) or (${t.kind} = 'upi' and ${t.upi} is not null and ${t.accountNumber} is null and ${t.ifsc} is null)`),
    check("payout_accounts_state", sql`${t.state} in ('checking', 'verified', 'rejected')`),
  ],
);

// Every Razorpay webhook event we took, by Razorpay's event id: a repeat is a no-op. `handledAt` null: nothing to match yet
// (a refund we don't know), left for the poller.
export const razorpayEvents = pgTable("razorpay_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: at("received_at").notNull(),
  handledAt: at("handled_at"),
});

// Webhooks refused (a bad signature, a body we can't read), for Galaxy. `excerpt`: the event and ids only, never the body.
export const failedWebhooks = pgTable(
  "failed_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: at("received_at").notNull(),
    reason: text("reason").notNull(),
    excerpt: text("excerpt").notNull(),
  },
  (t) => [index().on(t.receivedAt)],
);

// A staff message to a segment (notifications build plan PR 9, broadcasts.ts). `cursor`: the last user id sent to, so a
// restart resumes after it; `sent` and `failed` count people.
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: ["news", "notice"] }).notNull(),
    segment: jsonb("segment").$type<BroadcastSegment>().notNull(),
    channels: jsonb("channels").$type<BroadcastChannel[]>().notNull(), // the inbox always
    content: jsonb("content").$type<{ title: string; text: string }>().notNull(),
    status: text("status", { enum: ["waiting", "scheduled", "sending", "sent", "cancelled"] }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    sendAt: at("send_at"),
    audienceCount: integer("audience_count").notNull().default(0),
    sent: integer("sent").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    cursor: uuid("cursor"),
    reason: text("reason"), // why it was cancelled
    autoAt: at("auto_at"), // when the author is the only Platform holder: when it moves on by itself (24 h on)
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index().on(t.status), index().on(t.createdAt)],
);

// Every Ask Orbit question and its reply (ask.ts), for Galaxy's log and cost per day. Tokens are what the model billed;
// `costMicroUsd` is them at the Ask Orbit model's prices (ASK_PRICES). An error row has no reply and no tokens. Deleted
// with the account (auth/deletion.ts).
export const askLog = pgTable(
  "ask_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    at: at("at").notNull(),
    question: text("question").notNull(),
    reply: text("reply"),
    status: text("status", { enum: ["ok", "refused", "error"] }).notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
  },
  (t) => [index().on(t.at), index().on(t.userId, t.at)],
);

// A person's report of an event or a host (X15, reports.ts): exactly one of the two. Staff with Queues resolve or
// dismiss it in Galaxy. Reports stay with their event or host, so neither can be deleted while one points at it.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    eventId: uuid("event_id").references(() => events.id),
    hostId: uuid("host_id").references(() => hosts.id),
    reason: text("reason", { enum: ["misleading", "scam", "unsafe", "offensive", "spam", "other"] }).notNull(),
    note: text("note"),
    status: text("status", { enum: ["open", "resolved", "dismissed"] }).notNull().default("open"),
    staffNote: text("staff_note"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: at("decided_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("reports_one_subject", sql`(${t.eventId} is null) <> (${t.hostId} is null)`),
    check("reports_status", sql`${t.status} in ('open', 'resolved', 'dismissed')`),
    index().on(t.status, t.createdAt),
    // One open report per person per subject: a second is answered with the first.
    uniqueIndex("reports_one_open_event").on(t.userId, t.eventId).where(sql`${t.status} = 'open' and ${t.eventId} is not null`),
    uniqueIndex("reports_one_open_host").on(t.userId, t.hostId).where(sql`${t.status} = 'open' and ${t.hostId} is not null`),
    index().on(t.eventId),
    index().on(t.hostId),
  ],
);

// Help and support (X16, support.ts): one thread per person per app at a time, from Help's Write to us. Staff with Queues
// read and answer them in Galaxy; a reply reaches the person as a supportReply notice. A thread that isn't closed takes
// the person's next message; once closed, the next one starts a new thread.
export const supportThreads = pgTable(
  "support_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    app: text("app", { enum: ["orbit", "launch", "station"] }).notNull(),
    status: text("status", { enum: ["open", "answered", "closed"] }).notNull().default("open"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(), // the last message
  },
  (t) => [
    check("support_threads_app", sql`${t.app} in ('orbit', 'launch', 'station')`),
    check("support_threads_status", sql`${t.status} in ('open', 'answered', 'closed')`),
    index().on(t.status, t.updatedAt),
    // One thread that isn't closed per person per app, even for two sends at once.
    uniqueIndex("support_threads_one_live").on(t.userId, t.app).where(sql`${t.status} <> 'closed'`),
  ],
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").notNull().references(() => supportThreads.id, { onDelete: "cascade" }),
    from: text("from", { enum: ["person", "staff"] }).notNull(),
    staffId: uuid("staff_id").references(() => users.id),
    body: text("body").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [check("support_messages_from", sql`${t.from} in ('person', 'staff')`), index().on(t.threadId, t.createdAt)],
);
