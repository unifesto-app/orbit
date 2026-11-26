// The Event Request in Event Partner (take 1, approved 26 Nov 2026: docs/context/artifacts/event-request-take1.html;
// API: docs/context/event-partner-api.md 2b): what welcome shows for the latest request, the three steps' draft and
// when each step can go on, the body sent, the API's refusals in plain words, and the When sheet's days and times in
// India time. Pure, so it's tested under node; the screens are app/welcome.tsx and app/request.tsx.
// The rules are the contract's own schemas, never copied here.
import { type ApiError, type EventRequest, NewEventRequest, RequestEvent, RequestHost } from '@orbit/contract';

import { dayLabel, istDate, momentLabel } from './money.ts';

// ---------- Welcome ----------

// null or withdrawn: Host on Orbit with Start a request. open: waiting (Checking). changes and declined show Orbit's
// note. approved: the account is read again and the Admin redirect takes over. `venueOnly` (Play Partner, X9): a request
// of another kind, asked from Event Partner, is none here, whatever its state.
export type WelcomeState = 'start' | 'waiting' | 'changes' | 'declined' | 'approved';
export const welcomeState = (r: (Pick<EventRequest, 'status'> & { host?: { kind: string } }) | null, venueOnly = false): WelcomeState =>
  !r || r.status === 'withdrawn' || (venueOnly && r.host?.kind !== 'venue') ? 'start' : r.status === 'open' ? 'waiting' : r.status;

// "Sent today, 11:40 AM", or "Sent Mon 23 Nov, 11:40 AM" on an earlier day.
export function sentLabel(iso: string, now: number) {
  const t = Date.parse(iso);
  const at = momentLabel(t);
  return `Sent ${istDate(t) === istDate(now) ? `today, ${at.slice(at.indexOf(', ') + 2)}` : at}`;
}

// ---------- The draft ----------

// What the three steps hold, as typed. `owner`: the account that typed it; another account signed in on this phone never
// sees it. `edit`: it rewrites a request Orbit asked changes on (PATCH), not a new one, and `requestId` and `requestAt`
// (its updatedAt) say which round of changes, so a later round never sends old words. `skip`: a Venue or Performer
// chose "Skip, no event yet".
export type Draft = {
  owner: string;
  edit: boolean;
  requestId: string | null;
  requestAt: string | null;
  skip: boolean;
  name: string;
  kind: string | null;
  city: string | null;
  about: string;
  title: string;
  category: string | null;
  startsAt: string | null; // ISO with +05:30
  venue: string;
  paid: boolean;
  size: string;
};

export const emptyDraft = (owner: string, city: string | null): Draft => ({
  owner,
  edit: false,
  requestId: null,
  requestAt: null,
  skip: false,
  name: '',
  kind: null,
  city,
  about: '',
  title: '',
  category: null,
  startsAt: null,
  venue: '',
  paid: false,
  size: '',
});

// A sent request back in the steps: to read it (See request) or to change it (Edit request).
export const fromRequest = (r: Pick<EventRequest, 'id' | 'updatedAt' | 'host' | 'event'>, edit: boolean, owner: string): Draft => ({
  owner,
  edit,
  requestId: r.id,
  requestAt: r.updatedAt,
  skip: r.event === null,
  name: r.host.name,
  kind: r.host.kind,
  city: r.host.city,
  about: r.host.about ?? '',
  title: r.event?.title ?? '',
  category: r.event?.category ?? null,
  startsAt: r.event?.startsAt ?? null,
  venue: r.event?.venue ?? '',
  paid: r.event?.paid ?? false,
  size: r.event?.expectedSize ? String(r.event.expectedSize) : '',
});

// Each field's type in a kept draft; `?` may also be null.
const SHAPE: Record<keyof Draft, string> = {
  owner: 'string',
  edit: 'boolean',
  requestId: 'string?',
  requestAt: 'string?',
  skip: 'boolean',
  name: 'string',
  kind: 'string?',
  city: 'string?',
  about: 'string',
  title: 'string',
  category: 'string?',
  startsAt: 'string?',
  venue: 'string',
  paid: 'boolean',
  size: 'string',
};
// A kept draft, if it's this account's and still reads as one field by field (an older app's shape, or a broken one,
// is dropped, not half-read).
export function readDraft(json: string | null, owner: string): Draft | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    if (typeof d !== 'object' || !d || d.owner !== owner) return null;
    const fits = Object.entries(SHAPE).every(([k, t]) => (d[k] === null && t.endsWith('?')) || typeof d[k] === t.replace('?', ''));
    return fits && (d.startsAt === null || !Number.isNaN(Date.parse(d.startsAt as string))) ? (d as Draft) : null;
  } catch {
    return null;
  }
}
// Where Start a request begins: the kept new draft, else a blank one in the account's city.
export const newDraft = (kept: Draft | null, owner: string, city: string | null) => (kept && !kept.edit ? kept : emptyDraft(owner, city));
// Where Edit request begins: the kept edit of this very round of changes, else the request as sent.
export const editDraft = (kept: Draft | null, r: Pick<EventRequest, 'id' | 'updatedAt' | 'host' | 'event'>, owner: string) =>
  kept?.edit && kept.requestId === r.id && kept.requestAt === r.updatedAt ? kept : fromRequest(r, true, owner);

const hostOf = (d: Draft) => ({ name: d.name, kind: d.kind, city: d.city, about: d.about.trim() || null });
const eventOf = (d: Draft) => ({
  title: d.title,
  category: d.category,
  startsAt: d.startsAt,
  venue: d.venue.trim() || null,
  paid: d.paid,
  expectedSize: d.size.trim() ? Number(d.size.trim()) : null,
});
// POST /event-requests or PATCH /me/event-request.
export const bodyOf = (d: Draft) => ({ host: hostOf(d), event: d.skip ? null : eventOf(d) });

// Whether a step's Continue (or Send request, step 3) can go: the contract's schemas, and a start still ahead (the API
// refuses a past one).
export function stepOk(d: Draft, step: 1 | 2 | 3, now: number): boolean {
  if (step === 1) return RequestHost.safeParse(hostOf(d)).success;
  if (step === 2) return RequestEvent.safeParse(eventOf(d)).success && Date.parse(d.startsAt!) > now;
  return NewEventRequest.safeParse(bodyOf(d)).success && (d.skip || Date.parse(d.startsAt!) > now);
}

// Why step 2's Continue is off, when a typed answer is wrong rather than missing.
export function stepWhy(d: Draft, now: number): string | null {
  const n = Number(d.size.trim()); // as the body reads it
  if (d.size.trim() && !(Number.isInteger(n) && n >= 1 && n <= 1_000_000)) return 'How many people is a whole number, 1 or more.';
  if (d.startsAt && Date.parse(d.startsAt) <= now) return 'That time has passed. Pick a time that’s still ahead.';
  return null;
}

// "Skip, no event yet": only kinds the contract lets come without an event (Venue and Performer).
export const canSkip = (d: Draft) => NewEventRequest.safeParse({ host: hostOf(d), event: null }).success;

// The API's refusals in plain words, as one grey line.
export function errorText(e: Pick<ApiError, 'error' | 'message'>) {
  if (e.error === 'requestOpen') return 'You already have a request with Orbit. One at a time: edit or withdraw that one first.';
  if (e.error === 'tooMany') return 'You can send five requests a day. Try again tomorrow.';
  if (e.error === 'past') return 'That time has passed. Pick a time that’s still ahead.';
  if (e.error === 'notChanges') return 'Orbit is already checking this request, so it can’t be edited now.';
  return e.message;
}

// ---------- When: the month and the start times, in India time ----------

// A start time, minutes after midnight, as "7:30 PM".
export const timeLabel = (min: number) => `${Math.floor(min / 60) % 12 || 12}:${String(min % 60).padStart(2, '0')} ${min < 720 ? 'AM' : 'PM'}`;
// A day (YYYY-MM-DD) and a time as the instant sent, India time.
export const atIst = (day: string, min: number) => `${day}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+05:30`;
// The day and time an instant falls on, India time.
export function partsOf(iso: string) {
  const at = new Date(Date.parse(iso) + 19_800_000);
  return { day: at.toISOString().slice(0, 10), min: at.getUTCHours() * 60 + at.getUTCMinutes() };
}
// "Fri 12 Dec · 7:30 PM".
export function whenLabel(iso: string) {
  const { day, min } = partsOf(iso);
  return `${dayLabel(day)} · ${timeLabel(min)}`;
}

// Every half hour from 6 AM to 11:30 PM, those still ahead on that day.
// ponytail: no starts after midnight or before 6 AM; an all-nighter picks 11:30 PM and finishes the time in its draft.
const SLOTS = Array.from({ length: 36 }, (_, i) => 360 + i * 30);
export const slots = (day: string, now: number) => SLOTS.filter((min) => Date.parse(atIst(day, min)) > now);
// A day can be picked while one of its times is still ahead.
export const dayOpen = (day: string, now: number) => slots(day, now).length > 0;

// A month (YYYY-MM) as its days, Monday first, with blanks before the 1st.
export function monthDays(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
}
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "12 December", a calendar day as a screen reader says it.
export const dayName = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
