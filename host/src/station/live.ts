// Today's day from the API (GET /venues/:hostId/day) as the shapes Today already draws: the venue's stations as kinds,
// its claims, and the opening. Pure, so live.test.ts runs it on Node.
// - Desk sees no money: the day has none, so a kind's price is 0 and nothing on Today reads it.
// - Refunded claims are left out (they take nothing and Today never shows them); released ones keep their time.
// - Archived stations are left out: nothing new lands on them.
// - The API's `free` counts aren't read: Today works them out from the claims with taken(), the same rule.
// ponytail: no ticket codes in the day, so the scanner's typed-code lookup stays on the mock until S4.
import type { VenueDay } from '@orbit/contract';

import { type Claim, HOUR, type StationType, type Venue } from './day.ts';

/** "PC" to "PCs", "pitch" to "pitches", "box" to "boxes". */
export const plural = (u: string) => (/(s|sh|ch|x|z)$/i.test(u) ? `${u}es` : `${u}s`);

/** A venue with nothing in it yet, for the head while its day loads or can't. */
export function blank(host: { hostId: string; name: string }): Venue {
  const initials = host.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'O';
  // ponytail: Orbit's forest and stone until a venue has its own logo colours.
  return { id: host.hostId, name: host.name, initials, bg: '#1D372A', fg: '#DFDAD7', area: '', open: [0, 0], types: [] };
}

export function fromApi(d: VenueDay, host: { hostId: string; name: string }, now: number) {
  const day = Date.parse(d.opening.day);
  const opens = Date.parse(d.opening.opens);
  const closes = Date.parse(d.opening.closes);
  const types: StationType[] = d.stations
    .filter((s) => !s.archived)
    .map((s) => ({ id: s.id, name: s.name, count: s.count, unit: [s.unit, plural(s.unit)], step: s.step, whole: s.whole, price: 0 }));
  const venue: Venue = { ...blank(host), open: [Math.round((opens - day) / HOUR), Math.round((closes - day) / HOUR)], types };
  const claims: Claim[] = d.claims
    .filter((c) => c.status !== 'refunded')
    .map((c) => ({
      id: c.id,
      type: c.stationId,
      kind: c.kind,
      count: c.count,
      start: Date.parse(c.start),
      end: Date.parse(c.end),
      who: c.who ?? (c.kind === 'booking' ? 'Someone' : undefined),
      why: c.why ?? undefined,
      checkedIn: c.checkedInAt ? Date.parse(c.checkedInAt) : undefined,
      in: c.admitted,
      by: c.checkedInBy ?? undefined,
      released: c.status === 'released' ? Date.parse(c.releasedAt ?? c.start) : undefined,
    }));
  // Where now is against the opening, from the phone's clock so it moves between fetches; a closed day opens and closes
  // at its midnight (the API's rule).
  const state = now < opens ? ('before' as const) : now < closes ? ('open' as const) : ('after' as const);
  return { venue, claims, hours: { day, opens, closes, state }, closed: opens === closes };
}
