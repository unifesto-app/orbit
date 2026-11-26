import { z } from "zod";
import type { EventCard } from "./events.ts";

// Booking an event and the ticket it gives (Orbit flows: Booking and tickets; P10.1, P12.1). Free tiers only so far:
// paying in the app is the next slice.

export const BOOKING_STATUSES = ["confirmed", "cancelled", "cancelledByHost"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
// Where a booking came from (Booking d16). Never shown to the buyer, and never the client's to say: the API sets it.
export const BOOKING_SOURCES = ["orbit", "host", "other"] as const;

export const MAX_PER_BOOKING = 10; // never over 10 in one booking (Booking flow), less where the ticket type says

// POST /events/:id/book.
export const NewBooking = z.object({
  ticketTypeId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_PER_BOOKING),
});
export type NewBooking = z.infer<typeof NewBooking>;

// The 8-character code's alphabet: Crockford's, less 0 and 1, so nothing reads as O, I or L (no U either).
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

// A booking as its holder reads it. `qr`, `code` and `link` are null unless it's confirmed, and so is `onlineLink`,
// the event's private link, which only ever comes with a ticket.
export type Ticket = {
  id: string;
  status: BookingStatus;
  quantity: number; // how many it admits
  qr: string | null;
  code: string | null;
  link: string | null; // heyorbit.in/t/<link>
  createdAt: string;
  cancelledAt: string | null;
  ticketType: { id: string; name: string; pricePaise: number };
  event: EventCard;
  onlineLink: string | null;
};

// GET /me/tickets: upcoming (confirmed, until the event ends) soonest first; the rest, cancelled ones too, newest first.
export type MyTickets = { upcoming: Ticket[]; past: Ticket[] };
