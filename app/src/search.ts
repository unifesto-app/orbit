// What the Search tab finds (Discover flow doc, Search, 15 Nov 2026). One box matches upcoming events by title, host,
// area or category, case-insensitively, up to 100 characters; the app also finds hosts, by name, area or their one
// line (so "turf", "badminton" or "gaming" finds the places to play; owner, 19 Nov 2026). Chips narrow
// the events by When (counted in India time), Free and one category. Soonest first.
// ponytail: an event counts as upcoming while its start is ahead, and When matches its start; both move to "until it
// ends" and overlap once events carry an end time. Link-only, cancelled and sub-events are the API's to leave out.
import { type CategorySlug, categories, MAX_QUERY, span, WHEN, type WhenChip } from '@orbit/contract';
// The chips moved to the contract so the API counts them the same way.
export { MAX_QUERY, span, WHEN };
export type When = WhenChip;

export type Filters = { q: string; when?: When; free: boolean; category?: CategorySlug };
type Findable = { endsAt?: string; hostId: string; title: string; area: string; category: CategorySlug; startsAt: string; pricePaise: number };
type FindableHost = { id: string; name: string; area: string; about?: string; tile?: CategorySlug }; // tile: a place to play's

const label = (slug: CategorySlug) => categories.find((c) => c.slug === slug)?.label ?? '';

export function search<E extends Findable, H extends FindableHost>(f: Filters, events: readonly E[], hosts: readonly H[], now: number) {
  const needle = f.q.trim().slice(0, MAX_QUERY).toLowerCase();
  // Every word somewhere in the fields, so "cricket turf" finds "Turf and box cricket".
  const words = needle.split(/\s+/).filter(Boolean);
  const has = (...texts: (string | undefined)[]) => {
    const hay = texts.join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  };
  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? '';
  const window = f.when && span(f.when, now);
  const found = events
    .filter((e) => {
      const at = Date.parse(e.startsAt);
      return (
        (e.endsAt ? Date.parse(e.endsAt) > now : at >= now) &&
        (!needle || has(e.title, hostName(e.hostId), e.area, label(e.category))) &&
        (!window || (at >= window[0] && at < window[1])) &&
        (!f.free || e.pricePaise === 0) &&
        (!f.category || e.category === f.category)
      );
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  // Typed text finds hosts; a tile alone finds its places to play (none of them is free).
  const foundHosts = needle
    ? hosts.filter((h) => has(h.name, h.area, h.about))
    : f.category && !f.free
      ? hosts.filter((h) => h.tile === f.category)
      : [];
  return { events: found, hosts: foundHosts };
}

/** Search's opening sections: from each list in turn, its first `n` not already in a section above. */
export function firstUnseen<T extends { id: string }>(lists: readonly (readonly T[])[], n = 3): T[][] {
  const seen = new Set<string>();
  return lists.map((list) => {
    const picked = list.filter((x) => !seen.has(x.id)).slice(0, n);
    for (const x of picked) seen.add(x.id);
    return picked;
  });
}

// The one-line count over the events: "4 events for “jam” in Music", "2 free events this weekend".
export function countLine(n: number, f: Filters) {
  const q = f.q.trim().slice(0, MAX_QUERY);
  const noun = `${n} ${f.free ? 'free ' : ''}${n === 1 ? 'event' : 'events'}`;
  if (!q && !f.category && !f.when) return `${noun} coming up`;
  return [
    noun,
    q && `for “${q}”`,
    f.category && `in ${label(f.category)}`,
    f.when && WHEN.find((w) => w.id === f.when)?.phrase,
  ]
    .filter(Boolean)
    .join(' ');
}
