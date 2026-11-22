// Orbit Launch's mock: one host the viewer is an Admin of, its events with their sales, a draft, an invite not yet
// accepted and the Inbox's unread count, following the Hosts, Money and Event day flow docs (paise, India time). It is
// the Orbit app's Console mock (git 58351ce^1: app/src/console/data.ts), as Events take 1 draws it on Fri 20 Nov.
// ponytail: static, at a fixed `now`. It goes as GET /me (teams), GET /hosts/:id and the events, sales and inbox
// endpoints land; then the Events tab also follows the viewer's role (an Event lead sees only their events).
import type { ImageSourcePropType } from 'react-native';

import type { Sales } from './money';

export const now = Date.parse('2026-11-20T18:40:00+05:30'); // take 1's event day, 6:40 PM

export type Host = { id: string; name: string; initials: string; bg: string; fg: string };
export const host: Host = { id: 'punchline', name: 'Punchline Collective', initials: 'PC', bg: '#F2C14E', fg: '#141414' };

// The host's commission clock and rate (Money decisions 14 to 17), set by Orbit's staff in Galaxy. Its sales so far fell
// in the 0% intro months, so their commission is ₹0.
export const commissionTerms = { onboarded: '2026-10-18', ratePct: 7 };

// Where the host is paid (Money flow, Bank account and payouts): Admins only, shown by its last 4 digits.
export const bank: { name: string; last4: string; status: 'Checking' | 'Verified' | 'Rejected' } | null = { name: 'HDFC Bank', last4: '4821', status: 'Verified' };

export type LaunchEvent = {
  id: string;
  title: string;
  startsAt: string;
  when: string; // "Fri 20 Nov · 8:00 PM"
  repeats?: string;
  poster?: ImageSourcePropType; // 3:4
};
const openMic = require('../../assets/mock/open-mic.png');
export const events: LaunchEvent[] = [
  { id: 'open-mic-night', title: 'Open Mic Night', startsAt: '2026-11-20T20:00:00+05:30', when: 'Fri 20 Nov · 8:00 PM', repeats: 'Every Friday', poster: openMic },
  { id: 'open-mic-night-13-nov', title: 'Open Mic Night', startsAt: '2026-11-13T20:00:00+05:30', when: 'Fri 13 Nov · 8:00 PM', repeats: 'Every Friday', poster: openMic },
  { id: 'open-mic-night-6-nov', title: 'Open Mic Night', startsAt: '2026-11-06T20:00:00+05:30', when: 'Fri 6 Nov · 8:00 PM', repeats: 'Every Friday', poster: openMic },
];

export const sales: Sales[] = [
  { eventId: 'open-mic-night', endsAt: '2026-11-20T23:00:00+05:30', booked: 31, seats: 40, checkedIn: 0, salesPaise: 926900, commissionPaise: 0, feesPaise: 37076, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 29900, refundsWaiting: 1 },
  { eventId: 'open-mic-night-13-nov', endsAt: '2026-11-13T23:00:00+05:30', booked: 38, seats: 40, checkedIn: 35, salesPaise: 1136200, commissionPaise: 0, feesPaise: 45448, feeBy: 'buyers', refundedPaise: 29900, paidOutPaise: 0, openRefundsPaise: 0, refundsWaiting: 0 },
  { eventId: 'open-mic-night-6-nov', endsAt: '2026-11-06T23:00:00+05:30', booked: 36, seats: 40, checkedIn: 33, salesPaise: 1076400, commissionPaise: 0, feesPaise: 43056, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 1076400, paidOn: '2026-11-10', openRefundsPaise: 0, refundsWaiting: 0 },
];
export const salesOf = (eventId: string) => sales.find((s) => s.eventId === eventId);
// When an event is scheduled to end. ponytail: from its sales record until events carry their own end.
export const endsAt = (e: LaunchEvent) => salesOf(e.id)?.endsAt ?? e.startsAt;

// Drafts are saved from their name on (Hosts flow, Listing an event).
export const drafts = [{ id: 'draft-new-year-open-mic', name: 'New Year’s Eve Open Mic' }];

// Event roles sent and not yet accepted, shown on their event's card (Roles by use case: Event lead and Crew).
export const invites = [{ eventId: 'open-mic-night', role: 'Crew' }];

// New in the Inbox since it was last opened: bookings, refund requests, payouts, invites accepted, performers' asks.
export const unread = 3;
