// The viewer's tickets from the Orbit API (api/src/bookings.ts; Booking and tickets doc, P10.1, P12.1, P12.2): the calls,
// the short "Tonight, 8:00 PM" line Home's ticket cards show, the plain status a cancelled one shows, and the copy of a
// ticket kept on the phone so its QR opens with no signal. Pure, so tickets.test.ts runs it on Node; the session
// (src/session.ts) keeps the list and the cache.
import type { BookingStatus, MyTickets, Ticket } from '@orbit/contract';

import type { makeApi } from './api.ts';
import { dayLabel, indiaMidnight, timeLabel } from './booking.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'authed'>;
export const ticketsApi = (api: Api) => ({
  mine: () => api.authed<MyTickets>('GET', '/me/tickets'),
  one: (id: string) => api.authed<Ticket>('GET', `/me/tickets/${id}`),
  // A free ticket type only, for now: the API answers paidLater for a paid one.
  book: (eventId: string, ticketTypeId: string, quantity: number) =>
    api.authed<Ticket>('POST', `/events/${eventId}/book`, { ticketTypeId, quantity }),
  cancel: (id: string) => api.authed<Ticket>('POST', `/me/tickets/${id}/cancel`),
});

const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/**
 * When a booked event starts, as Home's ticket card says it, India time: "On now" once it has started, "Today, 10:00 AM"
 * ("Tonight" from 5 PM), "Tomorrow, 8:30 AM", the weekday within the week ("Thu, 4:00 PM"), else the date ("Sat 21 Nov,
 * 6:00 PM").
 */
export function ticketLabel(startsAt: string, now: number): string {
  const at = Date.parse(startsAt);
  if (at <= now) return 'On now';
  const days = Math.round((indiaMidnight(at) - indiaMidnight(now)) / DAY);
  const time = timeLabel(at);
  const evening = (at - indiaMidnight(at)) / 3_600_000 >= 17;
  const day = days === 0 ? (evening ? 'Tonight' : 'Today') : days === 1 ? 'Tomorrow' : days < 7 ? WEEKDAYS[new Date(at + 330 * 60_000).getUTCDay()] : dayLabel(at);
  return `${day}, ${time}`;
}

/** A cancelled booking's plain status (Booking doc: "Cancelled shows as plain status text"); none while it's live. */
export const statusText = (s: BookingStatus) => (s === 'cancelledByHost' ? 'Cancelled by the host' : s === 'cancelled' ? 'Cancelled' : undefined);

/** Home's and the event page's tickets: the live ones still to come, with the card's line. */
export const upcomingOf = (m: MyTickets | null, now: number) =>
  (m?.upcoming ?? []).filter((t) => t.status === 'confirmed').map((t) => ({ id: t.id, eventId: t.event.id, label: ticketLabel(t.event.startsAt, now) }));

// The copy kept on the phone: one kv-store key per ticket, with the account it belongs to, so another account signed in
// on this phone never draws it (and sign-out clears them all, session.ts).
export const CACHE_PREFIX = 'orbit.ticket.';
export const cacheKey = (id: string) => `${CACHE_PREFIX}${id}`;
export const packTicket = (owner: string, t: Ticket) => JSON.stringify({ owner, t });
// What the phone kept for this account that's still to come (a confirmed ticket whose event hasn't ended), soonest
// first: the Tickets list, Home's stack and View ticket at a launch with no signal, until GET /me/tickets answers.
export function keptUpcoming(raws: readonly (string | null)[], owner: string, now: number): Ticket[] {
  return raws
    .map((r) => unpackTicket(r, owner))
    .filter((t): t is Ticket => !!t && t.status === 'confirmed' && Date.parse(t.event.endsAt) > now)
    .sort((a, b) => Date.parse(a.event.startsAt) - Date.parse(b.event.startsAt));
}
export function unpackTicket(raw: string | null, owner: string): Ticket | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    return v?.owner === owner && typeof v.t?.id === 'string' && v.t.event ? (v.t as Ticket) : null;
  } catch {
    return null;
  }
}

// Check-in (X5): `admitted` is how many on a ticket were let in at the door.
/** The ticket's line once anyone on it is in: "You’re in · 7:12 PM", "3 of 4 in · 7:12 PM", "All 4 in · 7:12 PM". */
export function checkInLine(t: Pick<Ticket, 'quantity' | 'admitted' | 'checkedInAt'>): string | undefined {
  if (!t.admitted) return undefined;
  const at = t.checkedInAt ? ` · ${timeLabel(Date.parse(t.checkedInAt))}` : '';
  if (t.quantity === 1) return `You’re in${at}`;
  return `${t.admitted < t.quantity ? `${t.admitted} of ${t.quantity}` : `All ${t.quantity}`} in${at}`;
}

const WEEK = 7 * DAY;
// Live tickets anyone was let in on (a cancelled one never counts). An event with no end reads NaN, so never "ended".
const attended = (m: MyTickets | null) => [...(m?.upcoming ?? []), ...(m?.past ?? [])].filter((t) => t.status === 'confirmed' && t.admitted > 0);
/** Thanks for coming: the events you were let in at that ended in the last week, newest first, two at most. */
export function thanksOf(m: MyTickets | null, now: number) {
  const went = attended(m).filter((t) => Date.parse(t.event.endsAt) <= now && now < Date.parse(t.event.endsAt) + WEEK);
  return [...new Map(went.map((t) => [t.event.id, t.event])).values()].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 2);
}

/** Whether you were let in at this event on any ticket: inRoom opens at the door. */
export const letInAt = (m: MyTickets | null, eventId: string) => attended(m).some((t) => t.event.id === eventId);
