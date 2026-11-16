// The action the reason sheet (src/app/galaxy/reason.tsx) is open for: its words and its API call, held here and never
// in the sheet's link. A link can open the sheet, but only a screen in this app can give it something to do, and the
// sheet takes it once, when it opens, so a link arriving later can't swap the words over a live action.
import type { Result } from '../api.ts';

export type Words = { title: string; line: string; action: string; who: string; feature: string };
export type Held = Words & { run: (reason: string) => Promise<Result<unknown>> };

let held: { ticket: string; job: Held } | null = null;

// Holds `job` for the sheet about to open, in place of any before it; the ticket goes in the sheet's link.
export function hold(job: Held): string {
  const ticket = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  held = { ticket, job };
  return ticket;
}
// Nothing held, for a sheet opened for an action the API doesn't have yet.
export const release = () => void (held = null);

// The held job, once, for the sheet whose link carries its ticket.
export function take(ticket: string | undefined): Held | null {
  if (!ticket || held?.ticket !== ticket) return null;
  const { job } = held;
  held = null;
  return job;
}
