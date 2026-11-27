import { z } from "zod";
import { categories, type CategorySlug } from "./categories.ts";
import { CityName } from "./roles.ts";
import type { EventPerson, PublicFestItem } from "./people.ts";
import { Text } from "./text.ts";

// Events and their ticket types (Orbit flows: Hosts, Discover): what a draft holds and what Admins edit.

export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export const EventStatus = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof EventStatus>;

// Public in discover and search, or reachable only by its link (Discover decision 10). A private host's events are all link-only.
export const EventVisibility = z.enum(["public", "link"]);
export type EventVisibility = z.infer<typeof EventVisibility>;

// The event's link, global across hosts: heyorbit.in/event/<slug>. Same rule as a host's, with room for a long title.
export const EventSlug = z
  .string()
  .min(3)
  .max(110)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, with no hyphen at either end");
export type EventSlug = z.infer<typeof EventSlug>;

// Built from categories.ts so the list changes in one place; the database keeps no list of its own.
export const EventCategory = z.enum(categories.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]]);
export type EventCategory = z.infer<typeof EventCategory>;

// An IANA name this runtime knows ("Asia/Kolkata"); India time unless the host changes it (Hosts flow, When).
export const TimeZone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Pick a time zone from the list");
export type TimeZone = z.infer<typeof TimeZone>;

// An instant with its offset, in years a plan could mean (Postgres refuses year 0 and the far end).
export const When = z.iso
  .datetime({ offset: true })
  .refine((s) => {
    const y = new Date(Date.parse(s)).getUTCFullYear();
    return y >= 2000 && y <= 2100;
  }, "Pick a date between 2000 and 2100");

// Where it happens. Orbit is India-only and `city` comes from the Indian city list, so coordinates must fall inside
// India's bounding box; this catches swapped or zeroed values, not every point at sea.
export const Place = z.object({
  venue: Text(1, 120),
  address: Text(1, 300),
  area: Text(1, 80), // the locality cards show: "Jubilee Hills"
  city: CityName,
  // Null when typed by hand with no place search (Event Partner): the event still matches by city name (Discover flow).
  lat: z.number().min(6).max(37.5).nullable().default(null),
  lng: z.number().min(68).max(97.5).nullable().default(null),
  placeId: Text(1, 300).nullable().optional(), // the place search's id; "At [venue]" is offered when it matches a Venue host's place
}).refine((p) => (p.lat === null) === (p.lng === null), { message: "Give both coordinates or neither", path: ["lng"] });
export type Place = z.infer<typeof Place>;

// One line of the day's schedule.
export const AgendaItem = z.object({ at: When, item: Text(1, 200) });
export type AgendaItem = z.infer<typeof AgendaItem>;

export const FaqItem = z.object({ q: Text(1, 200), a: Text(1, 2000) });
export type FaqItem = z.infer<typeof FaqItem>;

// The host's own terms, shown above Orbit's defaults.
const Terms = z.array(Text(1, 500)).max(20);

// ---------- Kind details: what a category's page shows beyond the basics (kind details plan) ----------

/** The kinds of fest a host can pick (outside the docs: the owner's to change). */
export const FEST_TYPES = ["College cultural fest", "College tech fest", "Music festival", "Food festival", "Sports fest", "Community fest"] as const;

// One flat object, every key optional: a category reads only its own keys (DETAIL_KEYS), so one stored for another
// category is kept but never shown. Hackathon fields are descriptive: nothing enforces team size or judging yet.
export const EventDetails = z
  .object({
    language: Text(1, 60), // comedy: "Hindi and English"
    seating: Text(1, 120),
    style: Text(1, 120), // jams: what's played
    bring: Text(1, 120),
    onSite: Text(1, 120), // what's there already
    teamMin: z.number().int().min(1).max(10),
    teamMax: z.number().int().min(1).max(10),
    tracks: z.array(z.object({ name: Text(1, 60), brief: Text(1, 200) })).max(8),
    prizes: z.array(z.object({ place: Text(1, 30), prize: Text(1, 120) })).max(10),
    rounds: z.array(z.object({ name: Text(1, 60), when: Text(1, 60) })).max(3),
    criteria: z.array(z.object({ name: Text(1, 60), weight: z.number().int().min(1).max(100) })).max(8),
    festType: z.enum(FEST_TYPES),
    highlights: z.array(Text(1, 120)).max(6),
  })
  .partial()
  .refine((d) => d.teamMin === undefined || d.teamMax === undefined || d.teamMin <= d.teamMax, { message: "The smallest team can't be bigger than the biggest", path: ["teamMax"] })
  .refine((d) => !d.criteria?.length || d.criteria.reduce((n, c) => n + c.weight, 0) === 100, { message: "The weights must add up to 100", path: ["criteria"] });
export type EventDetails = z.infer<typeof EventDetails>;

// Which keys each category shows; a category not listed shows none.
export const DETAIL_KEYS: Partial<Record<CategorySlug, readonly (keyof EventDetails)[]>> = {
  comedy: ["language", "seating"],
  jams: ["style", "bring", "onSite"],
  hackathons: ["teamMin", "teamMax", "tracks", "prizes", "rounds", "criteria"],
  fests: ["festType", "highlights"],
};

/** Only the category's own keys of what's stored. */
export function detailsFor(category: string | null, details: EventDetails): EventDetails {
  const keys = DETAIL_KEYS[category as CategorySlug] ?? [];
  return Object.fromEntries(keys.filter((k) => details[k] !== undefined).map((k) => [k, details[k]]));
}

/** "Name | brief" lines as pairs, split at the first bar; blank lines dropped, a line with no bar has an empty second. */
export const parseLines = (text: string): [string, string][] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf("|");
      return at < 0 ? [l, ""] : [l.slice(0, at).trim(), l.slice(at + 1).trim()];
    });
export const formatLines = (rows: [string, string | number][]) => rows.map(([a, b]) => `${a} | ${b}`).join("\n");

// Shown on the page only, any category (not checked at booking yet).
export const MinAge = z.union([z.literal(18), z.literal(21)]);
const kindFields = {
  details: EventDetails,
  inRoom: z.boolean(), // meetups only: checked-in guests can meet in the app
  minAge: MinAge.nullable(),
};

// PATCH /galaxy/events/:id/details: staff set the same three, any time.
export const EditEventDetails = z
  .object(kindFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Change at least one thing");
export type EditEventDetails = z.infer<typeof EditEventDetails>;

const endsAfterStart = (b: { startsAt?: string | null; endsAt?: string | null }) => !b.startsAt || !b.endsAt || Date.parse(b.endsAt) > Date.parse(b.startsAt);

// POST /hosts/:id/events: a draft starts from its name (Hosts flow).
export const NewEvent = z.object({ title: Text(1, 120) });
export type NewEvent = z.infer<typeof NewEvent>;

// PATCH /events/:id: Admins change any of these. Drafts save from their name on, so nothing else is required here;
// what publishing needs is checked at publish (H5.3). Null takes a draft's category or date back to "not yet".
export const EditEvent = z
  .object({
    title: Text(1, 120),
    slug: EventSlug, // changes only when the host edits it; the old link redirects
    category: EventCategory.nullable(),
    startsAt: When.nullable(),
    endsAt: When.nullable(),
    timezone: TimeZone,
    place: Place.nullable(),
    online: z.boolean(), // with a place it shows "Also online"; without one, "Online"
    // Private: shown only to people with a ticket. z.url passes a NUL through, which Postgres would refuse.
    onlineLink: z
      .url({ protocol: /^https$/ })
      .max(500)
      .refine((s) => !s.includes("\u0000"), "Remove the NUL character")
      .nullable(),
    visibility: EventVisibility,
    about: Text(1, 5000).nullable(), // plain text
    agenda: z.array(AgendaItem).max(30),
    faq: z.array(FaqItem).max(20),
    terms: Terms,
    // "What it's like" on the event's page, after its category (orbit-pm X13): a few short tags, trimmed, each once.
    vibes: z
      .array(Text(1, 24))
      .max(6)
      .transform((v) => v.filter((t, i) => v.findIndex((u) => u.toLowerCase() === t.toLowerCase()) === i)),
    ...kindFields, // a host can't change inRoom once it has started (api/src/events/rules.ts)
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Change at least one thing")
  .refine(endsAfterStart, { message: "The event must end after it starts", path: ["endsAt"] });
export type EditEvent = z.infer<typeof EditEvent>;

// ---------- What the API answers (plain types, like PublicHost: the input validators above aren't reused) ----------

const Iso = z.string(); // an ISO instant, as Date.toISOString writes it

// What the host's team reads, and what creating and editing return.
export const TeamEvent = z.object({
  id: z.uuid(),
  hostId: z.uuid(),
  slug: z.string(),
  status: EventStatus,
  visibility: EventVisibility,
  title: z.string(),
  category: z.string().nullable(),
  startsAt: Iso.nullable(),
  endsAt: Iso.nullable(),
  timezone: z.string(),
  place: z
    .object({
      venue: z.string(),
      address: z.string(),
      area: z.string(),
      city: z.string(),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      placeId: z.string().nullable(),
    })
    .nullable(),
  online: z.boolean(),
  onlineLink: z.string().nullable(),
  about: z.string().nullable(),
  agenda: z.array(z.object({ at: Iso, item: z.string() })),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  terms: z.array(z.string()),
  vibes: z.array(z.string()),
  details: EventDetails, // as stored, every key: the team's editor shows the category's own
  inRoom: z.boolean(),
  minAge: MinAge.nullable(),
  poster: z.string().nullable(), // the 3:4 link
  wide: z.string().nullable(), // the optional 4:3 link
  wideEdge: z.string().nullable(), // the 4:3's top row, #rrggbb
  tone: z.string().nullable(), // the shown image's dominant colour: the 4:3's, else the poster's
  publishedAt: Iso.nullable(),
  cancelledAt: Iso.nullable(),
  cancelReason: z.string().nullable(),
  saved: z.number().nullable(), // how many saved it, from 10 up, else null (Saved doc, P9.3); set on the team's own read only
  createdAt: Iso,
  updatedAt: Iso,
});
export type TeamEvent = z.infer<typeof TeamEvent>;

// One row in a host's list.
export const EventRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  status: EventStatus,
  visibility: EventVisibility,
  title: z.string(),
  category: z.string().nullable(),
  startsAt: Iso.nullable(),
  endsAt: Iso.nullable(),
  timezone: z.string(),
  area: z.string().nullable(),
  city: z.string().nullable(),
  online: z.boolean(),
  sold: z.number(), // confirmed tickets (each booking's quantity)
  checkedIn: z.number(), // of those, admitted at the door
});
export type EventRow = z.infer<typeof EventRow>;

// GET /hosts/:id/events: drafts, upcoming and past.
export const HostEvents = z.object({ drafts: z.array(EventRow), upcoming: z.array(EventRow), past: z.array(EventRow) });
export type HostEvents = z.infer<typeof HostEvents>;

const salesOpenBeforeClose = (b: { salesStartAt?: string | null; salesEndAt?: string | null }) =>
  !b.salesStartAt || !b.salesEndAt || Date.parse(b.salesEndAt) > Date.parse(b.salesStartAt);
const salesWindow = { message: "Sales must end after they start", path: ["salesEndAt"] };

// A kind of ticket. Amounts are whole paise: 0 is free, otherwise at least Rs 1 (Razorpay's minimum). The Rs 10 lakh
// ceiling is a sanity bound (a group ticket can pass Rs 1 lakh), not a product rule.
export const TicketTypeFields = z.object({
  name: Text(1, 60),
  pricePaise: z
    .number()
    .int()
    .min(0)
    .max(100_000_000)
    .refine((p) => p === 0 || p >= 100, "Paid tickets start at Rs 1"),
  quantity: z.number().int().min(1).max(100_000).nullable(), // null: no limit
  salesStartAt: When.nullable(),
  salesEndAt: When.nullable(),
  note: Text(1, 200).nullable(), // "One ticket covers four people"
  perPersonLimit: z.number().int().min(1).max(10), // most one person can book in a go (Booking flow, never over 10)
});
export type TicketTypeFields = z.infer<typeof TicketTypeFields>;

// Adding a ticket type: only a name and a price are needed; the rest left out means null (10 for the limit). Defaults live here, not on
// TicketTypeFields, so a partial edit doesn't fill in what it never mentioned.
export const NewTicketType = TicketTypeFields.extend({
  quantity: TicketTypeFields.shape.quantity.default(null),
  salesStartAt: TicketTypeFields.shape.salesStartAt.default(null),
  salesEndAt: TicketTypeFields.shape.salesEndAt.default(null),
  note: TicketTypeFields.shape.note.default(null),
  perPersonLimit: TicketTypeFields.shape.perPersonLimit.default(10),
}).refine(salesOpenBeforeClose, salesWindow);
export type NewTicketType = z.infer<typeof NewTicketType>;

export const EditTicketType = TicketTypeFields.partial()
  .refine((b) => Object.keys(b).length > 0, "Change at least one thing")
  .refine(salesOpenBeforeClose, salesWindow);
export type EditTicketType = z.infer<typeof EditTicketType>;

// A ticket type as the team reads it (H5.4).
export const TicketType = z.object({
  id: z.uuid(),
  name: z.string(),
  pricePaise: z.number(),
  quantity: z.number().nullable(),
  salesStartAt: Iso.nullable(),
  salesEndAt: Iso.nullable(),
  note: z.string().nullable(),
  perPersonLimit: z.number(),
  sortOrder: z.number(),
});
export type TicketType = z.infer<typeof TicketType>;

// POST /events/:id/cancel: the reason every ticket holder gets.
export const CancelEvent = z.object({ reason: Text(1, 500) });
export type CancelEvent = z.infer<typeof CancelEvent>;

// ---------- Galaxy: every host's events (staff with Hosts) ----------

// GET /galaxy/events?status=&host=&page=: newest first.
export type StaffEventRow = {
  id: string; slug: string; title: string; status: EventStatus; startsAt: string | null; city: string | null; createdAt: string;
  host: { id: string; name: string };
  sold: number; // confirmed tickets
};
export type StaffEvents = { events: StaffEventRow[]; total: number; page: number; pageSize: number };
// GET /galaxy/events/:id: the event as its team reads it, its host, each ticket type with its confirmed seats, and how
// many bookings it has ever had (Unpublish needs none).
export type StaffEvent = {
  event: Omit<TeamEvent, "onlineLink">; host: { id: string; name: string; slug: string };
  tickets: (TicketType & { sold: number })[]; bookings: number;
};

// What a draft still lacks at publish, one row each in Console with a fix button (H5.3).
export const PUBLISH_MISSING = ["poster", "when", "where", "category", "tickets"] as const;
export type PublishMissing = (typeof PUBLISH_MISSING)[number];

// PUT /events/:id/poster and /wide: the saved link and the colour of the image the page shows.
export type PosterSaved = { poster: string; tone: string };
export type WideSaved = { wide: string; wideEdge: string; tone: string };

// ---------- The public read (Discover flow) ----------

export type HostCard = { id: string; slug: string; name: string; kind: string; city: string | null; verified: boolean; logo: string | null };
export type TierCard = {
  id: string; name: string; pricePaise: number; quantity: number | null; left: number | null;
  salesStartAt: string | null; salesEndAt: string | null; note: string | null; perPersonLimit: number;
};
export type EventCard = {
  id: string; slug: string; title: string; category: string | null; startsAt: string; endsAt: string; timezone: string;
  publishedAt: string | null; status: "published" | "cancelled"; visibility: EventVisibility;
  place: { venue: string; address: string; area: string; city: string; lat: number | null; lng: number | null } | null;
  online: boolean; poster: string | null; wide: string | null; wideEdge: string | null; tone: string | null;
  pricePaise: number | null; // the lowest tier price; null with no tiers
  tiers: TierCard[]; host: HostCard; distanceKm: number | null; // only when a point was given
  inRoom: boolean; // a meetup whose checked-in guests can meet in the app; false on any other category
};
// `interested`: how many people tapped I'm interested (deleted and suspended accounts left out); `vibes`: its tags;
// `people`: who's on it, in order; `festItems`: what's inside a fest, empty for any other category (orbit-pm X14);
// `details`: its category's keys only; `teams`: confirmed bookings on a hackathon, null on any other category.
export type PublicEvent = EventCard & {
  about: string | null; agenda: { at: string; item: string }[]; faq: { q: string; a: string }[]; terms: string[];
  vibes: string[]; interested: number; people: EventPerson[]; festItems: PublicFestItem[];
  details: EventDetails; minAge: 18 | 21 | null; teams: number | null;
};

// ---------- Search's When chips (Discover decisions 7 and 8), shared by the app and the API ----------

export const WHEN = [
  { id: "today", label: "Today", phrase: "today" },
  { id: "weekend", label: "This weekend", phrase: "this weekend" },
  { id: "week", label: "Next 7 days", phrase: "in the next 7 days" },
] as const;
// Not `When`: that name is the instant above.
export type WhenChip = (typeof WHEN)[number]["id"];

export const MAX_QUERY = 100;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000; // India has one zone and no daylight saving

// [from, to) for a When chip. "This weekend" is Saturday and Sunday; on either day, what's left of it.
export function span(when: WhenChip, now: number): [number, number] {
  const today = Math.floor((now + IST) / DAY) * DAY - IST; // midnight in India
  if (when === "today") return [now, today + DAY];
  if (when === "week") return [now, now + 7 * DAY];
  const weekday = new Date(now + IST).getUTCDay(); // 0 Sunday … 6 Saturday
  if (weekday === 0) return [now, today + DAY];
  if (weekday === 6) return [now, today + 2 * DAY];
  return [today + (6 - weekday) * DAY, today + (8 - weekday) * DAY];
}
