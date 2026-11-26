// Booking a slot at a real place to play, on the Orbit API (api/src/slots/routes.ts, X7): a venue's free starts for
// anyone, then, signed in, hold → confirm (a ₹0 slot) or pay (a priced one, X2), let go, and "Hear if it frees up".
// Pure, so slots.test.ts runs it on Node; the Book a slot sheet (src/app/slot/[venue].tsx) draws it.
import type { ApiError, NewHold, NewSlotAlert, PayOrder, PublicSlots, SlotAlert, SlotHold, Verified } from '@orbit/contract';

import type { makeApi, Result } from './api.ts';
import { dayLabel, holdLeft } from './booking.ts';
import { PAY_SAYS, paidNext, paymentsApi } from './pay.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'call' | 'authed'>;
export const slotsApi = (api: Api) => ({
  // One India day (YYYY-MM-DD); none: the opening now, or the next.
  publicSlots: (hostId: string, day?: string) => api.call<PublicSlots>('GET', `/public/venues/${hostId}/slots${day ? `?day=${day}` : ''}`),
  hold: (hostId: string, b: NewHold) => api.authed<SlotHold>('POST', `/venues/${hostId}/holds`, b),
  // A priced hold's Razorpay order (the open one again with `already`), paid through payForHold.
  pay: (hostId: string, claimId: string) => api.authed<PayOrder>('POST', `/venues/${hostId}/holds/${claimId}/pay`),
  // A ₹0 hold becomes a booking with its code (a priced one answers 402 paymentNeeded until it's paid; a paid one, its code).
  confirm: (hostId: string, claimId: string) => api.authed<SlotHold>('POST', `/venues/${hostId}/holds/${claimId}/confirm`),
  letGo: (hostId: string, claimId: string) => api.authed<null>('DELETE', `/venues/${hostId}/holds/${claimId}`),
  // A paid slot given up before it starts, nobody checked in: the price comes back, Orbit's fee stays.
  cancel: (hostId: string, claimId: string) => api.authed<{ refundPaise: number }>('POST', `/venues/${hostId}/holds/${claimId}/cancel`),
  askAlert: (hostId: string, b: NewSlotAlert) => api.authed<SlotAlert>('POST', `/venues/${hostId}/alerts`, b),
  dropAlert: (hostId: string, alertId: string) => api.authed<null>('DELETE', `/venues/${hostId}/alerts/${alertId}`),
});

// Paying for a priced hold: the API's order for it (POST …/pay, the amount and fee its own), Razorpay's checkout
// (`open`, the sheet's: the native module can't load here), then the API's word on the payment as the event checkout
// asks it (verify when checkout says paid, the order's status when it closed). Settled paid, the hold is booked on the
// server already; the free confirm route hands back its code.
export const PAYS = true;
export type Opened = { paid: { id: string; signature: string } } | { closed: 'dismissed' | 'failed' };
/** Booked; nothing taken (`no`: Pay again is safe); or money may have gone (`confirming`: never reopen checkout, keep
 * the hold, ask the order's status until it settles). */
export type Paid = { booked: SlotHold } | { no: string } | { confirming: string; orderId: string };
export async function payForHold(
  api: Api,
  hostId: string,
  claimId: string,
  open: (o: PayOrder) => Promise<Opened>,
): Promise<Paid> {
  const o = await slotsApi(api).pay(hostId, claimId);
  if (!o.ok) {
    // Paid already (an earlier try settled): the code is there for the asking.
    if (o.status === 409 && o.error.error === 'booked') return codeOf(api, hostId, claimId, null);
    return { no: o.status === 503 && o.error.error === 'paymentsOff' ? PAY_SAYS.off : slotMessage(o.error) };
  }
  const got = await open(o.data);
  const pays = paymentsApi(api);
  const v = 'paid' in got ? await pays.verify(o.data.orderId, got.paid.id, got.paid.signature) : await pays.status(o.data.orderId);
  return payWord(api, hostId, claimId, o.data.orderId, v, 'closed' in got ? got.closed : undefined);
}
/** The API's word on a slot payment (verify's, or the order's status; `closed`: checkout closed without paying), as
 * paidNext reads it for tickets, but a paid slot's code comes from the confirm route. */
export async function payWord(api: Api, hostId: string, claimId: string, orderId: string, v: Result<Verified>, closed?: 'dismissed' | 'failed'): Promise<Paid> {
  const wait: Paid = { confirming: SLOT_PAID, orderId };
  if (v.ok && v.data.status === 'paid') return codeOf(api, hostId, claimId, wait);
  if (v.ok && (v.data.status === 'refundPending' || v.data.status === 'refunded')) return { no: slotRefund(v.data.reason) };
  const n = paidNext(v, closed);
  return n.next === 'again' ? { no: n.say } : wait;
}
async function codeOf(api: Api, hostId: string, claimId: string, wait: Paid | null): Promise<Paid> {
  const c = await slotsApi(api).confirm(hostId, claimId);
  return c.ok ? { booked: c.data } : (wait ?? { no: SLOT_PAID });
}
const SLOT_PAID = 'We’re confirming your payment. Your slot shows here within a few minutes.';
/** Why a slot payment went back with no booking (settle's reason, confirmHold's code). */
export function slotRefund(reason?: string): string {
  if (reason === 'full') return 'That time filled up while you were paying. We’ve refunded you in full.';
  if (reason === 'booked') return 'That slot was already yours, so we’ve refunded this payment in full.';
  if (reason === 'notHeld' || reason === 'notFound') return 'Your hold ran out before the payment came through. We’ve refunded you in full.';
  return 'We couldn’t book that slot, so we’ve refunded you in full.';
}

// What the player reads for each refusal; anything else, the API's own words.
const SAYS: Record<string, string> = {
  full: 'That time just filled up. Pick another, or hear if it frees up.',
  letGo: 'You let that hold go. Hold it again.',
  notHeld: 'That hold can’t be booked any more. Hold it again.',
  badTime: 'That time can’t be booked any more. Pick another.',
  badCount: 'Pick how many.',
  badDay: 'Pick a day in the next two weeks.',
  notFull: 'That time is free again. Hold it now.',
  hostClosed: 'This place isn’t taking bookings right now.',
  notFound: 'This place isn’t taking bookings on Orbit.',
};
export const slotMessage = (e: ApiError) => SAYS[e.error] ?? e.message;

/** A confirm's answer: booked (with its code), to pay (its total, paise), or why not. */
export function confirmed(r: Result<SlotHold>): { booked: SlotHold } | { pay: number } | { no: string } {
  if (r.ok) return { booked: r.data };
  if (r.status === 402 && r.error.error === 'paymentNeeded') return { pay: Number((r.error as { totalPaise?: unknown }).totalPaise) || 0 };
  return { no: slotMessage(r.error) };
}

const MIN = 60_000;
const DAY = 24 * MIN * 60;
const IST = 330 * MIN;
/**
 * The 14 days a slot can be booked on, from the API's first (YYYY-MM-DD). Today and Tomorrow are the phone's India
 * date's, not positions: after midnight a café still open from yesterday has yesterday's date first.
 */
export function slotDays(first: string, now: number): { day: string; label: string }[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = ymd(now + IST);
  const tomorrow = ymd(now + IST + DAY);
  return Array.from({ length: 14 }, (_, i) => {
    const day = ymd(start + i * DAY);
    return { day, label: day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : dayLabel(Date.parse(`${day}T00:00:00+05:30`)) };
  });
}

/**
 * The starts a booking of `hours` can take on one station: every start whose steps (30 or 60 minutes) are all still on
 * the API's list, so it ends by closing, with the fewest free across them.
 */
export function startsFor(s: { step: number; free: readonly { at: string; free: number }[] }, hours: number): { at: number; free: number }[] {
  const by = new Map(s.free.map((f) => [Date.parse(f.at), f.free]));
  const steps = (hours * 60) / s.step;
  return s.free.flatMap((f) => {
    const at = Date.parse(f.at);
    let free = Infinity;
    for (let i = 0; i < steps; i++) {
      const n = by.get(at + i * s.step * MIN);
      if (n === undefined) return [];
      free = Math.min(free, n);
    }
    return [{ at, free }];
  });
}

// The sheet's hold, as it moves (src/app/slot/[venue].tsx). The countdown runs from when the hold's answer arrived
// (`heldAt`, the phone's clock) for the API's 10 minutes (hold.ts HOLD_MINUTES = booking.ts HOLD_MS), so a phone clock
// that's off doesn't cut it short or stretch it. While a call is out (`busy`) a new pick is ignored; so is one while
// money may have gone (`paying`, the order being confirmed): the hold stays, never let go, until the API settles it.
export type HoldSheet = { held: SlotHold | null; heldAt: number; booked: SlotHold | null; busy: boolean; said: string | null; asked: boolean; paying: string | null };
export const NO_HOLD: HoldSheet = { held: null, heldAt: 0, booked: null, busy: false, said: null, asked: false, paying: null };
export type HoldStep =
  | { t: 'busy' }
  | { t: 'done' }
  | { t: 'held'; hold: SlotHold; at: number }
  | { t: 'booked'; hold: SlotHold }
  | { t: 'said'; text: string }
  | { t: 'asked' }
  | { t: 'paying'; orderId: string }
  | { t: 'unpaid' }
  | { t: 'pick' }; // a new pick, Let go, or Pick again: back to picking
export function holdSheet(s: HoldSheet, a: HoldStep): HoldSheet {
  switch (a.t) {
    case 'busy':
      return { ...s, busy: true, said: null };
    case 'done':
      return { ...s, busy: false };
    case 'held':
      return { ...NO_HOLD, busy: s.busy, held: a.hold, heldAt: a.at };
    case 'booked':
      return { ...s, booked: a.hold, paying: null };
    case 'said':
      return { ...s, said: a.text };
    case 'asked':
      return { ...s, asked: true };
    case 'paying':
      return { ...s, paying: a.orderId };
    case 'unpaid':
      return { ...s, paying: null };
    case 'pick':
      return s.busy || s.paying ? s : NO_HOLD;
  }
}
/** What's left of the hold, in ms (0 once it's run out, or when nothing's held, it's booked or it's being paid for). */
export const holdMsLeft = (s: HoldSheet, now: number) => (s.held && !s.booked && !s.paying ? holdLeft(s.heldAt, now) : 0);
/** A hold that ran out unpaid: Pick again. Not while its payment is being confirmed. */
export const holdLapsed = (s: HoldSheet, now: number) => !!s.held && !s.booked && !s.paying && holdMsLeft(s, now) === 0;

/** The venue page's bar: the cheapest hour across its stations (off-peak where cheaper), and the next start with room. */
export function venueBar(p: PublicSlots): { fromPaise: number; next: number | null } | null {
  if (p.stations.length === 0) return null;
  const fromPaise = Math.min(...p.stations.map((s) => Math.min(s.pricePaise, s.offPeak?.pricePaise ?? Infinity)));
  const next = Math.min(...p.stations.flatMap((s) => startsFor(s, 1).filter((f) => f.free > 0).map((f) => f.at)));
  return { fromPaise, next: Number.isFinite(next) ? next : null };
}
