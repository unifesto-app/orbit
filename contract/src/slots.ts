import { z } from "zod";
import { When } from "./events.ts";
import { Text } from "./text.ts";

// Play (Orbit flows: Play): a Venue's address and weekly hours, its stations and the claims on them, as the API sends
// them to Station's counter. Instants are ISO text with an offset; money is whole paise.

// First and last hour in India time; a last hour past 24 runs into the next morning (26 is 2 AM). The same check as
// Station's hoursOk.
export const Hours = z
  .tuple([z.number().int(), z.number().int()])
  .refine(([o, c]) => o >= 0 && o <= 23 && c > o && c - o <= 24 && c <= 30, "Hours must open before they close, within a day, by 6 AM.");
export type Hours = z.infer<typeof Hours>;

// Seven days, Sunday first; null is a closed day.
export const Week = z
  .array(Hours.nullable())
  .length(7)
  .refine((w) => w.every((h, i) => !h || !w[(i + 1) % 7] || h[1] - 24 <= w[(i + 1) % 7]![0]), "A day's late close runs into the next day's opening.");
export type Week = z.infer<typeof Week>;

// PUT /venues/:hostId. Landline numbers are fine: the desk's phone is often one.
export const VenueSetup = z.object({
  address: Text(1, 300),
  area: Text(1, 80),
  lat: z.number().min(6).max(37.5),
  lng: z.number().min(68).max(97.5),
  placeId: Text(1, 300).nullable().optional(),
  deskPhone: z.string().regex(/^\+?\d[\d\s-]{5,19}$/),
  week: Week,
  cutoffMinutes: z.number().int().min(0).max(1440).default(120), // up to how long before a start a player can cancel for the price back (Play 12)
  logsWalkIns: z.boolean().default(false),
});
export type VenueSetup = z.infer<typeof VenueSetup>;

// One cheaper window: from and to are hours (India time), on weekdays only or every day.
export const OffPeak = z
  .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24), weekdays: z.boolean(), pricePaise: z.number().int().positive() })
  .refine((o) => o.from < o.to, "Off-peak must end after it starts.");
export type OffPeak = z.infer<typeof OffPeak>;

const cheaper = (s: { pricePaise?: number; offPeak?: { pricePaise: number } | null }) =>
  s.pricePaise === undefined || !s.offPeak || s.offPeak.pricePaise < s.pricePaise;
const CHEAPER = "Off-peak is cheaper than the price an hour.";

const StationFields = {
  name: Text(1, 60),
  unit: Text(1, 30), // what one is called: "PC", "pitch"
  count: z.number().int().min(1).max(200),
  // An hour, for one. 0 is a free slot (booked with no payment); otherwise at least ₹1.
  pricePaise: z.union([z.literal(0), z.number().int().min(100).max(10_000_000)]),
  coopPaise: z.number().int().positive().nullable().optional(), // two or three on one (gaming)
  offPeak: OffPeak.nullable().optional(),
  games: Text(0, 300).nullable().optional(),
};
export const StationTile = z.enum(["gaming", "sports"]);
export type StationTile = z.infer<typeof StationTile>;

// POST /venues/:hostId/stations
export const NewStation = z.object({ ...StationFields, tile: StationTile }).refine(cheaper, { message: CHEAPER, path: ["offPeak"] });
export type NewStation = z.infer<typeof NewStation>;
// PATCH: any of them; the route checks off-peak against the stored price when only one side comes.
export const EditStation = z
  .object({ ...z.object(StationFields).partial().shape, archived: z.boolean().optional() })
  .refine(cheaper, { message: CHEAPER, path: ["offPeak"] });
export type EditStation = z.infer<typeof EditStation>;

export const WalkIn = z.object({ stationId: z.uuid(), hours: z.number().int().min(1).max(14), count: z.number().int().min(1).max(200) });
export type WalkIn = z.infer<typeof WalkIn>;
export const FreeOne = z.object({ stationId: z.uuid() });
export type FreeOne = z.infer<typeof FreeOne>;
export const NewBlock = z.object({
  stationId: z.uuid(),
  hours: z.number().int().min(1).max(14),
  count: z.number().int().min(1).max(200),
  why: Text(1, 120),
  start: When.optional(), // absent: from the current step
});
export type NewBlock = z.infer<typeof NewBlock>;
export const Admit = z.object({ total: z.number().int().min(0).max(200) });
export type Admit = z.infer<typeof Admit>;
// POST /venues/:hostId/holds: a player's hold on a slot while they pay (any signed-in person). The start is on the
// station's grid; the API checks that and the opening.
export const NewHold = z.object({
  stationId: z.uuid(),
  start: When,
  hours: z.number().int().min(1).max(24),
  count: z.number().int().min(1).max(100),
});
export type NewHold = z.infer<typeof NewHold>;

// What the clients read.
// A 404 on GET /venues/:hostId or its /day: a seat with no venue set up yet, or no seat at all (never on the team, or
// removed). Only the first is "set it up".
export const VENUE_GONE = { noVenue: "noVenue", notFound: "notFound" } as const;
export type VenueGone = (typeof VENUE_GONE)[keyof typeof VENUE_GONE];
const OffPeakRow = z.object({ from: z.number(), to: z.number(), weekdays: z.boolean(), pricePaise: z.number() });
// Desk and Admin: no money anywhere.
export const CounterStation = z.object({
  id: z.string(), name: z.string(), unit: z.string(), tile: StationTile, count: z.number(),
  whole: z.boolean(), step: z.union([z.literal(30), z.literal(60)]), archived: z.boolean(),
  // false: booked at ₹0, a hold confirmed, never paid for (no amount, so Desk still sees no money). Defaulted, as an API
  // from before X7 doesn't send it.
  charges: z.boolean().default(true),
});
export type CounterStation = z.infer<typeof CounterStation>;
export const StationRow = CounterStation.extend({
  pricePaise: z.number(), coopPaise: z.number().nullable(), offPeak: OffPeakRow.nullable(), games: z.string().nullable(),
});
export type StationRow = z.infer<typeof StationRow>;
export const VenueSettings = z.object({
  hostId: z.string(), address: z.string(), area: z.string(), lat: z.number(), lng: z.number(), placeId: z.string().nullable(),
  deskPhone: z.string(), week: Week, cutoffMinutes: z.number(), logsWalkIns: z.boolean(), stations: z.array(StationRow),
});
export type VenueSettings = z.infer<typeof VenueSettings>;

export const CLAIM_KINDS = ["booking", "walkin", "block"] as const;
export const CLAIM_STATUSES = ["held", "paid", "checked_in", "ended", "freed", "refunded", "released"] as const;
export const SlotClaim = z.object({
  id: z.string(), stationId: z.string(), kind: z.enum(CLAIM_KINDS), status: z.enum(CLAIM_STATUSES), count: z.number(),
  start: z.string(), end: z.string(), who: z.string().nullable(), why: z.string().nullable(), admitted: z.number(),
  checkedInAt: z.string().nullable(), checkedInBy: z.string().nullable(), releasedAt: z.string().nullable(),
  holdEndsAt: z.string().nullable().default(null), // a held booking's: when it lapses unless paid (or confirmed, when free); defaulted for an API from before X7
});
export type SlotClaim = z.infer<typeof SlotClaim>;
export const VenueDay = z.object({
  opening: z.object({ day: z.string(), opens: z.string(), closes: z.string(), state: z.enum(["before", "open", "after"]) }),
  logsWalkIns: z.boolean(),
  stations: z.array(CounterStation),
  claims: z.array(SlotClaim),
  free: z.record(z.string(), z.array(z.object({ at: z.string(), free: z.number() }))), // every 30 minutes, by station
});
export type VenueDay = z.infer<typeof VenueDay>;
// A booking standing in the way of a setup change (the 409's `bookings`).
export const InTheWay = z.object({ id: z.string(), stationId: z.string(), who: z.string().nullable(), count: z.number(), start: z.string(), end: z.string() });
export type InTheWay = z.infer<typeof InTheWay>;
// A hold, made: it lapses at holdEndsAt unless paid. Once confirmed (status "paid") it carries its ticket: qr and code,
// as an event booking's, and holdEndsAt is null.
export const SlotHold = z.object({
  id: z.string(), stationId: z.string(), start: z.string(), end: z.string(), count: z.number(), holdEndsAt: z.string().nullable(),
  status: z.enum(CLAIM_STATUSES), qr: z.string().nullable(), code: z.string().nullable(),
});
export type SlotHold = z.infer<typeof SlotHold>;

// POST /venues/:hostId/alerts: "Hear if it frees up" on a slot that's full for them now. One push, then it closes.
export const NewSlotAlert = NewHold;
export type NewSlotAlert = z.infer<typeof NewSlotAlert>;
export const SlotAlert = z.object({ id: z.string(), stationId: z.string(), start: z.string(), end: z.string(), count: z.number() });
export type SlotAlert = z.infer<typeof SlotAlert>;

// GET /public/venues/:hostId/slots?day=YYYY-MM-DD: a venue's free slots on one India day, for anyone. Per station, how
// many are free at every step of its grid still ahead, up to the last before closing (one step each, so not every
// listed step is a start: a booking needs every step it covers listed, as the app's startsFor reads it).
export const PublicSlots = z.object({
  day: z.string(), // YYYY-MM-DD
  opening: z.object({ opens: z.string(), closes: z.string() }).nullable(), // null: closed that day
  stations: z.array(StationRow.extend({ free: z.array(z.object({ at: z.string(), free: z.number() })) })),
});
export type PublicSlots = z.infer<typeof PublicSlots>;

// Galaxy's Slot holds: live holds (staff can release one) and the freed-slot alerts of the last 7 days.
export type StaffSlotHold = { id: string; hostId: string; venue: string; station: string; person: string | null; start: string; count: number; holdEndsAt: string; minutesLeft: number };
export type StaffSlotAlert = { id: string; venue: string; station: string; person: string | null; start: string; count: number; createdAt: string; sentAt: string | null; state: "waiting" | "sent" | "expired" };
export type StaffSlotHolds = { holds: StaffSlotHold[]; alerts: StaffSlotAlert[] };

// What a slot costs, in paise: each half hour at its own hourly rate, halved, for every station booked, so a 3:30 PM
// start is half off-peak; co-op is the co-op rate for one station shared by two. A pitch or court is one, booked whole.
// One function for the app's price and the API's charge. Times are epoch ms; off-peak hours are India time.
type Priced = { pricePaise: number; coopPaise?: number | null; offPeak?: { from: number; to: number; weekdays: boolean; pricePaise: number } | null };
const IST_MS = 330 * 60_000;
const offPeakAt = (s: Priced, at: number) => {
  if (!s.offPeak) return false;
  const d = new Date(at + IST_MS);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const weekday = d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  return hour >= s.offPeak.from && hour < s.offPeak.to && (!s.offPeak.weekdays || weekday);
};
export function slotPrice(s: Priced, start: number, hours: number, count = 1, coop = false): number {
  let total = 0;
  for (let h = 0; h < hours * 2; h++) {
    const at = start + h * 30 * 60_000;
    const rate = coop && s.coopPaise ? s.coopPaise : offPeakAt(s, at) ? s.offPeak!.pricePaise : s.pricePaise;
    total += (rate / 2) * (coop ? 1 : count);
  }
  return Math.round(total);
}
// GET /galaxy/venues (X9), for holders of Hosts: every Venue host, its venue row (null until Play Partner's setup saves
// one: "Setup pending") and its stations with the price an hour.
export type StaffVenue = {
  host: { id: string; name: string; city: string; status: "live" | "paused" | "suspended" | "archived"; createdAt: string };
  venue: { area: string; address: string; deskPhone: string } | null;
  stations: { id: string; name: string; unit: string; tile: StationTile; count: number; pricePaise: number; archived: boolean }[];
};
export type StaffVenues = { venues: StaffVenue[] };
