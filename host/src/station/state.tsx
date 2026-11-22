// Orbit Station's state while the app is open: which venue and role you're looking as, the clock, and the venue's day of
// claims. The day is made once per opening and kept, so a check-in, release or walk-in stays as the clock moves on; a
// new opening (or another venue) starts a fresh mock day.
// ponytail: mock until sign-in and the slots API (H8.1 to H8.5); the venue and role are picked in the You sheet.
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { admit, admitTo, byCode, type Claim, freeOne, hours } from './day';
import { mockDay, venues } from './mock';

export type Role = 'admin' | 'desk';

function useStationState() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const [venueId, setVenueId] = useState(venues[0].id);
  const [role, setRole] = useState<Role>('admin');
  const venue = venues.find((v) => v.id === venueId)!;
  const open = hours(venue, now);
  const key = `${venue.id}:${open.day}`;
  const [day, setDay] = useState(() => ({ key, claims: mockDay(venue, now) }));
  // A new opening or venue: React's way of resetting state from a render (no effect, so no frame of the old day).
  if (day.key !== key) setDay({ key, claims: mockDay(venue, now) });
  // The other venues' days, for "Not for this venue": made once per opening, like this venue's.
  // `now` only seeds them: a new key (venue or opening) makes new ones.
  const others = useMemo(() => venues.filter((v) => v.id !== venue.id).map((v) => mockDay(v, now)), [key]);
  // The clock moves with every change, so what the desk just did shows at once, not at the next 30-second tick.
  const change = (f: (claims: Claim[]) => Claim[]) => {
    setNow(Date.now());
    setDay((d) => ({ ...d, claims: f(d.claims) }));
  };
  return {
    now,
    venue,
    role,
    hours: open,
    claims: day.claims,
    setVenue: setVenueId,
    setRole,
    checkIn: (id: string) => change((cs) => cs.map((c) => (c.id === id ? admit(c, c.count - (c.in ?? 0), Date.now(), 'you') : c))),
    release: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, released: Date.now() } : c))),
    add: (c: Claim) => change((cs) => [...cs, c]),
    freeOne: (type: string) => change((cs) => freeOne(cs, type, Date.now())),
    // The scanner's: have `total` of a booking in (a tap landing twice counts once), log a Let in again, and put a
    // booking back as it was (Undo).
    letIn: (id: string, total: number) => change((cs) => cs.map((c) => (c.id === id ? admitTo(c, total, Date.now(), 'you') : c))),
    again: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, again: (c.again ?? 0) + 1 } : c))),
    put: (claim: Claim) => change((cs) => cs.map((c) => (c.id === claim.id ? claim : c))),
    // A scanned QR or a typed code: this venue's booking, or another venue's (Not for this venue).
    // ponytail: the mock's QR holds the 8-character code; the slots API will look up the booking's own QR.
    lookup: (text: string) => {
      const ours = byCode(day.claims, text);
      if (ours) return { claim: ours, ours: true };
      for (const cs of others) {
        const theirs = byCode(cs, text);
        if (theirs) return { claim: theirs, ours: false };
      }
      return undefined;
    },
  };
}

const Station = createContext<ReturnType<typeof useStationState> | null>(null);

export function StationProvider({ children }: { children: ReactNode }) {
  return <Station.Provider value={useStationState()}>{children}</Station.Provider>;
}

export function useStation() {
  const s = useContext(Station);
  if (!s) throw new Error('useStation outside StationProvider');
  return s;
}
