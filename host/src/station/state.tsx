// Orbit Station's state while the app is open: which venue and role you're looking as, the clock, and the venue's day of
// claims. The day is made once per opening and kept, so a check-in, release or walk-in stays as the clock moves on; a
// new opening (or another venue) starts a fresh mock day.
// Signed in, the venues and roles are the person's own seats (seats.ts), picked in the You sheet; the role comes with the
// seat. The dev demo picks a mock venue and either role there instead.
// Today (S3): signed in, its day is the API's (GET /venues/:hostId/day, live.ts), fetched again on a seat change and when
// Today asks (pull, every 30 s, back to the foreground). The demo keeps the mock day. Venue, Money and the scanner's
// lookup stay on the mock until their slices.
import { VenueDay } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';
import { useLoad } from '@orbit/mobile/load';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { admit, admitTo, byCode, type Claim, freeOne, hours, type StationType } from './day';
import { mockDay, mockMoney, mockVenue, venues } from './mock';
import { seats as seatsOf } from './seats';
import { fromApi } from './live';
import { api, useSession } from '../session';
import type { Bank } from '../money';
import type { Payout, Sold } from './money';

export type Role = 'admin' | 'desk';
export type VenueSetup = ReturnType<typeof mockVenue>;

function useStationState() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const session = useSession();
  const seats = useMemo(() => (session && 'me' in session ? seatsOf(session.me) : null), [session]);
  const [hostId, setSeat] = useState<string | null>(null);
  const seat = seats ? (seats.find((x) => x.hostId === hostId) ?? seats[0]) : undefined;
  const [demoVenue, setVenueId] = useState(venues[0].id);
  const [demoRole, setRole] = useState<Role>('admin');
  // ponytail: Venue and Money show the mock venue at the seat's index until their own APIs are wired; Today reads the
  // real day (`today` below).
  const venueId = seats ? venues[Math.max(0, seats.indexOf(seat!)) % venues.length].id : demoVenue;
  const role: Role = seats ? (seat?.role ?? 'desk') : demoRole;
  // Venue's edits (take 4): each venue's kinds as its Admin set them, over the mock's, and its page, team, asks and
  // weekly hours. Both outlive a day and a venue switch.
  // ponytail: Today keeps the opening it started with; the slots API serves each day's own hours.
  const [kinds, setKinds] = useState<Record<string, StationType[]>>({});
  const [setups, setSetups] = useState(() => Object.fromEntries(venues.map((v) => [v.id, mockVenue(v, Date.now())])));
  const base = venues.find((v) => v.id === venueId)!;
  const venue = kinds[base.id] ? { ...base, types: kinds[base.id] } : base;
  const open = hours(venue, now);
  const key = `${venue.id}:${open.day}`;
  // The day and its money (Money's last 30 days, terms, bank account and payouts), made together.
  // From the venue as it was, so an edited price never reaches past bookings and a new kind has none yet.
  const fresh = () => {
    const claims = mockDay(base, now);
    return { key, claims, money: mockMoney(base, now, claims) };
  };
  const [day, setDay] = useState(fresh);
  // A new opening or venue: React's way of resetting state from a render (no effect, so no frame of the old day).
  if (day.key !== key) setDay(fresh());
  // A venue's payouts and bank account outlive its days: they're kept apart, so switching venue or a new opening never
  // undoes an ask or a new account.
  const [kept, setKept] = useState<Record<string, { payouts: Payout[]; bank: Bank }>>({});
  const own = kept[venue.id] ?? { payouts: day.money.payouts, bank: day.money.bank };
  const keep = (f: (k: { payouts: Payout[]; bank: Bank }) => { payouts: Payout[]; bank: Bank }) => setKept((all) => ({ ...all, [venue.id]: f(all[venue.id] ?? own) }));
  // Today's money comes from the day as it is now (a booking added or refunded today counts at once).
  // Priced as the bookings were made: a new price applies to new bookings only (Play).
  const sold: Sold[] = day.claims.filter((c) => c.kind === 'booking').map((c) => ({ t: base.types.find((t) => t.id === c.type) ?? venue.types.find((t) => t.id === c.type)!, c }));
  const days = day.money.days.map((d, i) => (i === 0 && d.day === open.day ? { ...d, sold } : d));
  // The other venues' days, for "Not for this venue": made once per opening, like this venue's.
  // `now` only seeds them: a new key (venue or opening) makes new ones.
  const others = useMemo(() => venues.filter((v) => v.id !== venue.id).map((v) => mockDay(v, now)), [key]);
  // The clock moves with every change, so what the desk just did shows at once, not at the next 30-second tick.
  const change = (f: (claims: Claim[]) => Claim[]) => {
    setNow(Date.now());
    setDay((d) => ({ ...d, claims: f(d.claims) }));
  };
  // Signed in, Today's day from the API, read through the contract so a payload this app can't read is an error, not a
  // crash. A failed refetch keeps the last good day (useLoad).
  const live = useLoad<VenueDay>(seat ? `day|${seat.hostId}` : null, () => api.authed<unknown>('GET', `/venues/${seat!.hostId}/day`).then(readDay));
  const fromLive = useMemo(() => (seat && live.data ? fromApi(live.data, seat, now) : null), [live.data, seat, now]);
  return {
    now,
    // What Today draws: the API's day when signed in (null until the first answer), the mock's in the demo; and, signed
    // in, how the fetch stands. Read through useToday().
    today: seats ? fromLive : { venue, claims: day.claims, hours: open, closed: false },
    load: seats ? { error: live.error, status: live.status, reload: live.reload } : null,
    venue,
    role,
    hours: open,
    claims: day.claims,
    // Signed in: the person's seats (null in the demo), the one picked, and picking another.
    seats,
    seat,
    setSeat,
    // The demo's own: any mock venue, either role.
    setVenue: setVenueId,
    setRole,
    // The counter's writes change the mock day only. Signed in they reach nothing Today draws (its day is the API's, and
    // the next fetch is the truth); S4 sends them to the API.
    checkIn: (id: string) => change((cs) => cs.map((c) => (c.id === id ? admit(c, c.count - (c.in ?? 0), Date.now(), 'you') : c))),
    release: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, released: Date.now() } : c))),
    add: (c: Claim) => change((cs) => [...cs, c]),
    freeOne: (type: string) => change((cs) => freeOne(cs, type, Date.now())),
    // The scanner's: have `total` of a booking in (a tap landing twice counts once), log a Let in again, and put a
    // booking back as it was (Undo).
    letIn: (id: string, total: number) => change((cs) => cs.map((c) => (c.id === id ? admitTo(c, total, Date.now(), 'you') : c))),
    again: (id: string) => change((cs) => cs.map((c) => (c.id === id ? { ...c, again: (c.again ?? 0) + 1 } : c))),
    put: (claim: Claim) => change((cs) => cs.map((c) => (c.id === claim.id ? claim : c))),
    // Venue's, Admins only: a kind saved (or added), and the venue's setup changed.
    setup: setups[base.id],
    saveKind: (t: StationType) =>
      setKinds((all) => {
        const cur = all[base.id] ?? base.types;
        return { ...all, [base.id]: cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? t : x)) : [...cur, t] };
      }),
    changeSetup: (f: (s: VenueSetup) => VenueSetup) => setSetups((all) => ({ ...all, [base.id]: f(all[base.id]) })),
    // Money's, Admins only: ask Orbit for a payout, and add or replace where it's paid.
    // ponytail: a replacement should also send open asks back to be confirmed again; the money API does that.
    money: { ...day.money, ...own, days },
    ask: (paise: number) => keep((k) => ({ ...k, payouts: [...k.payouts, { id: `p${Date.now()}`, asked: Date.now(), paise, status: 'requested' }] })),
    setBank: (bank: Bank) => keep((k) => ({ ...k, bank })),
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

const readDay = (r: Result<unknown>): Result<VenueDay> => {
  if (!r.ok) return r;
  const d = VenueDay.safeParse(r.data);
  return d.success ? { ok: true, data: d.data } : { ok: false, status: 200, error: { error: 'unreadable', message: 'Orbit sent a day this app can’t read. Update the app.' } };
};

const Station = createContext<ReturnType<typeof useStationState> | null>(null);

export function StationProvider({ children }: { children: ReactNode }) {
  return <Station.Provider value={useStationState()}>{children}</Station.Provider>;
}

export function useStation() {
  const s = useContext(Station);
  if (!s) throw new Error('useStation outside StationProvider');
  return s;
}

/** The station state with Today's day on top: the API's when signed in, the mock's in the demo. Today and its sheets. */
export function useToday() {
  const s = useStation();
  return { ...s, ...s.today! };
}
