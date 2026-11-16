// Mock account for the signed-in viewer in src/mock.ts, until the API serves it. Kept apart from src/mock.ts, which
// other screens are changing. Shapes follow the User, Booking, Money and Notifications flow docs: amounts in whole paise,
// times as ISO strings in India time, every paid booking with its frozen price and fee.
// ponytail: static data, like src/mock.ts; it goes when the account endpoints land in @orbit/contract.
import type { RefundStatus } from './rules';
import type { List } from './saves';

// A paid booking, with the terms it sold under. The fee is the buyer's, paid on top.
export type Payment = { id: string; eventId: string; paidAt: string; pricePaise: number; feePaise: number; via: string };
export type Refund = { id: string; eventId: string; amountPaise: number; status: RefundStatus; asked: string; reason: string; settled?: string };
// A booking that's no longer a ticket: the event is over, or the booking was cancelled or refunded.
export type Past = { eventId: string; status: 'Went' | 'Missed' | 'Cancelled' | 'Refunded' };

// The account itself is the API's (/me, src/session.ts). What's left here: the number the mock's sign-in methods show,
// and the city for new events nearby (Event Request's and Notifications' defaults) until the API keeps one.
export const profile: { phone: string; city: string | null } = { phone: '+919876543210', city: 'Hyderabad' };

// Saved events, oldest save first, and two lists over them (Saved events and lists doc).
export const saved = ['build-anything-hackathon', 'sunday-jam', 'udaan-cultural-fest', 'open-mic-night-13-nov'];
export const lists: List[] = [
  { id: 'l_weekend', name: 'This weekend', events: ['build-anything-hackathon', 'sunday-jam'], touched: Date.parse('2026-11-18T21:00:00+05:30') },
  { id: 'l_friends', name: 'With the gang', events: ['udaan-cultural-fest', 'open-mic-night-13-nov'], touched: Date.parse('2026-11-10T19:30:00+05:30') },
];

export const past: Past[] = [
  { eventId: 'campus-esports-cup', status: 'Refunded' },
  { eventId: 'open-mic-night-13-nov', status: 'Went' },
  { eventId: 'monsoon-hack', status: 'Went' },
  { eventId: 'udaan-2025', status: 'Missed' },
];

// Newest first. The last one sold under Unifesto's old 4% buyer fee, frozen as it was.
export const payments: Payment[] = [
  { id: 'pay_PZ7d2Lq9Vt0c', eventId: 'pottery-for-beginners', paidAt: '2026-11-17T12:15:00+05:30', pricePaise: 149900, feePaise: 8245, via: 'Card' },
  { id: 'pay_PZ5nA8kRw3Ue', eventId: 'founders-breakfast', paidAt: '2026-11-15T08:05:00+05:30', pricePaise: 19900, feePaise: 1095, via: 'PhonePe' },
  { id: 'pay_PZ4k8Qm2Xw1a', eventId: 'open-mic-night', paidAt: '2026-11-12T19:02:00+05:30', pricePaise: 29900, feePaise: 1645, via: 'Google Pay' },
  { id: 'pay_PZ3e6Hs1Bn8y', eventId: 'campus-esports-cup', paidAt: '2026-11-11T18:30:00+05:30', pricePaise: 9900, feePaise: 545, via: 'Google Pay' },
  { id: 'pay_PY9c1Tg4Mk2r', eventId: 'open-mic-night-13-nov', paidAt: '2026-11-06T20:45:00+05:30', pricePaise: 29900, feePaise: 1645, via: 'Google Pay' },
  { id: 'pay_PS2w7Jx5Da6p', eventId: 'monsoon-hack', paidAt: '2026-08-10T11:20:00+05:30', pricePaise: 29900, feePaise: 1645, via: 'UPI' },
  { id: 'pay_OQ4z9Fv3Lc1h', eventId: 'udaan-2025', paidAt: '2025-11-03T17:00:00+05:30', pricePaise: 14900, feePaise: 596, via: 'UPI' },
];

// A fee paid on top stays with Orbit on a refund the buyer asks for (Money flow, Refunds).
export const refunds: Refund[] = [
  { id: 'rf2', eventId: 'pottery-for-beginners', amountPaise: 149900, status: 'With the host', asked: '2026-11-18T10:30:00+05:30', reason: 'Can’t make it that day' },
  { id: 'rf1', eventId: 'campus-esports-cup', amountPaise: 9900, status: 'Refunded', asked: '2026-11-13T16:00:00+05:30', reason: 'Our team dropped out', settled: '2026-11-16T11:00:00+05:30' },
];

// A booking behind each of the viewer's tickets (Booking doc, The ticket): one QR admitting `count` people, the
// 8-character code the crew types when a QR won't scan (Event day doc: online only), and the host's WhatsApp group if
// it has one. The QR and code are random and separate from the booking id.
export type Booking = { id: string; eventId: string; tier: string; count: number; qr: string; code: string; group?: string };
export const bookings: Booking[] = [
  { id: 'BK-7Q2M9X', eventId: 'open-mic-night', tier: 'General', count: 1, qr: 'q7Hc2LmX9pRt4WzK8vNb3YsD6fJg1AeU', code: 'OM7Q2M9X', group: 'https://example.com/punchline-whatsapp' },
  { id: 'BK-3HF8KD', eventId: 'founders-breakfast', tier: 'Breakfast seat', count: 1, qr: 'Rt5vN2kQ8xLc4WmZ7pYb1HsD9fJg3AeU', code: 'FB3HF8KD' },
  { id: 'BK-9PL2WA', eventId: 'pottery-for-beginners', tier: 'Beginner class', count: 1, qr: 'Lm3Xq8Vt2Nc7Rb5Kp9Wz4Yh6Df1Jg8Ae', code: 'PB9PL2WA' },
];
// The viewer's booking for an event, for links to its ticket (`/ticket/<booking id>`).
export const ticketFor = (eventId: string) => bookings.find((b) => b.eventId === eventId);
