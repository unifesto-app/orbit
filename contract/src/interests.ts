import { z } from "zod";
import { categories, type CategorySlug } from "./categories.ts";
import { EventCategory } from "./events.ts";

// Interests on the account (owner, 19 Nov 2026: "add interest cards for events", all four; kept by the API since
// orbit-pm X13): the kinds of event you like, and the events you tapped I'm interested on. Private to the account.

// GET /me/interests. null: never asked (Home asks once); []: skipped.
export type MyInterests = { interests: CategorySlug[] | null };

// PUT /me/interests: the whole list, each a known category, kept once each in the order given.
export const SetInterests = z.object({
  interests: z
    .array(EventCategory)
    .max(categories.length)
    .transform((a) => [...new Set(a)]),
});
export type SetInterests = z.input<typeof SetInterests>;

// GET /me/interested: the ids of the events you're interested in that can still be opened.
export type MyInterested = { events: string[] };
