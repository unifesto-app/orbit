// What Home shows, from who is looking and what's on. Pure, so it runs on Node in layout.test.ts;
// src/app/index.tsx only draws what this returns. Rules: the Discover flow doc and the picked
// Home B boards on the Orbit canvas (owner, 15 Nov 2026).
import { isServed, type Slide as Featured } from '@orbit/contract';

// source: "gps" when found from the phone's position, "pick" when chosen from the city list (src/app/location.tsx).
// `state` is a picked city's state or the geocoder's region; places saved before it existed work it out (stateOf).
export type Place = { area: string; city: string; state?: string; nearAreas: readonly string[]; source?: 'gps' | 'pick' };
// The fields of expo-location's LocationGeocodedAddress this reads.
export type Address = { district: string | null; city: string | null; subregion: string | null; region: string | null };

// What the phone's geocoder calls a spot, as Home's two lines: the neighbourhood over its city ("Gachibowli",
// "Hyderabad"). With no neighbourhood the city leads over its state, the same shape as a picked city. Never the same
// name twice: "Hyderabad, Hyderabad" reads as a bug (the web's rule too).
export function placeName(a: Address): { area: string; city: string; state?: string } | null {
  const city = a.city || a.subregion || '';
  const area = a.district || city;
  if (!area) return null;
  return { area, city: [city, a.region].find((name) => name && name !== area) ?? '', ...(a.region && { state: a.region }) };
}

export type Viewer = {
  signedIn: boolean;
  initial?: string;
  follows: readonly string[]; // host ids
  place: Place | null;
  tickets?: readonly { eventId: string; label: string }[]; // the viewer's upcoming bookings
  interests?: readonly string[]; // category slugs picked on Account › Interests; unset until picked or skipped
};
export type PlanEvent = { id: string; hostId: string; area: string; startsAt: string; announced: string; category?: string; wide?: unknown };
export type PlanHost = { id: string; area: string; joined: string; banner?: unknown; tile?: string }; // tile: a place to play's
// `custom`: Orbit's own image slide from Galaxy's App content (owner, 19 Nov 2026: "also add custom ads in carousel").
export type Slide<E, H> = { kind: 'event'; event: E } | { kind: 'host'; host: H } | { kind: 'custom'; custom: Featured };

const DAY = 86_400_000;
const MAX_SLIDES = 6; // owner, 15 Nov 2026: "around 6"
const MAX_ORBIT = 3;
const MAX_HOSTS = 4; // two rows of two host cards
const MAX_PLACES = 3;


// `promoted` says which events are marked Promoted now (isPromoted in src/rows.tsx): one leads the carousel, the next is
// the banner in the middle (`ad`). `featured` is staff's live carousel picks and image slides, in their order
// (src/content.ts, useFeatured).
export function planHome<E extends PlanEvent, H extends PlanHost>(
  viewer: Viewer,
  events: readonly E[],
  hosts: readonly H[],
  now: number,
  promoted: (e: E) => boolean = () => false,
  featured: readonly Featured[] = [],
) {
  // Compared as times, not strings, so mixed UTC offsets still sort right.
  const upcoming = events.filter((e) => Date.parse(e.startsAt) >= now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  // ponytail: an area list stands in for the 25 km check until events and hosts carry coordinates.
  const isNear = (area: string) => viewer.place?.nearAreas.includes(area) ?? false;
  const following = viewer.signedIn && viewer.follows.length > 0;
  const followed = new Set(following ? viewer.follows : []);

  // The viewer's bookings, soonest first (shown as a Wallet-style stack, owner 15 Nov 2026).
  const booked = new Set(viewer.signedIn ? (viewer.tickets ?? []).map((t) => t.eventId) : []);
  const tickets = upcoming.filter((e) => booked.has(e.id));

  // One card per followed host, its next date; the soonest hosts first.
  const seen = new Set<string>();
  const orbit = upcoming
    .filter((e) => followed.has(e.hostId) && !booked.has(e.id) && !seen.has(e.hostId) && seen.add(e.hostId))
    .slice(0, MAX_ORBIT);

  // Outside Telangana and Andhra Pradesh Orbit isn't open yet: Coming soon, and everything on where it is (owner, 19 Nov
  // 2026: "only ap & telangana. other than it unserviceable. or coming soon").
  const notice: 'noLocation' | 'comingSoon' | 'nothingNear' | null = !viewer.place
    ? 'noLocation'
    : !isServed(viewer.place)
      ? 'comingSoon'
      : upcoming.some((e) => isNear(e.area))
      ? null
      : 'nothingNear';
  const shown = new Set([...tickets.map((e) => e.id), ...orbit.map((e) => e.id)]);
  const rest = upcoming.filter((e) => !shown.has(e.id));

  // Nothing near or no location: everything upcoming. Otherwise this week near you, and under four of
  // those, everything upcoming near you (decision 4).
  let list: { title: 'Near you this week' | 'Coming up'; events: E[] };
  if (notice) list = { title: 'Coming up', events: rest };
  else {
    const near = rest.filter((e) => isNear(e.area));
    const week = near.filter((e) => Date.parse(e.startsAt) < now + 7 * DAY);
    list = week.length >= 4 ? { title: 'Near you this week', events: week } : { title: 'Coming up', events: near };
  }
  // The kinds of event you picked (Account › Interests, or Home's ask) lead the list, each part still soonest first.
  // They were a section each ("Gaming near you"; owner, 19 Nov 2026: interest cards, "all four") until the owner merged
  // them: "merge all near you's into Near you this week".
  const liked = new Set(viewer.signedIn ? (viewer.interests ?? []) : []);
  const likes = (e: E) => !!e.category && liked.has(e.category);
  list.events = [...list.events.filter(likes), ...list.events.filter((e) => !likes(e))];

  // Places to play, booked by the hour (owner, 19 Nov 2026: "Add to Home too"): near you, or everywhere while Home shows
  // a notice, as the list. They have their own section, so they stay out of Hosts near you.
  const places = hosts.filter((h) => h.tile && (notice || isNear(h.area))).slice(0, MAX_PLACES);

  // Promoted events with a 4:3 poster, near you while anything is, not ones you've booked: the first leads the carousel,
  // the second is the banner in the middle of Home (owner, 19 Nov 2026: "promotion banners", "ad banners in middle of
  // home"), so neither shows twice up there.
  const boosts = upcoming.filter((e) => e.wide && promoted(e) && !booked.has(e.id) && (notice || isNear(e.area)));
  const lead = boosts[0];
  // The banner is the next one no section above already shows (your orbit); the screen keeps it out of
  // the list under them. It stays in `list` here, so "All events" still knows when the list is everything.
  const ad = boosts.slice(1).find((e) => !shown.has(e.id));

  // Hosts near you: up to three to follow, then ones the viewer already follows (owner, 15 Nov 2026), four at most.
  const near = hosts.filter((h) => !h.tile && isNear(h.area));
  const nearHosts = [...near.filter((h) => !followed.has(h.id)).slice(0, 3), ...near.filter((h) => followed.has(h.id))].slice(0, MAX_HOSTS);

  return {
    tickets,
    orbit,
    near: notice === null, // whether Places to play is near you
    // Home asks once, signed in, until interests are picked or skipped.
    askInterests: viewer.signedIn && viewer.interests === undefined,
    notice,
    list,
    places,
    hosts: nearHosts,
    hostsFirst: !following, // "Start your orbit" leads until the viewer follows someone
    // The end of Home (owner, 15 Nov 2026): every upcoming event, everywhere. Skipped when the list above already is that.
    // The list above is always a subset of `upcoming`, so the same length means the same events.
    all: notice || list.events.length === upcoming.length ? [] : upcoming,
    slides: pickSlides(upcoming.filter((e) => e !== ad), hosts, followed, following, notice === null, isNear, lead, featured),
    lead, // the carousel's paid slide: the only one marked Promoted there
    ad,
  };
}

// The carousel only shows things with a 4:3 visual: an event's landscape poster ("Book ticket") or a host's
// banner ("View events"). Following hosts: their newest events, plus new hosts near you to follow (owner, 15 Nov 2026:
// "add some view events"). Otherwise the newest events and hosts near you, or anywhere when nothing is near.
// Newest = announced (events) or joined (hosts).
// A promoted event leads (owner, 19 Nov 2026: "promotion banners", the promoted slide picked), following or not. One
// at most. Then staff's featured slides in their order (owner, 19 Nov 2026: "featured", "Lead Home's carousel"),
// anywhere, unlabelled: a pick shows only while its event is coming up with a 4:3 poster, or its host has a banner.
// Then the usual picks. Nothing twice, six slides in all.
function pickSlides<E extends PlanEvent, H extends PlanHost>(
  upcoming: readonly E[],
  hosts: readonly H[],
  followed: ReadonlySet<string>,
  following: boolean,
  hasNear: boolean,
  isNear: (area: string) => boolean,
  lead: E | undefined,
  featured: readonly Featured[],
): Slide<E, H>[] {
  const picked = featured.flatMap((f): Slide<E, H>[] => {
    if (f.kind === 'image') return [{ kind: 'custom', custom: f }];
    const [, page, id] = (f.href ?? '').split('/');
    const event = page === 'event' ? upcoming.find((e) => e.id === id && e.wide) : undefined;
    const host = page === 'host' ? hosts.find((h) => h.id === id && h.banner) : undefined;
    return event ? [{ kind: 'event', event }] : host ? [{ kind: 'host', host }] : [];
  });
  const rest = pickRest(upcoming.filter((e) => e !== lead), hosts, followed, following, hasNear, isNear);
  const seen = new Set<unknown>();
  const once = (s: Slide<E, H>) => {
    const key = s.kind === 'event' ? s.event : s.kind === 'host' ? s.host : s.custom;
    return !seen.has(key) && !!seen.add(key);
  };
  return [...(lead ? [{ kind: 'event' as const, event: lead }] : []), ...picked, ...rest].filter(once).slice(0, MAX_SLIDES);
}

function pickRest<E extends PlanEvent, H extends PlanHost>(
  upcoming: readonly E[],
  hosts: readonly H[],
  followed: ReadonlySet<string>,
  following: boolean,
  hasNear: boolean,
  isNear: (area: string) => boolean,
): Slide<E, H>[] {
  const events = upcoming.filter((e) => e.wide).map((e) => ({ slide: { kind: 'event', event: e } as const, at: e.announced, area: e.area, hostId: e.hostId }));
  const hostSlides = hosts
    .filter((h) => h.banner && !followed.has(h.id))
    .map((h) => ({ slide: { kind: 'host', host: h } as const, at: h.joined, area: h.area }));
  const nearOnly = <T extends { area: string }>(items: T[]) => items.filter((s) => !hasNear || isNear(s.area));

  const fromOrbit = events.filter((s) => followed.has(s.hostId));
  const pool = following && fromOrbit.length ? [...fromOrbit, ...nearOnly(hostSlides)] : nearOnly([...events, ...hostSlides]);
  return pool.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_SLIDES).map((s) => s.slide);
}
