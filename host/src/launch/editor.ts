// The event editor in Event Partner (X1): a draft's fields as typed, the PATCH body they make (only what changed from
// the event as loaded, so what the form can't show, an end not on the hour or a place's coordinates, is never
// overwritten), prices typed in whole rupees, and publish's 409 `missing` list in plain words. Pure, so it's tested
// under node; the screen is app/edit.tsx. The rules are the contract's own schemas, never copied here.
import { DETAIL_KEYS, EditEvent, EventDetails, FEST_TYPES, formatLines, mediaRatio, parseLines, type PublishMissing, type TeamEvent } from '@orbit/contract';

export type FestType = (typeof FEST_TYPES)[number];

export type Form = {
  title: string;
  category: string | null;
  startsAt: string | null;
  minutes: number | null; // how long it lasts; endsAt is startsAt plus this
  venue: string;
  address: string;
  area: string;
  city: string | null;
  about: string;
  // Details, as typed: every stored key, so switching category shows what's kept for that one. Lists are "A | B" lines.
  language: string;
  seating: string;
  style: string;
  bring: string;
  onSite: string;
  teamMin: string;
  teamMax: string;
  tracks: string;
  prizes: string;
  rounds: string;
  criteria: string;
  festType: FestType | null;
  highlights: string; // one per line
  inRoom: boolean;
  minAge: 18 | 21 | null;
};

export const LASTS = [1, 2, 3, 4, 6, 8].map((h) => h * 60); // the chips, in minutes

const MIN = 60_000;
export const formOf = (e: TeamEvent): Form => ({
  title: e.title,
  category: e.category,
  startsAt: e.startsAt,
  minutes: e.startsAt && e.endsAt ? Math.round((Date.parse(e.endsAt) - Date.parse(e.startsAt)) / MIN) : null,
  venue: e.place?.venue ?? '',
  address: e.place?.address ?? '',
  area: e.place?.area ?? '',
  city: e.place?.city ?? null,
  about: e.about ?? '',
  ...detailsForm(e.details ?? {}),
  inRoom: !!e.inRoom,
  minAge: e.minAge ?? null,
});

const detailsForm = (d: EventDetails) => ({
  language: d.language ?? '',
  seating: d.seating ?? '',
  style: d.style ?? '',
  bring: d.bring ?? '',
  onSite: d.onSite ?? '',
  teamMin: d.teamMin?.toString() ?? '',
  teamMax: d.teamMax?.toString() ?? '',
  tracks: formatLines((d.tracks ?? []).map((r) => [r.name, r.brief])),
  prizes: formatLines((d.prizes ?? []).map((r) => [r.place, r.prize])),
  rounds: formatLines((d.rounds ?? []).map((r) => [r.name, r.when])),
  criteria: formatLines((d.criteria ?? []).map((r) => [r.name, r.weight])),
  festType: d.festType ?? null,
  highlights: (d.highlights ?? []).join('\n'),
});

// The category's own details as typed, unchecked: blanks left out; a number that isn't one stays NaN, so the schema
// refuses it (and Save stays off) rather than the field quietly vanishing.
export function detailsOf(f: Form): Record<string, unknown> {
  const num = (t: string) => (t.trim() ? Number(t.trim()) : undefined);
  const lines = <K extends string, L extends string>(t: string, a: K, b: L) => {
    const rows = parseLines(t).map(([x, y]) => ({ [a]: x, [b]: y }) as Record<K | L, string>);
    return rows.length ? rows : undefined;
  };
  const highlights = f.highlights.split('\n').map((l) => l.trim()).filter(Boolean);
  const all: Record<string, unknown> = {
    language: f.language.trim() || undefined,
    seating: f.seating.trim() || undefined,
    style: f.style.trim() || undefined,
    bring: f.bring.trim() || undefined,
    onSite: f.onSite.trim() || undefined,
    teamMin: num(f.teamMin),
    teamMax: num(f.teamMax),
    tracks: lines(f.tracks, 'name', 'brief'),
    prizes: lines(f.prizes, 'place', 'prize'),
    rounds: lines(f.rounds, 'name', 'when'),
    criteria: lines(f.criteria, 'name', 'weight')?.map((c) => ({ name: c.name, weight: c.weight ? Number(c.weight) : NaN })),
    festType: f.festType ?? undefined,
    highlights: highlights.length ? highlights : undefined,
  };
  const keys = DETAIL_KEYS[f.category as keyof typeof DETAIL_KEYS] ?? [];
  return Object.fromEntries(keys.filter((k) => all[k] !== undefined).map((k) => [k, all[k]]));
}
// Why the details can't be saved, in the schema's words (weights not adding to 100), or null.
// The contract's own words for its checks (weights, team sizes); Zod's type and length wording reads as "Check <field>".
const NAMES: Record<string, string> = {
  language: 'the language', seating: 'the seating', style: 'what’s played', bring: 'what to bring', onSite: 'what’s there already',
  teamMin: 'the smallest team (1 to 10)', teamMax: 'the biggest team (1 to 10)', tracks: 'the tracks (8 at most, each “Name | brief”)',
  prizes: 'the prizes (10 at most, each “Place | prize”)', rounds: 'the rounds (3 at most, each “Name | when”)',
  criteria: 'Judged on (8 at most, each “Name | weight”)', festType: 'the kind of fest', highlights: 'What’s on (6 at most)',
};
export const detailsProblem = (f: Form) => {
  const i = EventDetails.safeParse(detailsOf(f)).error?.issues[0];
  if (!i) return null;
  return i.code === 'custom' ? i.message : `Check ${NAMES[String(i.path[0])] ?? 'the details'}.`;
};

// The place goes only whole (venue, address, area and city), or as null when none is typed; half of one is `null` here
// and `placeHalf` says so.
const placeOf = (f: Form) => {
  const [venue, address, area] = [f.venue.trim(), f.address.trim(), f.area.trim()];
  return venue && address && area && f.city ? { venue, address, area, city: f.city } : null;
};
export const placeHalf = (f: Form) => !placeOf(f) && !!(f.venue.trim() || f.address.trim() || f.area.trim());

// PATCH /events/:id: only the keys changed from `was` (the form as the event loaded). A retyped place is sent typed by
// hand, with no coordinates: the event then matches by its city.
export function bodyOf(f: Form, was: Form) {
  const b: Record<string, unknown> = {};
  if (f.title.trim() !== was.title) b.title = f.title.trim();
  if (f.category !== was.category) b.category = f.category;
  if (f.startsAt !== was.startsAt) b.startsAt = f.startsAt;
  if (f.startsAt !== was.startsAt || f.minutes !== was.minutes) b.endsAt = f.startsAt && f.minutes ? new Date(Date.parse(f.startsAt) + f.minutes * MIN).toISOString() : null;
  if (f.venue !== was.venue || f.address !== was.address || f.area !== was.area || f.city !== was.city) b.place = placeOf(f);
  if ((f.about.trim() || null) !== (was.about || null)) b.about = f.about.trim() || null;
  // Details replace the saved category's own keys, so they go whole, and only when what that category shows changed.
  const details = detailsOf(f);
  if (JSON.stringify(details) !== JSON.stringify(detailsOf({ ...was, category: f.category }))) b.details = details;
  if (f.inRoom !== was.inRoom && f.category === 'meetups') b.inRoom = f.inRoom;
  if (f.minAge !== was.minAge) b.minAge = f.minAge;
  return b;
}
export const saveable = (f: Form, was: Form) => {
  const b = bodyOf(f, was);
  return Object.keys(b).length > 0 && !placeHalf(f) && EditEvent.safeParse(b).success;
};

// Whole rupees as typed ("499", "" or "0" for free) in paise, or null when it isn't a price (Rs 10 lakh at most).
export function paiseOf(rupees: string): number | null {
  const t = rupees.trim().replace(/,/g, '');
  if (t === '') return 0;
  if (!/^\d{1,7}$/.test(t) || Number(t) > 1_000_000) return null;
  return Number(t) * 100;
}
export const priceLabel = (paise: number) => (paise === 0 ? 'Free' : `₹${(paise / 100).toLocaleString('en-IN')}`);
export const lastsLabel = (min: number) => (min % 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min / 60} hr`);

// Publish's 409: each thing missing, said as the fix.
const FIX: Record<PublishMissing, string> = {
  poster: 'Add a 3:4 poster.',
  when: 'Pick a start that’s still ahead and how long it lasts.',
  where: 'Add the venue, address, area and city.',
  category: 'Pick a category.',
  tickets: 'Add at least one ticket type.',
};
export const fixesOf = (missing: readonly string[]) => missing.map((m) => FIX[m as PublishMissing] ?? 'Something else is missing.');

// The biggest centred box of a poster (3:4) or wide (4:3) inside a picked image, or null when the API will take it as
// is (its 1% slack). iOS's picker crops square whatever `aspect` asks, so the phone cuts the shape before uploading.
export function centreCrop(width: number, height: number, shape: 'poster' | 'wide') {
  const want = shape === 'poster' ? '3:4' : '4:3';
  if (mediaRatio(width, height) === want) return null;
  const [rw, rh] = shape === 'poster' ? [3, 4] : [4, 3];
  const side = Math.min(width / rw, height / rh);
  const w = Math.floor(side * rw);
  const h = Math.floor(side * rh);
  return { originX: Math.floor((width - w) / 2), originY: Math.floor((height - h) / 2), width: w, height: h };
}
