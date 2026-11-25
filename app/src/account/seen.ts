// The events seen so far, by id, in memory only: the Saved screens and the list sheet draw them without another call.
// Fed by the saves read and by every public read (src/events.ts). Hidden saves aren't in the saves answer, so they're
// never drawn.
// ponytail: grows with what the person browses until the app closes; a cap if that ever matters.
import type { EventCard } from '@orbit/contract';

const seen = new Map<string, EventCard>();
export const remember = (cards: readonly EventCard[]) => void cards.forEach((c) => seen.set(c.id, c));
export const cardOf = (id: string) => seen.get(id);
// A saved event counts toward the 1,000 once its card is here: the API already left out the hidden ones.
export const isKnown = (id: string) => seen.has(id);
export const forgetCards = () => seen.clear();
