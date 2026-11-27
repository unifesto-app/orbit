// inRoom on the Orbit API (api/src/rooms.ts, contract/src/rooms.ts; R3, 27 Nov 2026): a real meetup's room, its join
// card, asks to connect and blocks. Pure, so rooms.test.ts runs it on Node; the room screen (src/app/room/[slug].tsx)
// draws it. Name and photo are the account's; the card is only a line and one to three ways to reach you.
import { type RoomAsk, type RoomCard, type RoomMember, type RoomState, type RoomView, ROOM_LINE_MAX, ROOM_REACH_MAX } from '@orbit/contract';

import type { makeApi } from './api.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'authed'>;
export const roomsApi = (api: Api) => {
  const at = (eventId: string) => `/me/rooms/${eventId}`;
  return {
    get: (eventId: string) => api.authed<RoomView>('GET', at(eventId)),
    // Join, come back after leaving, or change the card.
    putCard: (eventId: string, card: RoomCard) => api.authed<RoomView>('PUT', `${at(eventId)}/card`, card),
    leave: (eventId: string) => api.authed<null>('DELETE', at(eventId)),
    ask: (eventId: string, memberId: string) => api.authed<RoomMember>('POST', `${at(eventId)}/asks`, { memberId }),
    accept: (eventId: string, askId: string) => api.authed<RoomMember>('POST', `${at(eventId)}/asks/${askId}/accept`),
    decline: (eventId: string, askId: string) => api.authed<RoomMember>('POST', `${at(eventId)}/asks/${askId}/decline`),
    block: (eventId: string, memberId: string) => api.authed<null>('POST', `${at(eventId)}/members/${memberId}/block`),
  };
};

// The contract's limits on a way to reach you (RoomReach).
const LABEL_MAX = 24;
const VALUE_MAX = 120;

/** One reach row on the join card, as typed. `chip` is the one picked, once a chip is tapped: a label typed after Other
 * stays under Other even if it reads "Phone". */
export type ReachRow = { label: string; value: string; chip?: ReachChip };

/** The join card as typed → the card to PUT, or what to fix: trimmed, empty rows dropped, the contract's limits. */
export function cardOf(line: string, rows: readonly ReachRow[]): { card: RoomCard } | { error: string } {
  const l = line.trim();
  if (!l) return { error: 'Add a line about you.' };
  if (l.length > ROOM_LINE_MAX) return { error: `Keep your line to ${ROOM_LINE_MAX} characters.` };
  const reach = rows.map((r) => ({ label: r.label.trim(), value: r.value.trim() })).filter((r) => r.label || r.value);
  if (!reach.length) return { error: 'Add a way to reach you.' };
  if (reach.length > ROOM_REACH_MAX) return { error: `Add ${ROOM_REACH_MAX} ways to reach you at most.` };
  if (reach.some((r) => !r.label || !r.value)) return { error: 'Give each way to reach you a label and what to reach you on.' };
  if (reach.some((r) => r.label.length > LABEL_MAX)) return { error: `Keep each label to ${LABEL_MAX} characters.` };
  if (reach.some((r) => r.value.length > VALUE_MAX)) return { error: `Keep each way to reach you to ${VALUE_MAX} characters.` };
  return { card: { line: l, reach } };
}

// A reach row's label: Phone or Email from a chip, or any label typed after Other.
export const REACH_CHIPS = ['Phone', 'Email', 'Other'] as const;
export type ReachChip = (typeof REACH_CHIPS)[number];
export const chipOf = (label: string): ReachChip => (label === 'Phone' || label === 'Email' ? label : 'Other');
/** A row's chip: the one tapped, else read from the label (a saved card). */
export const rowChip = (r: ReachRow): ReachChip => r.chip ?? chipOf(r.label);
/** Tapping a chip: Phone and Email set the label; Other keeps a label already typed under Other, else starts empty. */
export const pickChip = (r: ReachRow, chip: ReachChip): ReachRow => ({
  ...r,
  chip,
  label: chip !== 'Other' ? chip : rowChip(r) === 'Other' ? r.label : '',
});
/** The value's keyboard for a row's label. */
export const keyboardOf = (label: string) => (label === 'Phone' ? 'phone-pad' : label === 'Email' ? 'email-address' : 'default');

/** What a member's row offers, from the ask between you: Ask to connect (none, or you declined theirs: asking turns
 * it round), Asked (muted, waiting), Accept and Decline (they asked), or their reach (connected). */
export type MemberAction = 'ask' | 'asked' | 'answer' | 'reach';
export const actionOf = (ask: RoomAsk): MemberAction =>
  ask === 'asked' ? 'asked' : ask === 'incoming' ? 'answer' : ask === 'connected' ? 'reach' : 'ask';

/** What Orbit says above the room in each state; nothing once you're in. `connections`: a closed room still lists the
 * people you connected with. */
export function roomSays(state: RoomState, connections = 0): string | null {
  switch (state) {
    case 'out':
      return 'The room opens at the door: once your ticket is checked in, you can join.';
    case 'door':
      return 'Join to see who else was here, and let them see you. Ask anyone to connect: if they say yes, you swap the ways to reach each other. There’s no chat.';
    case 'in':
      return null;
    case 'closed':
      return connections
        ? 'This room has closed. The people you connected with stay here, with how to reach them.'
        : 'This room has closed. Rooms stay open a week after the meetup.';
    case 'removed':
      return 'Orbit took your card down from this room, so you can’t join it again.';
    case 'barred':
      return 'You can’t join rooms on Orbit.';
  }
}
