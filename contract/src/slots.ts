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
  pricePaise: z.number().int().min(100).max(10_000_000), // an hour, for one
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

// What the clients read.
const OffPeakRow = z.object({ from: z.number(), to: z.number(), weekdays: z.boolean(), pricePaise: z.number() });
// Desk and Admin: no money anywhere.
export const CounterStation = z.object({
  id: z.string(), name: z.string(), unit: z.string(), tile: StationTile, count: z.number(),
  whole: z.boolean(), step: z.union([z.literal(30), z.literal(60)]), archived: z.boolean(),
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
