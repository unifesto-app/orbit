// Events and hosts as the screens draw them, and the public reads that fill them (Orbit API /public, Discover flow;
// slice 1, 25 Nov 2026). The types moved here from src/mock.ts so the mock can go without touching a screen. Pure, so
// events.test.ts runs it on Node; screens pass it `api` from session.ts.
import type { CategorySlug, EventCard, HostCard, PublicEvent, WhenChip } from '@orbit/contract';
import type { ImageSourcePropType } from 'react-native';

import type { Credit, Tier } from './detail';
import { kindLabel, markOf } from './hosts.ts';
import type { makeApi } from './api.ts';
import type { PlanEvent, PlanHost, Place } from './home/layout';
import type { MediaItem } from './media';
import { indiaDay, indiaWhen } from './status.ts';
import type { StatusEvent } from './status';

export type Wide = { source: ImageSourcePropType; edge: string };
export type Host = PlanHost & {
  slug: string; // the link: /host/<slug> (the mock's is its id)
  name: string;
  initials: string;
  bg: string;
  fg: string;
  about: string; // the one line on cards
  kind: string; // "Comedy group", under Hosted by
  bio: string; // the host page's About
  followers: number; // shown from 10 (Discover decision 16)
  lovedBy?: number; // people who tapped Loved it on any of its events, once each; never shown (src/labels.ts)
  verified: boolean; // Orbit staff's call (Hosts flow)
  banner?: Wide;
};
// Seats, sale dates, a waitlist or a cancellation give the event its status (src/status.ts).
export type Event = PlanEvent &
  Omit<StatusEvent, 'startsAt' | 'announced' | 'pricePaise' | 'tiers'> & {
  slug: string; // the link: /event/<slug> (the mock's is its id)
  title: string;
  category: CategorySlug; // one per event (Discover decision 12)
  when: string; // pre-formatted in India time until real timestamps reach the UI
  repeats?: string; // only for a series, e.g. "Every Sunday" (Discover decision 15)
  pricePaise: number; // 0 = free
  poster: MediaItem; // 3:4
  wide?: Wide; // 4:3, for the carousel
  // The colour of the poster its page shows (the 4:3 when there is one), sampled once at upload like `edge`: its most
  // common vivid colour, or its dominant one when it has almost none. It tints that page's cards.
  tone: string;
  venue: { name: string; address: string };
  about: string;
  people?: Credit[]; // speakers, guests and the rest, in the order the host lists them
  tiers?: Tier[]; // ticket types, when there's more than one; pricePaise is then the card's price
  agenda?: { time: string; item: string }[]; // the event's slots, in order, shown when When is tapped
  faq?: { q: string; a: string }[];
  terms?: string[]; // the host's own terms for this event, shown above the usual ones (defaultTerms)
};

// The terms every event's Terms & Conditions ends with. They follow the Booking and Money flows: one QR per booking
// admitting everyone on it, refunds per booking, a cancelled event refunded in full.
// ponytail: placeholder wording until Orbit's own terms are written.
export const defaultTerms = [
  'Your ticket admits everyone booked on it. Show its QR code at the door.',
  'Tickets can’t be resold. The host may refuse entry on a ticket that has been.',
  'Refunds follow the host’s policy. If the host cancels the event, you get your money back in full.',
  'The host may refuse entry to anyone who breaks the venue’s rules or the host’s code of conduct.',
  'The event may be photographed or filmed.',
];
// Anyone on an event's page: a speaker, a guest, a judge. 1:1 photos come later; the monogram stands in.
export type Person = {
  id: string;
  name: string;
  initials: string;
  bg: string;
  fg: string;
  headline: string; // one line under the name
  bio: string;
  links: { label: string; url: string }[];
};

// A host card as the screens draw a host. The host page reads the full PublicHost for its About and followers.
export function toHost(c: HostCard): Host {
  const m = markOf(c);
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    ...m,
    area: c.city ?? '',
    about: `${kindLabel(c.kind)}${c.city ? ` · ${c.city}` : ''}`,
    kind: kindLabel(c.kind),
    bio: '',
    followers: 0,
    verified: c.verified,
    joined: '',
  };
}

// An agenda slot's time in India: "7:30 PM" on a one-day event, "Sat 9:00 AM" when it spans days.
const slot = (at: string, sameDay: boolean) => indiaWhen(at).replace(sameDay ? /^.* · / : /^(\w+) \d+ \w+ · /, sameDay ? '' : '$1 ');
const every = <T>(xs: readonly T[], has: (x: T) => boolean) => xs.length > 0 && xs.every(has);

// `near` is whether discover put it near you (Home's plan reads it instead of an area list).
export function toEvent(c: EventCard | PublicEvent, near?: boolean): Event {
  const t = c.tiers;
  const full = c as Partial<PublicEvent>;
  const sums = every(t, (x) => x.quantity !== null && x.left !== null);
  const opens = every(t, (x) => !!x.salesStartAt);
  const closes = every(t, (x) => !!x.salesEndAt);
  const at = (k: 'salesStartAt' | 'salesEndAt') => t.map((x) => Date.parse(x[k]!));
  return {
    id: c.id,
    slug: c.slug,
    hostId: c.host.id,
    title: c.title,
    category: (c.category ?? 'events') as CategorySlug,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    announced: c.publishedAt ?? c.startsAt,
    when: indiaWhen(c.startsAt),
    area: c.place?.area ?? 'Online',
    venue: c.place ? { name: c.place.venue, address: c.place.address } : { name: 'Online', address: '' },
    cancelled: c.status === 'cancelled',
    // ponytail: null (a published event with no tickets) reads as free; the API can't publish one, so it's only a guard.
    pricePaise: c.pricePaise ?? 0,
    ...(sums && { capacity: t.reduce((n, x) => n + x.quantity!, 0), left: t.reduce((n, x) => n + x.left!, 0) }),
    ...(opens && { salesOpen: new Date(Math.min(...at('salesStartAt'))).toISOString() }),
    ...(closes && { salesClose: new Date(Math.max(...at('salesEndAt'))).toISOString() }),
    // Not `seats`: that's places one ticket takes (a team ticket), which the API has no field for yet.
    ...(t.length > 1 && { tiers: t.map((x) => ({ name: x.name, pricePaise: x.pricePaise, soldOut: x.left !== null && x.left <= 0 })) }),
    poster: { source: { uri: c.poster ?? '' }, ratio: '3:4' },
    ...(c.wide && { wide: { source: { uri: c.wide }, edge: c.wideEdge ?? c.tone ?? markOf(c.host).bg } }),
    tone: c.tone ?? markOf(c.host).bg,
    about: full.about ?? '',
    ...(full.agenda?.length && { agenda: full.agenda.map((a) => ({ time: slot(a.at, indiaDay(c.startsAt) === indiaDay(c.endsAt)), item: a.item })) }),
    ...(full.faq?.length && { faq: full.faq }),
    ...(full.terms?.length && { terms: full.terms }),
    people: [], // performers are slice P8
    ...(near !== undefined && { near }),
  };
}

// The hosts of some events, once each.
export const hostsOf = (cards: readonly EventCard[]): Host[] => [...new Map(cards.map((c) => [c.host.id, toHost(c.host)])).values()];

// Where the viewer is, for the API: the phone's position when the place has one (inside India, as the API checks),
// else its city.
export type Where = { lat?: number; lng?: number; city?: string };
export function whereOf(p: Place | null): Where {
  if (!p) return {};
  // A picked city, or a position with no neighbourhood, has the city's name in `area` and the state in `city`.
  const city = p.source === 'pick' || (p.state && p.city === p.state) ? p.area : p.city;
  const inIndia = p.lat !== undefined && p.lng !== undefined && p.lat >= 6 && p.lat <= 37.5 && p.lng >= 68 && p.lng <= 97.5;
  return { ...(inIndia && { lat: p.lat, lng: p.lng }), ...(city && { city }) };
}

export type Filters = { q: string; when?: WhenChip; free: boolean; category?: CategorySlug };
const query = (o: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) s.set(k, String(v));
  return s.toString() ? `?${s}` : '';
};

type Api = Pick<ReturnType<typeof makeApi>, 'call'>;
// Public reads: `call`, never `authed`, so a visitor's read can't touch (or end) a session.
export function eventsApi(api: Api) {
  return {
    discover: (w: Where) => api.call<{ near: EventCard[]; elsewhere: EventCard[] }>('GET', `/public/discover${query(w)}`),
    search: (f: Filters, w: Where) =>
      api.call<{ events: EventCard[]; hosts: HostCard[] }>(
        'GET',
        `/public/search${query({ q: f.q.trim(), when: f.when, free: f.free, category: f.category, ...w })}`,
      ),
    event: (slug: string) => api.call<PublicEvent>('GET', `/public/events/${encodeURIComponent(slug)}`),
    hostEvents: (slug: string) => api.call<{ upcoming: EventCard[]; past: EventCard[] }>('GET', `/public/hosts/${encodeURIComponent(slug)}/events`),
  };
}
