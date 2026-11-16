// Every Galaxy queue item is due within 24 hours of being asked (Galaxy doc, Queues; Mobile app doc). Lists sort the
// oldest first, which puts the most overdue at the top and then the soonest due. `now` is passed in, so screens use the
// mock clock until the API's own times arrive.
const HOUR = 3_600_000;
export const DUE_HOURS = 24;

const hours = (ms: number) => Math.max(1, Math.round(ms / HOUR));

// "3h ago", "2 days ago".
export function ago(at: string, now: number): string {
  const h = hours(now - Date.parse(at));
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)} days ago`;
}

// "Due in 21h" or "Overdue 3h".
export function due(at: string, now: number): { overdue: boolean; line: string } {
  const left = Date.parse(at) + DUE_HOURS * HOUR - now;
  return left > 0 ? { overdue: false, line: `Due in ${hours(left)}h` } : { overdue: true, line: `Overdue ${hours(-left)}h` };
}

export const oldestFirst = <T extends { askedAt: string }>(items: readonly T[]) => [...items].sort((a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt));
