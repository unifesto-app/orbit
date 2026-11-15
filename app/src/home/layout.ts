// What Home shows, from who is looking and what's on. Pure, so it runs on Node in layout.test.ts;
// src/app/index.tsx only draws what this returns. Rules: the Discover flow doc and the picked
// Home B boards on the Orbit canvas (owner, 15 Nov 2026).

// source: "gps" when found from the phone's position, "pick" when chosen from the city list (src/app/location.tsx).
export type Place = { area: string; city: string; nearAreas: readonly string[]; source?: 'gps' | 'pick' };
export type Viewer = {
  signedIn: boolean;
  initial?: string;
  follows: readonly string[]; // host ids
  place: Place | null;
  tickets?: readonly { eventId: string; label: string }[]; // the viewer's upcoming bookings
};
export type PlanEvent = { id: string; hostId: string; area: string; startsAt: string; announced: string; wide?: unknown };
export type PlanHost = { id: string; area: string; joined: string; banner?: unknown };
export type Slide<E, H> = { kind: 'event'; event: E } | { kind: 'host'; host: H };

const DAY = 86_400_000;
const MAX_SLIDES = 6; // owner, 15 Nov 2026: "around 6"
const MAX_ORBIT = 3;
const MAX_HOSTS = 4; // two rows of two host cards

// Repeat tags lose to this on orbit cards: a new date from a host you follow is the news.
export const justAnnounced = (e: PlanEvent, now: number) => now - Date.parse(e.announced) < 3 * DAY;

export function planHome<E extends PlanEvent, H extends PlanHost>(
  viewer: Viewer,
  events: readonly E[],
  hosts: readonly H[],
  now: number,
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

  const notice: 'noLocation' | 'nothingNear' | null = !viewer.place
    ? 'noLocation'
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

  // Hosts near you: up to three to follow, then ones the viewer already follows (owner, 15 Nov 2026), four at most.
  const near = hosts.filter((h) => isNear(h.area));
  const nearHosts = [...near.filter((h) => !followed.has(h.id)).slice(0, 3), ...near.filter((h) => followed.has(h.id))].slice(0, MAX_HOSTS);

  return {
    tickets,
    orbit,
    notice,
    list,
    hosts: nearHosts,
    hostsFirst: !following, // "Start your orbit" leads until the viewer follows someone
    // The end of Home (owner, 15 Nov 2026): every upcoming event, everywhere. Skipped when the list above already is that.
    // The list above is always a subset of `upcoming`, so the same length means the same events.
    all: notice || list.events.length === upcoming.length ? [] : upcoming,
    slides: pickSlides(upcoming, hosts, followed, following, notice === null, isNear),
  };
}

// The carousel only shows things with a 4:3 visual: an event's landscape poster ("Book ticket") or a host's
// banner ("View events"). Following hosts: their newest events, plus new hosts near you to follow (owner, 15 Nov 2026:
// "add some view events"). Otherwise the newest events and hosts near you, or anywhere when nothing is near.
// Newest = announced (events) or joined (hosts).
function pickSlides<E extends PlanEvent, H extends PlanHost>(
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
