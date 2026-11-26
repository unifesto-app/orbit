// Venue's words and checks (Station take 4, approved 22 Nov 2026), pure so venue.test.ts runs them on Node.
import { paiseFrom, rupees } from '../money.ts';
import { HOUR, hourWord, type StationType } from './day.ts';

/** A kind's price line: "₹162/hr · ₹120/hr 11 AM to 4 PM on weekdays · ₹350/hr for two · Valorant, CS2". */
export function priceLine(t: StationType): string {
  const parts = [`${rupees(t.price)}/hr`];
  if (t.offPeak) parts.push(`${rupees(t.offPeak.price)}/hr ${hourWord(t.offPeak.from)} to ${hourWord(t.offPeak.to)}${t.offPeak.weekdays ? ' on weekdays' : ''}`);
  if (t.coop) parts.push(`${rupees(t.coop)}/hr for two`);
  if (t.games) parts.push(t.games);
  return parts.join(' · ');
}

/** A day's hours as Venue writes them: "11 AM to 2 AM", or Closed. */
export const span = (open: readonly [number, number] | null) => (open ? `${hourWord(open[0])} to ${hourWord(open[1])}` : 'Closed');

/** Days left on an invite, which ends by itself 14 days after it's sent (Hosts flow, Team and roles). */
export const daysLeft = (sent: number, now: number) => Math.max(14 - Math.floor((now - sent) / (24 * HOUR)), 0);

/** Whether an invite's contact reads as a phone number (10 to 13 digits, a + and spaces allowed) or an email. */
export const contactOk = (text: string) => {
  const t = text.trim();
  return /^\+?[\d\s-]+$/.test(t) ? (t.match(/\d/g) ?? []).length >= 10 && (t.match(/\d/g) ?? []).length <= 13 : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
};

/** "3 bookings need more than 10: Meera P., 3 × Gaming PC, 7:30 to 10:30 PM; …, and 2 more": the first three named. */
export function inTheWay<T>(list: readonly T[], line: (x: T) => string): string {
  return list.slice(0, 3).map(line).join('; ') + (list.length > 3 ? `, and ${list.length - 3} more` : '');
}

/** More than one: "pitches", "boxes", "PCs", "bays". */
export const plural = (unit: string) => (/(s|x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`);

/** Whether a day's hours read right: opens before it closes, at most a day long, closing by 6 AM the next morning. */
export const hoursOk = (open: readonly [number, number]) => open[0] >= 0 && open[0] <= 23 && open[1] > open[0] && open[1] - open[0] <= 24 && open[1] <= 30;

export type KindForm = { name: string; unit: string; count: number; price: string; coop: string; op: 'none' | 'weekdays' | 'every'; opFrom: number; opTo: number; opPrice: string; games: string };
/**
 * A kind from Venue's sheet (Play, Setting up a venue): a name, how many, the price an hour, co-op for two (gaming), one
 * off-peak window inside the opening and cheaper than the price, and games. A new one also says what one is called;
 * Orbit sets how it starts and whether it's booked whole, from the venue's kind. Otherwise, why not.
 * ponytail: off-peak stops at midnight; a café's window past it waits for the slots API's per-day prices.
 */
export function kindFrom(f: KindForm, was: StationType | undefined, open: readonly [number, number], gaming: boolean, id: string): { kind: StationType } | { why: string } {
  const name = f.name.trim();
  const unit = (was?.unit[0] ?? f.unit).trim();
  if (!name) return { why: 'Give it a name.' };
  if (!unit) return { why: 'Say what one is called, like PC or pitch.' };
  const price = paiseFrom(f.price);
  if (!price) return { why: 'Its price an hour, in rupees.' };
  const coop = gaming && f.coop.trim() ? paiseFrom(f.coop) : undefined;
  if (gaming && f.coop.trim() && !coop) return { why: 'The co-op price in rupees, or leave it empty.' };
  let offPeak: StationType['offPeak'];
  if (f.op !== 'none') {
    const p = paiseFrom(f.opPrice);
    if (!p) return { why: 'The off-peak price in rupees.' };
    if (p >= price) return { why: 'Off-peak is cheaper than the price an hour.' };
    if (f.opFrom < open[0] || f.opTo > Math.min(open[1], 24) || f.opFrom >= f.opTo) return { why: 'Off-peak hours sit inside your opening, before midnight.' };
    offPeak = { from: f.opFrom, to: f.opTo, weekdays: f.op === 'weekdays', price: p };
  }
  const base = was ?? { id, unit: [unit, plural(unit)] as [string, string], step: (gaming ? 30 : 60) as 30 | 60, whole: !gaming };
  return { kind: { ...base, name, count: f.count, price, coop, games: gaming ? f.games.trim() || undefined : undefined, offPeak } };
}

// ---------- The API's venue (S5): GET/PUT /venues/:hostId, its stations, and the host's team ----------
// Signed in, an Admin's Venue reads and edits the real venue. Prices are paise both here and in the API; only the sheet's
// text boxes are rupees (kindFrom). The contract's zod checks run in state.tsx (Node can't load the contract's .ts).

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: { error: string; message: string } };
export type Authed = <T>(method: Method, path: string, body?: unknown) => Promise<Res<T>>;
/** GET /hosts/:id/team as an Admin reads it. */
export type TeamList = {
  members: { id: string; userId: string | null; name: string | null; role: string; owner: boolean }[];
  invites: { id: string; contact: string; accepted: boolean; acceptedBy: string | null; addedBy: string }[];
};
/** The station fields the API takes and sends (contract NewStation / StationRow), money in paise. */
export type StationBody = { name: string; unit: string; count: number; pricePaise: number; coopPaise: number | null; offPeak: { from: number; to: number; weekdays: boolean; pricePaise: number } | null; games: string | null };
export type StationRowish = StationBody & { id: string; whole: boolean; step: 30 | 60; archived: boolean };
export type Pin = { lat: number; lng: number; placeId: string | null };
/** What PUT /venues/:hostId takes and GET answers (contract VenueSetup / VenueSettings), less the stations. */
export type Settings = { address: string; area: string; lat: number; lng: number; placeId: string | null; deskPhone: string; week: ([number, number] | null)[]; cutoffMinutes: number; logsWalkIns: boolean };
/** Someone on the team (`id` is their seat). */
export type Member = { id: string; name: string; role: 'Admin' | 'Desk'; you?: boolean; owner?: boolean };
/**
 * An invite waiting (`id` is the seat it makes). An accepted Admin invite waits for its adder's confirm.
 * ponytail: no role or sent time from GET /hosts/:id/team yet; they show once the API sends them.
 */
export type Invite = { id: string; contact: string; role?: 'Admin' | 'Desk'; sent?: number; accepted?: boolean; acceptedBy?: string | null; addedBy?: string; byYou?: boolean; adder?: string | null };
/**
 * A venue's page and settings as Venue draws them, with its team and weekly hours (Sunday first). The API's area and map
 * pin ride along so a save sends them back; `archived` is the kinds put away, for Restore.
 * ponytail: no followers, "at your venue" asks or hosted events: they wait for the follows and event-venue links APIs.
 */
export type VenueSetup = {
  kind: string; address: string; deskPhone: string; logWalkIns: boolean; cutoff: number; week: ([number, number] | null)[];
  team: Member[]; invites: Invite[]; area?: string; pin?: Pin; archived?: StationType[];
};

export function venueApi(hostId: string, authed: Authed) {
  const at = `/venues/${hostId}`;
  const team = `/hosts/${hostId}/team`;
  return {
    get: () => authed<unknown>('GET', at),
    put: (b: unknown) => authed<unknown>('PUT', at, b),
    addStation: (b: object) => authed<unknown>('POST', `${at}/stations`, b),
    editStation: (id: string, b: object) => authed<unknown>('PATCH', `${at}/stations/${id}`, b),
    team: () => authed<TeamList>('GET', team),
    invite: (b: { to: string; role: 'admin' | 'desk' }) => authed<unknown>('POST', team, b),
    confirm: (seatId: string) => authed<unknown>('POST', `${team}/${seatId}/confirm`),
    remove: (seatId: string) => authed<unknown>('DELETE', `${team}/${seatId}`),
  };
}

/** A kind as the API takes it. A pitch or court has no co-op or games (the API drops them anyway). */
export const toStation = (t: StationType): StationBody => ({
  name: t.name,
  unit: t.unit[0],
  count: t.count,
  pricePaise: t.price,
  coopPaise: t.coop ?? null,
  offPeak: t.offPeak ? { from: t.offPeak.from, to: t.offPeak.to, weekdays: t.offPeak.weekdays, pricePaise: t.offPeak.price } : null,
  games: t.games ?? null,
});

/** The API's station as Venue draws a kind. */
export const fromStation = (s: StationRowish): StationType => ({
  id: s.id,
  name: s.name,
  count: s.count,
  unit: [s.unit, plural(s.unit)],
  step: s.step,
  whole: s.whole,
  price: s.pricePaise,
  coop: s.coopPaise ?? undefined,
  offPeak: s.offPeak ? { from: s.offPeak.from, to: s.offPeak.to, weekdays: s.offPeak.weekdays, price: s.offPeak.pricePaise } : undefined,
  games: s.games ?? undefined,
});

/** One span for the whole week, for a kind's off-peak bounds: earliest opening to latest close; all closed is a full day. */
export function weekSpan(week: readonly (readonly [number, number] | null)[]): [number, number] {
  const open = week.filter((d): d is readonly [number, number] => !!d);
  return open.length ? [Math.min(...open.map((d) => d[0])), Math.max(...open.map((d) => d[1]))] : [0, 24];
}

/**
 * A map pin from what Google Maps copies: "17.4401, 78.3489", or a link. A link's place (!3d…!4d…) beats its view
 * (@lat,lng), which is where the map was looking. Whole numbers count; 117.44 is never read as 17.44.
 */
export function pinFrom(text: string): { lat: number; lng: number } | undefined {
  const m = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ?? text.match(/(?<![\d.])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?![\d.])/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : undefined;
}

/**
 * What a refused request says: the API's own line (a 409's names the bookings in the way), or no answer. A write with no
 * answer (`sent`) may have landed, so it says to look first.
 * ponytail: every refusal reads alike; telling a booking in the way from a closed host apart needs the API's error codes.
 */
export const refusal = (r: { status: number; error: { message: string } }, sent = false) =>
  r.status !== 0 ? r.error.message : sent ? 'It may have gone through. Check before trying again.' : 'Can’t reach Orbit. Try again.';

/** GET /venues/:hostId's answer: a 404 is a venue not set up yet (null); a payload `check` can't read is an error. */
export function readVenue<T>(r: Res<unknown>, check: (x: unknown) => T | undefined): Res<T | null> {
  if (!r.ok) return r.status === 404 ? { ok: true, data: null } : r;
  const d = check(r.data);
  return d === undefined ? { ok: false, status: 200, error: { error: 'unreadable', message: 'Orbit sent a venue this app can’t read. Update the app.' } } : { ok: true, data: d };
}

/** The setup Venue draws from the API's venue, with the team. */
export function setupFrom(v: Settings & { stations: StationRowish[] }, team: { team: Member[]; invites: Invite[] }): VenueSetup {
  return {
    kind: 'Venue', address: v.address, area: v.area, deskPhone: v.deskPhone, logWalkIns: v.logsWalkIns, cutoff: v.cutoffMinutes, week: v.week,
    pin: { lat: v.lat, lng: v.lng, placeId: v.placeId }, archived: v.stations.filter((s) => s.archived).map(fromStation), ...team,
  };
}

/**
 * The PUT for an edit, made on the venue as the API has it now (`fresh`, just fetched), so one Admin's save never puts
 * back what another changed meanwhile. Only what the edit touched changes; a moved pin drops its Google place.
 */
export function putFor(fresh: Settings & { stations: StationRowish[] }, edit: (s: VenueSetup) => VenueSetup): Settings {
  const s = edit(setupFrom(fresh, { team: [], invites: [] }));
  const lat = s.pin?.lat ?? fresh.lat;
  const lng = s.pin?.lng ?? fresh.lng;
  const moved = lat !== fresh.lat || lng !== fresh.lng;
  return {
    address: s.address, area: s.area ?? fresh.area, lat, lng, placeId: moved ? null : (s.pin?.placeId ?? fresh.placeId),
    deskPhone: s.deskPhone, week: s.week, cutoffMinutes: s.cutoff, logsWalkIns: s.logWalkIns,
  };
}

/** A kind's request: an edit (what one is called is set once, so no unit) or a new one, which says its tile. */
export function kindBody(t: StationType, known: boolean, tile: 'gaming' | 'sports') {
  const body = toStation(t);
  if (known) {
    const { unit: _unit, ...edit } = body;
    return { edit } as const;
  }
  return { add: { ...body, tile } } as const;
}

/** An invite's request: Desk is the API's desk seat (crew), an Admin its admin. */
export const inviteBody = (contact: string, role: 'Admin' | 'Desk') => ({ to: contact.trim(), role: role === 'Desk' ? ('desk' as const) : ('admin' as const) });

const FIELDS: Record<string, string> = {
  name: 'the name', unit: 'what one is called', count: 'how many', pricePaise: 'the price', coopPaise: 'the co-op price', offPeak: 'off-peak',
  games: 'the games', address: 'the address', area: 'the area', lat: 'the map pin', lng: 'the map pin', placeId: 'the map pin',
  deskPhone: 'the desk phone', week: 'the hours', cutoffMinutes: 'the cancel time', to: 'the phone or email',
};
/** A zod refusal as one line: a rule's own words ("Off-peak is cheaper…"), else which field to look at. */
export function fieldWhy(e: { issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[] }): string {
  const i = e.issues[0];
  if (!i) return 'Check what you typed.';
  if (i.code === 'custom') return i.message;
  const f = FIELDS[String(i.path[0])];
  return f ? `Check ${f}.` : 'Check what you typed.';
}

/** The team as Venue draws it: Admins and Desk (the API's crew seat) only, the owner first, you marked. */
export function teamFrom(list: TeamList, meId: string): { team: Member[]; invites: Invite[] } {
  const team = list.members
    .filter((m) => m.role === 'admin' || m.role === 'crew')
    .map((m): Member => ({ id: m.id, name: m.name ?? 'Someone', role: m.role === 'admin' ? 'Admin' : 'Desk', you: m.userId === meId || undefined, owner: m.owner || undefined }))
    .sort((a, b) => Number(!!b.owner) - Number(!!a.owner));
  // Only whoever sent an Admin invite confirms it (api/src/roles/rules.ts confirmSeatRule): `byYou`, else who to wait for.
  // ponytail: no role or sent time on an invite; GET /hosts/:id/team would need to send them.
  const adder = (id: string) => list.members.find((m) => m.userId === id)?.name ?? null;
  return { team, invites: list.invites.map((x) => ({ id: x.id, contact: x.contact, accepted: x.accepted, acceptedBy: x.acceptedBy, addedBy: x.addedBy, byYou: x.addedBy === meId, adder: adder(x.addedBy) })) };
}
