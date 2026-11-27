import { z } from "zod";
import type { EventCard, HostCard } from "./events.ts";
import { Text } from "./text.ts";

// People on events and what's inside a fest (orbit-pm X14). Staff put them on events in Galaxy (holders of Hosts); the
// app reads them on the event page, the person sheet and the fest item sheet. A person is a name on a page, never an
// account: no sign-in, no contact details. ponytail: no photo yet, the app draws the monogram; add a key with uploads.

// A link on a person's sheet: https only, as an event's online link. z.url passes a NUL through, which Postgres would refuse.
export const PersonLink = z.object({
  label: Text(1, 30),
  url: z
    .url({ protocol: /^https$/ })
    .max(500)
    .refine((s) => !s.includes("\u0000"), "Remove the NUL character"),
});
export type PersonLink = z.infer<typeof PersonLink>;

const PersonFields = z.object({
  name: Text(1, 80),
  headline: Text(1, 120), // the one line under the name
  bio: Text(1, 2000).nullable(),
  links: z.array(PersonLink).max(5),
});
// POST /galaxy/persons (Galaxy's /galaxy/people are accounts): a name and a line; no bio and no links unless given.
export const NewPerson = PersonFields.extend({ bio: PersonFields.shape.bio.default(null), links: PersonFields.shape.links.default([]) });
export type NewPerson = z.input<typeof NewPerson>;
// PATCH /galaxy/persons/:id
export const EditPerson = PersonFields.partial().refine((b) => Object.keys(b).length > 0, "Change at least one thing");
export type EditPerson = z.input<typeof EditPerson>;

export const MAX_EVENT_PEOPLE = 50;
// PUT /galaxy/events/:id/people: the whole list in the order the page shows it; each person once. `shown`: the people
// and roles the page showed, in order, so a change made since (a role too) is refused (409 stale) rather than overwritten.
export const SetEventPeople = z.object({
  shown: z.array(z.object({ personId: z.uuid(), role: z.string().max(30) })).max(MAX_EVENT_PEOPLE),
  people: z
    .array(z.object({ personId: z.uuid(), role: Text(1, 30) }))
    .max(MAX_EVENT_PEOPLE)
    .refine((a) => new Set(a.map((p) => p.personId)).size === a.length, "Each person once"),
});
export type SetEventPeople = z.input<typeof SetEventPeople>;

export const MAX_EVENT_ACTS = 10;
// PUT /galaxy/events/:id/acts and PUT /events/:id/acts: the event's acts (other hosts, public and live), the whole list
// in the order the page shows it; each once. Any public live host but the event's own; nobody asks the act (staff remove).
// `shown`: the acts the page showed, in order, so a change made since is refused (409 stale) rather than overwritten.
export const SetEventActs = z.object({
  shown: z.array(z.uuid()).max(MAX_EVENT_ACTS),
  hostIds: z
    .array(z.uuid())
    .max(MAX_EVENT_ACTS)
    .refine((a) => new Set(a).size === a.length, "Each act once"),
});
export type SetEventActs = z.input<typeof SetEventActs>;

export const FEST_ITEM_KINDS = ["Competition", "Performance", "Workshop", "Food"] as const;
export const FestItemKind = z.enum(FEST_ITEM_KINDS);
export type FestItemKind = z.infer<typeof FestItemKind>;

const FestItemFields = z.object({
  title: Text(1, 120),
  kind: FestItemKind,
  when: Text(1, 30), // as the fest page shows it: "10:30 AM", "All day"
  where: Text(1, 120), // "Main stage"
  about: Text(1, 2000),
  team: Text(1, 60).nullable(), // a competition's team size: "6 to 12 people"
  prize: Text(1, 120).nullable(),
  actHostId: z.uuid().nullable(), // the host on stage
});
// POST /galaxy/events/:id/fest-items: added at the end.
export const NewFestItem = FestItemFields.extend({
  team: FestItemFields.shape.team.default(null),
  prize: FestItemFields.shape.prize.default(null),
  actHostId: FestItemFields.shape.actHostId.default(null),
});
export type NewFestItem = z.input<typeof NewFestItem>;
// PATCH /galaxy/fest-items/:id
export const EditFestItem = FestItemFields.partial().refine((b) => Object.keys(b).length > 0, "Change at least one thing");
export type EditFestItem = z.input<typeof EditFestItem>;
export const MAX_FEST_ITEMS = 100;
// PUT /galaxy/events/:id/fest-items/order: every item's id, each once, in the new order.
export const OrderFestItems = z.object({
  ids: z
    .array(z.uuid())
    .max(MAX_FEST_ITEMS)
    .refine((a) => new Set(a).size === a.length, "Each item once"),
});
export type OrderFestItems = z.input<typeof OrderFestItems>;

// ---------- What the API answers ----------

// On an event's page, in the order staff set.
export type EventPerson = { id: string; name: string; headline: string; role: string };
// The act is shown only while its host is public and live (a HostCard, so the sheet's Follow has its id).
export type PublicFestItem = {
  id: string; title: string; kind: FestItemKind; when: string; where: string; about: string;
  team: string | null; prize: string | null; act: HostCard | null;
};
// GET /public/people/:id: upcoming soonest first, then past latest first.
export type PublicPerson = {
  id: string; name: string; headline: string; bio: string | null; links: PersonLink[];
  appearances: { role: string; event: EventCard }[];
};
// Galaxy
export type StaffPerson = { id: string; name: string; headline: string; bio: string | null; links: PersonLink[]; createdAt: string; updatedAt: string };
export type StaffFestItem = Omit<PublicFestItem, "act"> & { actHostId: string | null };
// An act as staff see it: `shown` is false while its host isn't public and live (the page drops it); who added it and when.
export type EventAct = { hostId: string; name: string; slug: string; shown: boolean; addedBy: { id: string; name: string | null } | null; addedAt: string };
// GET and PUT /events/:id/acts, in order: a hidden act's host is only its id to the event's team.
export type TeamAct = { hostId: string; shown: true; name: string; slug: string } | { hostId: string; shown: false };
// GET /galaxy/events/:id/lineup: the event's people (their full record and role), its fest items and its acts, in order.
export type StaffLineup = { people: (StaffPerson & { role: string })[]; festItems: StaffFestItem[]; acts: EventAct[] };
