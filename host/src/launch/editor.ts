// The event editor in Event Partner (X1): a draft's fields as typed, the PATCH body they make, prices typed in whole
// rupees, and publish's 409 `missing` list in plain words. Pure, so it's tested under node; the screen is app/edit.tsx.
// The rules are the contract's own schemas, never copied here.
import { EditEvent, type PublishMissing, type TeamEvent } from '@orbit/contract';

export type Form = {
  title: string;
  category: string | null;
  startsAt: string | null;
  hours: number | null; // how long it lasts; endsAt is startsAt plus this
  venue: string;
  address: string;
  area: string;
  city: string | null;
  about: string;
};

export const LASTS = [1, 2, 3, 4, 6, 8];

export const formOf = (e: TeamEvent): Form => ({
  title: e.title,
  category: e.category,
  startsAt: e.startsAt,
  hours: e.startsAt && e.endsAt ? Math.round((Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 3_600_000) || null : null,
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

// PATCH /events/:id. Typed by hand, so no coordinates: the event matches by its city.
export const bodyOf = (f: Form) => ({
  title: f.title.trim(),
  category: f.category,
  startsAt: f.startsAt,
  endsAt: f.startsAt && f.hours ? new Date(Date.parse(f.startsAt) + f.hours * 3_600_000).toISOString() : null,
  place: placeOf(f),
  about: f.about.trim() || null,
});
export const saveable = (f: Form) => !placeHalf(f) && EditEvent.safeParse(bodyOf(f)).success;

// Whole rupees as typed ("499", "" or "0" for free) in paise, or null when it isn't a price (Rs 10 lakh at most).
export function paiseOf(rupees: string): number | null {
  const t = rupees.trim().replace(/,/g, '');
  if (t === '') return 0;
  if (!/^\d{1,7}$/.test(t) || Number(t) > 1_000_000) return null;
  return Number(t) * 100;
}
export const priceLabel = (paise: number) => (paise === 0 ? 'Free' : `₹${(paise / 100).toLocaleString('en-IN')}`);

// Publish's 409: each thing missing, said as the fix.
const FIX: Record<PublishMissing, string> = {
  poster: 'Add a 3:4 poster.',
  when: 'Pick a start that’s still ahead and how long it lasts.',
  where: 'Add the venue, address, area and city.',
  category: 'Pick a category.',
  tickets: 'Add at least one ticket type.',
};
export const fixesOf = (missing: readonly string[]) => missing.map((m) => FIX[m as PublishMissing] ?? 'Something else is missing.');
