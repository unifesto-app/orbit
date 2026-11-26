// The event editor in Event Partner (X1): a draft's fields as typed, the PATCH body they make (only what changed from
// the event as loaded, so what the form can't show, an end not on the hour or a place's coordinates, is never
// overwritten), prices typed in whole rupees, and publish's 409 `missing` list in plain words. Pure, so it's tested
// under node; the screen is app/edit.tsx. The rules are the contract's own schemas, never copied here.
import { EditEvent, mediaRatio, type PublishMissing, type TeamEvent } from '@orbit/contract';

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
});

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
