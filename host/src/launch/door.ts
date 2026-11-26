// What Event Partner's scanner (src/app/scan.tsx) shows for an event ticket, pure so door.test.ts runs it on Node. The
// API (api/src/checkin.ts, X5) does the deciding; this turns its answers into the card over the camera.
// - `in`: a ticket for one, let in on the scan, with Undo back to the count before.
// - `ask`: a group ticket: "How many are here?", from 1 to the seats still out; nobody is in until the tap.
// - `already`: everyone on it is in, first at a time and by whom.
// - A refusal is its word and the API's message. A 409 `changed` (another door moved the count) shows the fresh guest:
//   asked again, or Already in if they're all in now.
import type { DoorGuest, ScanRefusal, ScanResult } from '@orbit/contract';

export type Shown =
  | { kind: 'in'; guest: DoorGuest; before: number } // `before`: the count Undo goes back to
  | { kind: 'ask'; guest: DoorGuest; again?: boolean } // `again`: after another door changed it
  | { kind: 'already'; guest: DoorGuest; by: string | null }
  | { kind: 'no'; word: string; message: string; amber: boolean; find: boolean; retry?: boolean }; // `retry`: not a refusal, scan it again

const WORD: Record<ScanRefusal, string> = {
  unknown: 'Not an Orbit ticket',
  wrongEvent: 'Not for this event',
  cancelled: 'Cancelled',
  early: 'Too early',
  ended: 'Check-in closed',
};
export const refused = (r: ScanRefusal | string, message: string): Shown => ({
  kind: 'no',
  word: WORD[r as ScanRefusal] ?? 'Not let in',
  message,
  amber: r === 'early',
  find: r === 'unknown',
});

/** Seats on a ticket still to come in. */
export const left = (g: DoorGuest) => Math.max(g.quantity - g.admitted, 0);

/** A scan's answer as the card shows it. */
export function fromScan(r: ScanResult): Shown {
  if (r.result === 'in') return { kind: 'in', guest: r.guest, before: 0 };
  if (r.result === 'ask') return { kind: 'ask', guest: r.guest };
  if (r.result === 'already') return { kind: 'already', guest: r.guest, by: r.by };
  return refused(r.result, r.message);
}

/** The guest as it stands now (Find picked it, or another door changed it): the same card a scan of it would show. */
export function fresh(g: DoorGuest, again = false): Shown {
  if (left(g) === 0) return { kind: 'already', guest: g, by: null };
  return { kind: 'ask', guest: g, again };
}

/** "Meera", or "Guest" when the account has no name. */
export const nameOf = (g: DoorGuest) => g.name?.trim() || 'Guest';
/** "Meera is in", or "Meera + 2 · 3 of 4 in" for a group. */
export function inLine(g: DoorGuest) {
  const first = nameOf(g).split(/\s+/)[0];
  return g.quantity > 1 ? `${first}${g.admitted > 1 ? ` + ${g.admitted - 1}` : ''} · ${g.admitted} of ${g.quantity} in` : `${first} is in`;
}
/** A Find row's state: "Not in yet", "2 of 4 in", "In". */
export const stateLine = (g: DoorGuest) => (g.admitted === 0 ? 'Not in yet' : g.admitted < g.quantity ? `${g.admitted} of ${g.quantity} in` : 'In');

/** The event's counts after one ticket went from `from` to `to`, until the next read from the API. */
export const bump = (n: { booked: number; in: number }, from: number, to: number) => ({ ...n, in: Math.max(n.in + to - from, 0) });

/** How many are in after letting `n` more of a ticket in: never past the ticket. */
export const admitTotal = (g: DoorGuest, n: number) => Math.min(g.admitted + n, g.quantity);

// The API takes up to 64 characters (contract Scan); a longer QR is no Orbit ticket, so it's never sent.
const MAX_TEXT = 64;
const UNKNOWN = 'No ticket matches this. Check the code and try again.';
export const tooLong = (text: string): Shown | null => (text.trim().length > MAX_TEXT ? refused('unknown', UNKNOWN) : null);

export type Failure = { error: string; message: string; guest?: DoorGuest };
/** A scan the API didn't answer with a result: a 400 is no Orbit ticket; offline, server or a closed host can be scanned again. */
export function scanFailed(e: Failure): Shown {
  if (e.error === 'invalid') return refused('unknown', UNKNOWN);
  return { kind: 'no', word: 'Couldn’t check this ticket', message: e.message, amber: false, find: false, retry: true };
}
/**
 * An admit or undo that failed. Another door moved the count: the fresh guest, asked again. The door shut or the ticket
 * went (a refusal): its card. Anything else (offline, a server error, the host closed): the card stays as it was, with
 * the same from and total, so the retry is safe.
 */
export function afterFail(e: Failure, action: 'admit' | 'undo'): { show: Shown } | { retry: string } {
  if (e.error === 'changed' && e.guest) return { show: fresh(e.guest, true) };
  if (e.error in WORD) return { show: refused(e.error, e.message) };
  return { retry: action === 'admit' ? 'Couldn’t let them in. Try again.' : 'Couldn’t undo. Try again.' };
}
