// How the Host tab words a host's team and status (Hosts flow, Team and roles; Becoming a host): a waiting invite's age
// and what's left of its 14 days, one event's team in a line, and which status moves the viewer gets.
import { istDay } from './day.ts';
import type { Sales } from './money.ts';

const DAY = 86_400_000;
export const INVITE_DAYS = 14; // a waiting role expires after 14 days

// "Invited 2 days ago · 12 days left", "Invited today · 14 days left", or "Expired" once its 14 days are up. Days are
// India calendar days, so "yesterday" is yesterday; what's left counts from the moment it was sent.
export function inviteLine(sentAt: string, now: number) {
  const sent = Date.parse(sentAt);
  if (Number.isNaN(sent)) return 'Invited';
  const left = Math.min(INVITE_DAYS, Math.ceil((sent + INVITE_DAYS * DAY - now) / DAY)); // a clock a little behind never shows 15
  if (left <= 0) return 'Expired';
  const ago = Math.max(0, istDay(now) - istDay(sent));
  const when = ago === 0 ? 'Invited today' : ago === 1 ? 'Invited yesterday' : `Invited ${ago} days ago`;
  return `${when} · ${left === 1 ? '1 day' : `${left} days`} left`;
}

// "Arjun Rao leads · 1 Crew · 1 invited", or "No team yet".
export function teamLine(team: { lead?: string; crew: number } | undefined, invited: number) {
  const parts = [team?.lead ? `${team.lead} leads` : undefined, team?.crew ? `${team.crew} Crew` : undefined, invited ? `${invited} invited` : undefined];
  return parts.filter(Boolean).join(' · ') || 'No team yet';
}

// A masked phone number read aloud as "number ending 417", not a run of bullets; an email reads as it is.
export const spokenContact = (contact: string) => (contact.includes('•') ? `number ending ${contact.replace(/\D/g, '').slice(-3)}` : contact);

export type Status = 'live' | 'paused' | 'suspended' | 'archived';

// Pausing or archiving waits until every event with bookings has ended and no refund is open (Hosts flow).
// ponytail: payout requests still open wait too; they come with the payouts API, which the mock doesn't have.
export const mustWait = (all: readonly Sales[], now: number) => all.some((s) => (s.booked > 0 && Date.parse(s.endsAt) > now) || s.refundsWaiting > 0);

// The owner's status moves for each status: live pauses or archives, paused resumes or archives, archived restores,
// and a suspension is Orbit's to lift. Pause and Archive show "Not yet", with nothing to tap, while they must wait.
// Anyone else on the team gets none.
export function statusMoves(status: Status, owner: boolean, wait: boolean): { label: string; value?: string; open: boolean }[] {
  if (!owner) return [];
  const blocked = (label: string) => ({ label, value: wait ? 'Not yet' : undefined, open: !wait });
  if (status === 'live') return [blocked('Pause host'), blocked('Archive host')];
  if (status === 'paused') return [{ label: 'Resume host', open: true }, blocked('Archive host')];
  if (status === 'archived') return [{ label: 'Restore host', open: true }];
  return [];
}

// The words under the Status card: why the moves wait, or who makes them.
export function statusNote(status: Status, owner: boolean, wait: boolean) {
  if (status === 'suspended') return 'Orbit suspended this host. Ask through Help and support if you think it’s wrong.';
  if (status === 'archived') return owner ? undefined : 'Only the owner can restore this host.';
  if (!owner) return 'Only the owner can pause or archive this host.';
  return wait
    ? 'Pausing or archiving waits till every event with bookings has ended and no refund is open.'
    : 'Only you, the owner, can pause or archive.';
}
