// Orbit Launch's mock: one host the viewer is an Admin of, its events with their sales, a draft, an invite not yet
// accepted, the fee plan and the bank account, following the Hosts, Money and Event day flow docs (paise, India time). It is
// the Orbit app's Console mock (git 58351ce^1: app/src/console/data.ts), as Events take 1 draws it on Fri 20 Nov.
// ponytail: static, at a fixed `now`. It goes as GET /me (teams), GET /hosts/:id and the events, sales and inbox
// endpoints land; then the Events tab also follows the viewer's role (an Event lead sees only their events).
import type { ImageSourcePropType } from 'react-native';

import type { Plan } from '../money';
import type { Sales } from './money';

export const now = Date.parse('2026-11-20T18:40:00+05:30'); // take 1's event day, 6:40 PM

export type Host = { id: string; name: string; initials: string; bg: string; fg: string };
export const host: Host = { id: 'punchline', name: 'Punchline Collective', initials: 'PC', bg: '#F2C14E', fg: '#141414' };

// The host's page as people see it, and its status (Hosts flow, Host profile and settings; Becoming a host).
export const page = {
  kind: 'Comedy group',
  city: 'Hyderabad',
  followers: 2050,
  verified: true,
  status: 'live' as 'live' | 'paused' | 'suspended' | 'archived',
  visibility: 'public' as 'public' | 'private',
  logo: false, // the monogram stands in until a logo is added
  banner: false,
  about: 'An open mic every Friday in Jubilee Hills, where new comics try five minutes on a very forgiving room.',
};

// The host's Admins, the owner marked, and Admin roles sent and not yet accepted (Hosts flow, Team and roles).
export const admins = [
  { id: 'u-you', name: 'Abhinavtej Reddy', initials: 'AR', you: true, owner: true },
  { id: 'u-sana', name: 'Sana Mirza', initials: 'SM', you: false, owner: false },
];
export const adminInvites = [{ id: 'i-417', contact: '+91 ••••• ••417', sentAt: '2026-11-18T18:40:00+05:30' }];

// Each event's team: its Event lead and how many Crew have started (Roles by use case). Invites still waiting are in
// `invites` below.
export const eventTeams: Record<string, { lead?: string; crew: number }> = { 'open-mic-night': { lead: 'Arjun Rao', crew: 1 } };

// The host's fee plan (owner, 25 Nov 2026), picked by the host and set in Galaxy: 3% from buyers + 2% commission, so
// the sales below carry a 3% fee on top and 2% commission on what wasn't refunded.
export const feePlan: Plan = '3+2';

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
  { eventId: 'open-mic-night', endsAt: '2026-11-20T23:00:00+05:30', booked: 31, seats: 40, checkedIn: 0, salesPaise: 926900, commissionPaise: 18538, feesPaise: 27807, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 29900, refundsWaiting: 1 },
  { eventId: 'open-mic-night-13-nov', endsAt: '2026-11-13T23:00:00+05:30', booked: 38, seats: 40, checkedIn: 35, salesPaise: 1136200, commissionPaise: 22126, feesPaise: 34086, feeBy: 'buyers', refundedPaise: 29900, paidOutPaise: 0, openRefundsPaise: 0, refundsWaiting: 0 },
  { eventId: 'open-mic-night-6-nov', endsAt: '2026-11-06T23:00:00+05:30', booked: 36, seats: 40, checkedIn: 33, salesPaise: 1076400, commissionPaise: 21528, feesPaise: 32292, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 1054872, paidOn: '2026-11-10', openRefundsPaise: 0, refundsWaiting: 0 },
];
export const salesOf = (eventId: string) => sales.find((s) => s.eventId === eventId);
// When an event is scheduled to end. ponytail: from its sales record until events carry their own end.
export const endsAt = (e: LaunchEvent) => salesOf(e.id)?.endsAt ?? e.startsAt;

// Drafts are saved from their name on (Hosts flow, Listing an event).
export const drafts = [{ id: 'draft-new-year-open-mic', name: 'New Year’s Eve Open Mic' }];

// Event roles sent and not yet accepted, shown on their event's card (Roles by use case: Event lead and Crew).
export const invites = [{ eventId: 'open-mic-night', role: 'Crew' }];
