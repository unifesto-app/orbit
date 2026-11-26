import { z } from "zod";
import { MAX_PER_BOOKING } from "./bookings.ts";

// Check-in at an event's door (X5; Orbit flows: Event day). A started seat on the event's host (Admin or Crew) scans a
// ticket's QR or types its 8-character code; a group ticket asks how many are here. The door is open from 24 hours
// before the start until 3 hours after the end.

// POST /hosts/:hostId/check-in/scan. `text`: the 32-character QR, or the code (spaces and dashes are dropped).
export const Scan = z.object({ eventId: z.uuid(), text: z.string().trim().min(1).max(64) });
export type Scan = z.infer<typeof Scan>;

// POST /hosts/:hostId/check-in/:bookingId/admit and /undo: how many are in now. Admit never lowers, undo never raises.
export const CheckInTotal = z.object({ total: z.number().int().min(0).max(MAX_PER_BOOKING) });
export type CheckInTotal = z.infer<typeof CheckInTotal>;

// A booking as the door sees it: never a contact.
export type DoorGuest = { id: string; name: string | null; quantity: number; admitted: number; checkedInAt: string | null };

// Every scan answers 200 with one of these. Refusals carry no guest, so a wrong or dead ticket tells the door nothing
// about whose it is.
export const SCAN_REFUSALS = ["wrongEvent", "cancelled", "early", "ended", "unknown"] as const;
export type ScanRefusal = (typeof SCAN_REFUSALS)[number];
export type ScanResult =
  | { result: "in"; guest: DoorGuest } // a ticket for one, now in
  | { result: "ask"; guest: DoorGuest } // a group ticket: ask "How many are here?", then admit
  | { result: "already"; guest: DoorGuest; by: string | null } // everyone on it is in; `by` is the first name of who let them in
  | { result: ScanRefusal; message: string };

// GET /hosts/:hostId/events/:eventId/guests?q=: confirmed bookings, and the counts (booked seats, how many are in).
export type DoorGuests = { guests: DoorGuest[]; booked: number; in: number };

// ---------- Galaxy (holders of Hosts) ----------

// GET /galaxy/check-in?page=: events whose door is open or that ended in the last 7 days.
export type CheckInEvent = { id: string; title: string; hostId: string; hostName: string; startsAt: string; endsAt: string; booked: number; in: number };
export type CheckInEvents = { events: CheckInEvent[]; total: number; page: number; pageSize: number };
// GET /galaxy/check-in/:eventId: the event and its checked-in bookings, `by` the name of who let them in.
export type CheckedIn = DoorGuest & { by: string | null };
export type CheckInEventPage = { event: CheckInEvent; guests: CheckedIn[] };
// POST /galaxy/check-in/:bookingId/undo: a risky action, so it takes a reason.
export const StaffUndo = CheckInTotal.extend({ reason: z.string().trim().min(3).max(500) });
export type StaffUndo = z.infer<typeof StaffUndo>;
