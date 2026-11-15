// What the Search tab finds (Discover flow doc, Search, 15 Nov 2026). One box matches upcoming events by title, host,
// area or category, case-insensitively, up to 100 characters; the app also finds hosts, by name or area. Chips narrow
// the events by When (counted in India time), Free and one category. Soonest first.
// ponytail: an event counts as upcoming while its start is ahead, and When matches its start; both move to "until it
// ends" and overlap once events carry an end time. Link-only, cancelled and sub-events are the API's to leave out.
import { type CategorySlug, categories } from '@orbit/contract';

export const WHEN = [
  { id: 'today', label: 'Today', phrase: 'today' },
  { id: 'weekend', label: 'This weekend', phrase: 'this weekend' },
  { id: 'week', label: 'Next 7 days', phrase: 'in the next 7 days' },
] as const;
export type When = (typeof WHEN)[number]['id'];

export type Filters = { q: string; when?: When; free: boolean; category?: CategorySlug };
type Findable = { hostId: string; title: string; area: string; category: CategorySlug; startsAt: string; pricePaise: number };
type FindableHost = { id: string; name: string; area: string };

export const MAX_QUERY = 100;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000; // India has one zone and no daylight saving
const label = (slug: CategorySlug) => categories.find((c) => c.slug === slug)?.label ?? '';

// [from, to) for a When chip. "This weekend" is Saturday and Sunday; on either day, what's left of it.
export function span(when: When, now: number): [number, number] {
  const today = Math.floor((now + IST) / DAY) * DAY - IST; // midnight in India
  if (when === 'today') return [now, today + DAY];
  if (when === 'week') return [now, now + 7 * DAY];
  const weekday = new Date(now + IST).getUTCDay(); // 0 Sunday … 6 Saturday
  if (weekday === 0) return [now, today + DAY];
  if (weekday === 6) return [now, today + 2 * DAY];
  return [today + (6 - weekday) * DAY, today + (8 - weekday) * DAY];
}

export function search<E extends Findable, H extends FindableHost>(f: Filters, events: readonly E[], hosts: readonly H[], now: number) {
  const needle = f.q.trim().slice(0, MAX_QUERY).toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(needle);
  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? '';
  const window = f.when && span(f.when, now);
  const found = events
    .filter((e) => {
      const at = Date.parse(e.startsAt);
      return (
        at >= now &&
        (!needle || has(e.title) || has(hostName(e.hostId)) || has(e.area) || has(label(e.category))) &&
        (!window || (at >= window[0] && at < window[1])) &&
        (!f.free || e.pricePaise === 0) &&
        (!f.category || e.category === f.category)
      );
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return { events: found, hosts: needle ? hosts.filter((h) => has(h.name) || has(h.area)) : [] };
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
