// The app's three modes: Home for everyone, Console for a host's team, Galaxy for Orbit's staff (owner, 16 Nov 2026:
// "bring the host management and galaxy in the app only"). Roles follow the Hosts and Galaxy flow docs.
// This only decides what the app draws; it protects nothing. The API is the gate: every host route checks the person's
// role there, and every staff route checks the staff feature it needs (Roles doc, owner 16 Nov 2026: no passkey or
// separate session for Galaxy, "role and access is enough").
// ponytail: `me` is a mock until the API's account endpoint returns teams and staff access.

export type EventRole = 'Curator' | 'Co-curator' | 'Crew';
export type Role = 'Admin' | EventRole;
// A place on a host's team (Hosts doc, Team and roles): Admin covers the whole host, the other roles one event each.
// The owner is the Admin who started the host.
export type Team = { hostId: string; owner: boolean; admin: boolean; events: Readonly<Record<string, EventRole>> };
// Orbit's staff (Roles doc, owner 16 Nov 2026: "replace them with role Staff with access to feature"): one Staff role,
// with access feature by feature, all of it in Galaxy in the app. The platform owner holds every feature. Access counts
// once a different holder of the Staff feature confirms it (or the platform owner, for their own adds).
export type StaffFeature = 'people' | 'hosts' | 'queues' | 'money' | 'platform' | 'staff';
export const STAFF_FEATURES: readonly StaffFeature[] = ['people', 'hosts', 'queues', 'money', 'platform', 'staff'];
export type Staff = { owner: boolean; features: readonly StaffFeature[]; confirmed: boolean };
export type Me = { id: string; teams: readonly Team[]; staff: Staff | null };

// Signed out, or anyone before the account loads: Home only.
export const nobody: Me = { id: '', teams: [], staff: null };

// Who the viewer is, to see each role's switcher: one mock per kind of person. Ids are invented; nothing real about
// staff or people goes in the bundle, which every install can read.
const teams: Team[] = [
  { hostId: 'punchline', owner: true, admin: true, events: {} },
  { hostId: 'circuitfeed', owner: false, admin: false, events: { 'build-anything-hackathon': 'Curator' } },
  { hostId: 'kickoff', owner: false, admin: false, events: { 'sunday-5-a-side': 'Crew' } },
];
export const previews = {
  // Abhinavtej Reddy (src/account/data.ts): owner and Admin of Punchline Collective, Curator of CircuitFeed's hackathon
  // tomorrow, Crew at Kickoff's Sunday 5-a-side, and Orbit's platform owner.
  staff: { id: 'u_viewer', teams, staff: { owner: true, features: STAFF_FEATURES, confirmed: true } },
  host: { id: 'u_viewer', teams, staff: null },
  attendee: { id: 'u_viewer', teams: [], staff: null },
  // A staff member with Money and Queues only, to see Galaxy's feature gates (rows that don't open, read-only requests).
  moneyStaff: { id: 'imran', teams: [], staff: { owner: false, features: ['money', 'queues'], confirmed: true } },
} satisfies Record<string, Me>;
// ponytail: change this word to see another role's switcher on a device; the API replaces it.
export const me: Me = previews.staff;

export const roleOn = (team: Team, eventId: string): Role | null => (team.admin ? 'Admin' : Object.hasOwn(team.events, eventId) ? team.events[eventId] : null);
// A host's events that someone on its team works on: every one for an Admin, else those they hold a role on.
export const eventsOn = <E extends { id: string; hostId: string }>(team: Team, events: readonly E[]) =>
  events.filter((e) => e.hostId === team.hostId && (team.admin || Object.hasOwn(team.events, e.id)));
// Only Admins and Curators touch money (Money flow). Host-wide numbers and the bank account are Admins' alone; a Curator
// sees the money of their own event.
export const seesHostMoney = (team: Team) => team.admin;
export const seesEventMoney = (team: Team, eventId: string) => ['Admin', 'Curator'].includes(roleOn(team, eventId) ?? '');
export const startsEvents = (team: Team) => team.admin; // Hosts decision 5
export const runsHost = (team: Team) => team.owner; // pause, archive and restore are the owner's

// The event-day card and the scanner show from 24 hours before the start until check-in closes, 3 hours after the end
// (Event day doc).
const HOUR = 3_600_000;
export const onEventDay = (startsAt: string, endsAt: string, now: number) =>
  now >= Date.parse(startsAt) - 24 * HOUR && now <= Date.parse(endsAt) + 3 * HOUR;

// A staff feature counts once confirmed; the platform owner holds them all. Galaxy shows only the features held.
export const hasFeature = (me: Me, f: StaffFeature) => !!me.staff?.confirmed && (me.staff.owner || me.staff.features.includes(f));
export const isStaff = (me: Me) => STAFF_FEATURES.some((f) => hasFeature(me, f));
// Staff never act on themselves, nor on a host whose team they're on (Galaxy doc, Staff; Roles doc). Galaxy still shows
// those, with their actions off.
// ponytail: "invited to, or left in the last 30 days" comes with the API's team history.
export const canActOn = (me: Me, target: { accountId?: string; hostId?: string }) =>
  target.accountId !== me.id && !me.teams.some((t) => t.hostId === target.hostId);

// The switcher's three cards (owner, 16 Nov 2026): Home for everyone; then Console on a team, or "Host an event"; then
// a third that fits the person. Staff get Galaxy; hosts (Admins, Curators, Co-curators, Crew) get Check-in, their events'
// check-in today; everyone else gets Saved, their saved events.
export type Mode = 'home' | 'console' | 'galaxy';
export type Third = 'galaxy' | 'checkin' | 'saved';
export const modesFor = (me: Me): { console: 'open' | 'start'; third: Third } => ({
  console: me.teams.length > 0 ? 'open' : 'start',
  third: isStaff(me) ? 'galaxy' : me.teams.length > 0 ? 'checkin' : 'saved',
});
