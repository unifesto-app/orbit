// Orbit Station's state while the app is open: which venue and role you're looking as, the clock, and the venue's day of
// claims. The day is made once per opening and kept, so a check-in, release or walk-in stays as the clock moves on; a
// new opening (or another venue) starts a fresh mock day.
// ponytail: mock until sign-in and the slots API (H8.1 to H8.5); the venue and role are picked in the You sheet.
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { type Claim, freeOne, hours } from './day';
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
    checkIn: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, checkedIn: Date.now() } : c))),
    release: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, released: true } : c))),
    add: (c: Claim) => change((cs) => [...cs, c]),
    freeOne: (type: string) => change((cs) => freeOne(cs, type, Date.now())),
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
