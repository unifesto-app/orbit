import { z } from "zod";
import type { EventCard } from "./events.ts";

// Saved events and lists (Saved events and lists doc): what the app sends and what the API answers. The app keeps the
// same rules on the phone (app/src/account/saves.ts) so the star answers at once; the API's copy wins.

export const MAX_SAVED = 1000; // saves of events that can be opened; hidden ones don't count, past ones do
export const MAX_LISTS = 50;
export const MAX_LIST_NAME = 40;

export const SAVED_FULL = "You have 1,000 saved; remove some first";
export const LISTS_FULL = `You have ${MAX_LISTS} lists; delete one first`;
export const LIST_GONE = "That list is gone";

// A list's id is the app's own (`l_…`), so a new list can be drawn before the API answers.
export const ListId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

// A name's length as people count it: each emoji or Indic letter is one (the app's rule, saves.ts nameLength). Made
// when first needed, never at load: Hermes may lack Intl.Segmenter, and the app imports this file at startup. Without
// it, code points less the marks that join the one before, so a long name is refused a little early, never let through.
const JOINING = /[\p{M}\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu;
let letters: Intl.Segmenter | null | undefined;
export const nameLength = (name: string, segmenter?: Intl.Segmenter | null) => {
  if (segmenter === undefined) segmenter = letters ??= typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;
  return segmenter ? [...segmenter.segment(name)].length : [...name.replace(JOINING, "")].length;
};

// The trimmed name, or what's wrong with it.
export function listName(raw: string): { name: string } | { problem: string } {
  const name = raw.trim();
  if (!name) return { problem: "Give the list a name" };
  if (name.includes("\u0000")) return { problem: "Check what you typed and try again." };
  if (nameLength(name) > MAX_LIST_NAME) return { problem: `Names are up to ${MAX_LIST_NAME} characters` };
  return { name };
}

// `create` is sent only when a list is made (with its first event, saved first if needed, in one go); without it a
// rename of a list that's gone answers listGone instead of making it again.
export const ListBody = z
  .object({ name: z.string().max(400), create: z.literal(true).optional(), eventId: z.uuid().optional() })
  .refine((b) => !b.eventId || b.create);
export const RemoveSaves = z.object({ eventIds: z.array(z.uuid()).min(1).max(MAX_SAVED) });
// Undo: the saves an unsave took, with when they were made, and the lists each was in.
export const RestoreSaves = z.object({
  saves: z.array(z.object({ eventId: z.uuid(), at: z.iso.datetime() })).max(MAX_SAVED),
  lists: z.record(ListId, z.array(z.uuid()).max(MAX_SAVED)).refine((r) => Object.keys(r).length <= MAX_LISTS),
});
export type RestoreSaves = z.infer<typeof RestoreSaves>;

export type SavedList = { id: string; name: string; events: string[]; touched: string };
// Only events that can be opened are in `saved` and the lists; `events` draws each as a card, listed or not.
export type MySaves = { saved: { eventId: string; at: string }[]; lists: SavedList[]; events: EventCard[] };
