// Orbit Play Partner's state while the app is open, signed in only (S6: no demo, no mock): which of your venues you're
// looking as (your seats, seats.ts, picked in the You sheet; the role comes with the seat), the clock, and the venue's day.
// Today (S3): its day is the API's (GET /venues/:hostId/day, live.ts), fetched again on a seat change and when Today
// asks (pull, every 30 s, back to the foreground).
// The counter's writes (S4) go to the API (counter.ts), one at a time per control, then the day is fetched again;
// nothing changes on screen before the API says so.
// Venue (S5): as an Admin, the real venue (GET /venues/:hostId; a 404 is a venue not set up yet) and the host's team
// (GET /hosts/:id/team), edited through the API (useLiveVenue below). Each write answers the line to show, or null when
// it went in, and then the venue (or team) and Today's day are fetched again.
// ponytail: no Money here; it waits on the Money API (payouts, bank account), and 1.0 hides its tab (ONE_0).
import { EditStation, InviteAdmin, NewStation, VenueDay, VenueSettings, VenueSetup as PutVenue } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';
import { useLoad } from '@orbit/mobile/load';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { StationType } from './day';
import { seats as seatsOf } from './seats';
import { counter } from './counter';
import { blank, fromApi } from './live';
import { fieldWhy, fromStation, inviteBody, kindBody, putFor, readVenue, refusal, setupFrom, type TeamList, teamFrom, type VenueSetup, venueApi, weekSpan } from './venue';
import { api, useSession } from '../session';

export type Role = 'admin' | 'desk';
export type { VenueSetup };
/** What a Venue write ends with: the line to show, or null when it went in. */
type Said = Promise<string | null>;

function useStationState() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  const session = useSession();
  // Signed out (or Launch's dev demo) there are no seats, and Station's screens are closed (the app's layout).
  const seats = useMemo(() => (session && 'me' in session ? seatsOf(session.me) : []), [session]);
  const [hostId, setSeat] = useState<string | null>(null);
  const seat = seats.find((x) => x.hostId === hostId) ?? seats[0];
  const role: Role = seat?.role ?? 'desk';
  // Today's day from the API, read through the contract so a payload this app can't read is an error, not a crash. A
  // failed refetch keeps the last good day (useLoad).
  const live = useLoad<VenueDay>(seat ? `day|${seat.hostId}` : null, () => api.authed<unknown>('GET', `/venues/${seat!.hostId}/day`).then(readDay));
  const today = useMemo(() => (seat && live.data ? fromApi(live.data, seat, now) : null), [live.data, seat, now]);
  // Writes in flight, by control ("claim:<id>" for Check in and Release alike, "free:<station>", "sheet"): the ref stops a
  // second tap before the next render, the state draws it busy. `said` is the last write's refusal for Today, kept with
  // its seat so another venue never shows it. The sheet shows its own while it's up (`toToday` false), Today's after.
  // A walk-in, minus or block that got no answer may have landed (those routes take no idempotency key), so the line
  // says to look before trying again.
  const flying = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<{ hostId: string; line: string } | null>(null);
  const send = async (key: string, run: () => Promise<Result<unknown>>, o: { unsure?: boolean; toToday?: () => boolean } = {}): Promise<Sent> => {
    if (!seat || flying.current.has(key)) return { dropped: true };
    const hostId = seat.hostId;
    flying.current.add(key);
    setBusy(new Set(flying.current));
    setSaid(null);
    const r = await run();
    flying.current.delete(key);
    setBusy(new Set(flying.current));
    live.reload();
    const line = r.ok ? null : r.status !== 0 ? r.error.message : o.unsure ? 'It may have gone through. Check the day before trying again.' : 'Can’t reach Orbit. Try again.';
    if (line && (o.toToday ?? (() => true))()) setSaid({ hostId, line });
    return { line };
  };
  const desk = seat ? counter(seat.hostId, api.authed) : null;
  const meId = session && 'me' in session ? session.me.id : '';
  const real = useLiveVenue(seat?.role === 'admin' ? seat : undefined, meId, live.reload);
  const nope = (): Said => Promise.resolve('Only an Admin changes the venue.');
  const venue = today?.venue ?? blank(seat ?? { hostId: '', name: '' });
  const claims = today?.claims ?? [];
  return {
    now,
    // What Today draws (null until the first answer), and how the fetch stands. Read through useToday().
    today,
    load: { data: live.data, error: live.error, status: live.status, reload: live.reload },
    venue,
    claims,
    role,
    // The person's seats, the one picked, and picking another.
    seats,
    seat,
    setSeat,
    // The counter's writes (busy and said as above). Check in has the whole booking in: Admit's total is everyone it holds.
    busy,
    said: said && said.hostId === seat?.hostId ? said.line : null,
    checkIn: (id: string) => {
      const c = claims.find((x) => x.id === id);
      if (desk && c) void send(`claim:${id}`, () => desk.admit(id, { total: c.count }));
    },
    release: (id: string) => void (desk && send(`claim:${id}`, () => desk.release(id))),
    freeOne: (type: string) => void (desk && send(`free:${type}`, () => desk.freeOne({ stationId: type }), { unsure: true })),
    // The walk-in sheet's: the API places it from the current step and answers the line to show in the sheet (null when
    // it's in); `gone` says the sheet was closed, so a refusal goes to Today instead.
    place: (b: { stationId: string; hours: number; count: number; why?: string }, gone: () => boolean): Promise<Sent> =>
      desk ? send('sheet', () => (b.why ? desk.block({ ...b, why: b.why }) : desk.walkIn(b)), { unsure: true, toToday: gone }) : Promise.resolve({ dropped: true }),
    // Venue's, Admins only, read through useVenue(): the venue and its setup (null until it loads or while it isn't set
    // up yet, `load` saying which), and its edits, each answering its line (Said).
    venueTab: real ? { venue: real.venue, setup: real.setup, load: real.load, said: real.said } : { venue, setup: null, load: null, said: null },
    tell: (line: string | null) => real?.tell(line), // a refusal for the Venue tab, from a sheet closed mid-write
    saveKind: (t: StationType, tile: 'gaming' | 'sports'): Said => (real ? real.saveKind(t, tile) : nope()),
    archiveKind: (id: string, archived = true): Said => (real ? real.archiveKind(id, archived) : nope()),
    changeSetup: (f: (s: VenueSetup) => VenueSetup): Said => (real ? real.changeSetup(f) : nope()),
    firstSetup: (b: PutVenue): Said => (real ? real.first(b) : nope()),
    invite: (contact: string, role: 'Admin' | 'Desk'): Said => (real ? real.invite(contact, role) : nope()),
    // Removing someone or withdrawing an invite, by its seat id.
    endSeat: (id: string): Said => (real ? real.endSeat(id) : nope()),
    confirmSeat: (id: string): Said => (real ? real.confirmSeat(id) : nope()), // an accepted Admin invite, by its adder
  };
}

// A write's end: dropped (that control already had one on its way), or the line to show (null when it went in).
type Sent = { dropped: true } | { line: string | null };

const readDay = (r: Result<unknown>): Result<VenueDay> => {
  if (!r.ok) return r;
  const d = VenueDay.safeParse(r.data);
  return d.success ? { ok: true, data: d.data } : { ok: false, status: 200, error: { error: 'unreadable', message: 'Orbit sent a day this app can’t read. Update the app.' } };
};

const checkVenue = (x: unknown) => {
  const d = VenueSettings.safeParse(x);
  return d.success ? d.data : undefined;
};

// Signed in as an Admin: the real venue and team, and their writes. Each write is checked with the contract's schema
// first (a field error shows before anything is sent), then sent. After every answer, refusals too, the venue (or team)
// is fetched again; a PUT's answer is the new venue itself. Venue writes fetch Today's day again too, team writes don't.
function useLiveVenue(admin: { hostId: string; name: string } | undefined, meId: string, reloadDay: () => void) {
  const to = admin ? venueApi(admin.hostId, api.authed) : null;
  const got = useLoad<VenueSettings | null>(admin ? `venue|${admin.hostId}` : null, () => to!.get().then((r) => readVenue(r, checkVenue)));
  const crew = useLoad<TeamList>(admin ? `team|${admin.hostId}` : null, () => to!.team());
  // A PUT's answer, shown until the next fetch lands (it's kept against the answer it replaced).
  const [put, setPut] = useState<{ over: VenueSettings | null; data: VenueSettings } | null>(null);
  const v = put && put.over === got.data ? put.data : got.data;
  // A refusal from a sheet closed mid-write, kept with its venue so another never shows it.
  const [said, setSaid] = useState<{ hostId: string; line: string } | null>(null);
  const shown = useMemo(() => {
    if (!admin) return null;
    const team = crew.data ? teamFrom(crew.data, meId) : { team: [], invites: [] };
    const types = v ? v.stations.filter((s) => !s.archived).map(fromStation) : [];
    const venue = { ...blank(admin), area: v?.area ?? '', open: v ? weekSpan(v.week) : ([0, 24] as [number, number]), types };
    return { venue, setup: v ? setupFrom(v, team) : null };
  }, [admin, v, crew.data, meId]);
  if (!admin || !to || !shown) return null;
  // Every answer: a fresh fetch (a refusal may mean someone else changed it); a write with no answer may have landed.
  const venueSaid = (r: Result<unknown>) => {
    got.reload();
    if (r.ok) reloadDay();
    return r.ok ? null : refusal(r, true);
  };
  const teamSaid = (r: Result<unknown>) => {
    crew.reload();
    return r.ok ? null : refusal(r, true);
  };
  const send = async (body: unknown): Said => {
    const ok = PutVenue.safeParse(body);
    if (!ok.success) return fieldWhy(ok.error);
    const base = got.data;
    const r = await to.put(ok.data);
    const back = r.ok ? checkVenue(r.data) : undefined;
    if (!back) return venueSaid(r);
    setPut({ over: base, data: back });
    reloadDay();
    return null;
  };
  // The venue as the API has it now, for a PUT made on it.
  const fresh = async (): Promise<{ v: VenueSettings | null } | { line: string }> => {
    const r = readVenue(await to.get(), checkVenue);
    return r.ok ? { v: r.data } : { line: refusal(r) };
  };
  return {
    ...shown,
    load: { error: got.error ?? crew.error, status: got.error ? got.status : crew.status, notSetUp: v === null && !got.loading && !got.error, reload: () => (got.reload(), crew.reload()) },
    said: said && said.hostId === admin.hostId ? said.line : null,
    tell: (line: string | null) => setSaid(line ? { hostId: admin.hostId, line } : null),
    // ponytail: a first save meeting another between this GET and the PUT still lands as an update; telling them apart
    // needs a create-only error code from the API.
    first: async (b: PutVenue): Said => {
      const now = await fresh();
      if ('line' in now) return now.line;
      if (now.v) return got.reload(), 'This venue was just set up. Pull to see it.';
      return send(b);
    },
    // Fetched again first, so the edit lands on the venue as it is now (putFor).
    // ponytail: no place search in the host app, so the pin only moves when someone pastes one in (Place sheet).
    changeSetup: async (f: (s: VenueSetup) => VenueSetup): Said => {
      const now = await fresh();
      if ('line' in now) return now.line;
      if (!now.v) return got.reload(), 'Set up the venue first.';
      return send(putFor(now.v, f));
    },
    saveKind: async (t: StationType, tile: 'gaming' | 'sports'): Said => {
      const b = kindBody(t, shown.venue.types.some((x) => x.id === t.id), tile);
      if ('edit' in b) {
        const ok = EditStation.safeParse(b.edit);
        return ok.success ? venueSaid(await to.editStation(t.id, ok.data)) : fieldWhy(ok.error);
      }
      const ok = NewStation.safeParse(b.add);
      return ok.success ? venueSaid(await to.addStation(ok.data)) : fieldWhy(ok.error);
    },
    // Archive, or Restore (archived false).
    archiveKind: async (id: string, archived: boolean): Said => venueSaid(await to.editStation(id, { archived })),
    invite: async (contact: string, role: 'Admin' | 'Desk'): Said => {
      const ok = InviteAdmin.safeParse(inviteBody(contact, role));
      return ok.success ? teamSaid(await to.invite(inviteBody(contact, role))) : fieldWhy(ok.error);
    },
    endSeat: async (id: string): Said => teamSaid(await to.remove(id)),
    confirmSeat: async (id: string): Said => teamSaid(await to.confirm(id)),
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

/** The station state with the Venue tab's venue on top: the API's, for an Admin. */
export function useVenue() {
  const s = useStation();
  return { ...s, ...s.venueTab };
}

/** The station state with Today's day on top (once it's loaded). Today and its sheets. */
export function useToday() {
  const s = useStation();
  return { ...s, ...s.today! };
}
