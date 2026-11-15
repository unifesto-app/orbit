// What the event, host and person screens list, from the events. Pure, so it runs on Node in detail.test.ts; the
// screens in src/app/event, src/app/host and src/app/person only draw what this returns. Rules: the Discover flow doc's
// Event page and Host page sections (defaults accepted 15 Nov 2026).
// ponytail: an event counts as past once it starts, as on Search; the doc's "from its end time" comes with end times.

// What a person is at one event. A role belongs to the event, not the person: a judge at one can speak at another.
export const ROLES = ['Speaker', 'Guest', 'Performer', 'Judge', 'Mentor'] as const;
export type Role = (typeof ROLES)[number];
export type Credit = { personId: string; role: Role };
type Dated = { hostId: string; startsAt: string; people?: readonly Credit[] };

const MAX_PAST = 12; // a host page's past events, the latest 12
const at = (e: Dated) => Date.parse(e.startsAt);

// An event's people, one group per role in ROLES order, each under its plural: "Speakers", then "Guests"…
export function cast(people: readonly Credit[] = []) {
  return ROLES.map((role) => ({ title: `${role}s`, ids: people.filter((c) => c.role === role).map((c) => c.personId) })).filter(
    (g) => g.ids.length > 0,
  );
}

// A host's events: every upcoming one, soonest first, then the latest past ones, latest first.
export function hostEvents<E extends Dated>(hostId: string, events: readonly E[], now: number) {
  const own = events.filter((e) => e.hostId === hostId);
  return {
    upcoming: own.filter((e) => at(e) >= now).sort((a, b) => at(a) - at(b)),
    past: own
      .filter((e) => at(e) < now)
      .sort((a, b) => at(b) - at(a))
      .slice(0, MAX_PAST),
  };
}

// Where a person appears, with their role at each: upcoming soonest first, then past latest first.
export function appearances<E extends Dated>(personId: string, events: readonly E[], now: number) {
  const found = events.flatMap((event) =>
    (event.people ?? []).filter((c) => c.personId === personId).map((c) => ({ event, role: c.role, past: at(event) < now })),
  );
  return [
    ...found.filter((a) => !a.past).sort((a, b) => at(a.event) - at(b.event)),
    ...found.filter((a) => a.past).sort((a, b) => at(b.event) - at(a.event)),
  ];
}

// A ticket type on an event, such as Early bird or Team of 4.
export type Tier = { name: string; pricePaise: number; soldOut?: boolean };

// The ticket bar's price: the event's one price, or with more than one ticket type on sale, the cheapest of them, read
// as "Starting from" (owner, 15 Nov 2026: "in bottom cta if multiple tickets use starting from"). A free type among
// paid ones shows as Free, never "Starting from Free".
export function barPrice(e: { pricePaise: number; tiers?: readonly Tier[] }) {
  const open = (e.tiers ?? []).filter((t) => !t.soldOut);
  if (open.length === 0) return { paise: e.pricePaise, from: false };
  const paise = Math.min(...open.map((t) => t.pricePaise));
  return { paise, from: open.length > 1 && paise > 0 };
}

// "1,240 followers", shown from 10 followers up (Discover decision 16).
const count = new Intl.NumberFormat('en-IN');
export const followersLine = (n: number) => (n < 10 ? null : `${count.format(n)} followers`);
