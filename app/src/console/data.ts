// Mock Console data until the host endpoints exist, following the Hosts, Money and Event day flow docs: amounts in
// whole paise, times in India time. The events themselves are src/mock.ts's; who the viewer is on each host's team is
// src/modes.ts's `me`.
// ponytail: static, like src/mock.ts; it goes when the console endpoints land in @orbit/contract.
import { createContext, useContext } from 'react';

import { events, hosts } from '../mock';
import { me } from '../modes';
import type { Sales } from './money';

export const sales: Sales[] = [
  { eventId: 'open-mic-night', endsAt: '2026-11-20T23:00:00+05:30', booked: 31, seats: 40, checkedIn: 0, salesPaise: 926900, feesPaise: 50995, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 29900, refundsWaiting: 1 },
  { eventId: 'open-mic-night-13-nov', endsAt: '2026-11-13T23:00:00+05:30', booked: 38, seats: 40, checkedIn: 35, salesPaise: 1136200, feesPaise: 62510, feeBy: 'buyers', refundedPaise: 29900, paidOutPaise: 0, openRefundsPaise: 0, refundsWaiting: 0 },
  { eventId: 'build-anything-hackathon', endsAt: '2026-11-21T21:00:00+05:30', booked: 72, seats: 80, checkedIn: 0, salesPaise: 3133700, feesPaise: 172354, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 49900, refundsWaiting: 1 },
  { eventId: 'sunday-5-a-side', endsAt: '2026-11-22T09:00:00+05:30', booked: 18, seats: 20, checkedIn: 0, salesPaise: 268200, feesPaise: 14751, feeBy: 'buyers', refundedPaise: 0, paidOutPaise: 0, openRefundsPaise: 0, refundsWaiting: 0 },
];
export const salesOf = (eventId: string) => sales.find((s) => s.eventId === eventId);
// When an event is scheduled to end, for its check-in window and payouts.
// ponytail: mock events carry no end time, so it comes from the sales record, else the start; the API's events have one.
export const endsAt = (e: { id: string; startsAt: string }) => salesOf(e.id)?.endsAt ?? e.startsAt;

// Drafts are saved from their name on (Hosts flow, Listing an event).
export const drafts = [{ id: 'draft-new-year-open-mic', hostId: 'punchline', name: 'New Year’s Eve Open Mic' }];

// Each host's team, as the Host tab lists it. "You" is the viewer. Waiting roles are invites not yet accepted. An event
// role names its event, so a waiting invite shows on that event's card on Console's first tab.
export type Member = { name: string; role: string; eventId?: string; you?: boolean; waiting?: boolean };
export const teams: Record<string, Member[]> = {
  punchline: [
    { name: 'Abhinavtej Reddy', role: 'Owner', you: true },
    { name: 'Sana Mirza', role: 'Admin' },
    { name: 'Arjun Rao', role: 'Curator · Open Mic Night', eventId: 'open-mic-night' },
    { name: 'Vikram Shetty', role: 'Crew · Open Mic Night', eventId: 'open-mic-night' },
    { name: '+91 ••••• ••417', role: 'Crew · Open Mic Night', eventId: 'open-mic-night', waiting: true },
  ],
  circuitfeed: [{ name: 'Abhinavtej Reddy', role: 'Curator · Build Anything Hackathon', eventId: 'build-anything-hackathon', you: true }],
  kickoff: [{ name: 'Abhinavtej Reddy', role: 'Crew · Sunday 5-a-side', eventId: 'sunday-5-a-side', you: true }],
};

// Where a host is paid: Admins only, shown by its last 4 digits (Money flow, Bank account and payouts).
export const banks: Record<string, { last4: string; status: 'Checking' | 'Verified' | 'Rejected' }> = {
  punchline: { last4: '4821', status: 'Verified' },
};

// The host the Console is showing, picked in its host switcher (Hosts doc: "one site for every host a person is on,
// with a host switcher at the top"). Provided by src/app/console/_layout.tsx, and kept here so it outlasts a visit.
// ponytail: in memory, so a fresh launch shows the first host again.
let picked = me.teams[0]?.hostId ?? '';
export const lastHost = () => picked;
export const keepHost = (hostId: string) => (picked = hostId);
export const HostPick = createContext<{ hostId: string; pick: (hostId: string) => void }>({ hostId: '', pick: () => {} });
export function useHost() {
  const { hostId, pick } = useContext(HostPick);
  const team = me.teams.find((t) => t.hostId === hostId) ?? me.teams[0];
  const host = hosts.find((h) => h.id === team.hostId)!;
  return { team, host, pick, events: events.filter((e) => e.hostId === team.hostId) };
}
