// Venue's words and checks (Station take 4, approved 22 Nov 2026), pure so venue.test.ts runs them on Node.
import { paiseFrom, rupees } from '../money.ts';
import { HOUR, hourWord, type StationType } from './day.ts';

/** A kind's price line: "₹162/hr · ₹120/hr 11 AM to 4 PM on weekdays · ₹350/hr for two · Valorant, CS2". */
export function priceLine(t: StationType): string {
  const parts = [`${rupees(t.price)}/hr`];
  if (t.offPeak) parts.push(`${rupees(t.offPeak.price)}/hr ${hourWord(t.offPeak.from)} to ${hourWord(t.offPeak.to)}${t.offPeak.weekdays ? ' on weekdays' : ''}`);
  if (t.coop) parts.push(`${rupees(t.coop)}/hr for two`);
  if (t.games) parts.push(t.games);
  return parts.join(' · ');
}

/** A day's hours as Venue writes them: "11 AM to 2 AM", or Closed. */
export const span = (open: readonly [number, number] | null) => (open ? `${hourWord(open[0])} to ${hourWord(open[1])}` : 'Closed');

/** Days left on an invite, which ends by itself 14 days after it's sent (Hosts flow, Team and roles). */
export const daysLeft = (sent: number, now: number) => Math.max(14 - Math.floor((now - sent) / (24 * HOUR)), 0);

/** Whether an invite's contact reads as a phone number (10 to 13 digits, a + and spaces allowed) or an email. */
export const contactOk = (text: string) => {
  const t = text.trim();
  return /^\+?[\d\s-]+$/.test(t) ? (t.match(/\d/g) ?? []).length >= 10 && (t.match(/\d/g) ?? []).length <= 13 : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
};

/** "3 bookings need more than 10: Meera P., 3 × Gaming PC, 7:30 to 10:30 PM; …, and 2 more": the first three named. */
export function inTheWay<T>(list: readonly T[], line: (x: T) => string): string {
  return list.slice(0, 3).map(line).join('; ') + (list.length > 3 ? `, and ${list.length - 3} more` : '');
}

/** More than one: "pitches", "boxes", "PCs", "bays". */
export const plural = (unit: string) => (/(s|x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`);

/** Whether a day's hours read right: opens before it closes, at most a day long, closing by 6 AM the next morning. */
export const hoursOk = (open: readonly [number, number]) => open[0] >= 0 && open[0] <= 23 && open[1] > open[0] && open[1] - open[0] <= 24 && open[1] <= 30;

export type KindForm = { name: string; unit: string; count: number; price: string; coop: string; op: 'none' | 'weekdays' | 'every'; opFrom: number; opTo: number; opPrice: string; games: string };
/**
 * A kind from Venue's sheet (Play, Setting up a venue): a name, how many, the price an hour, co-op for two (gaming), one
 * off-peak window inside the opening and cheaper than the price, and games. A new one also says what one is called;
 * Orbit sets how it starts and whether it's booked whole, from the venue's kind. Otherwise, why not.
 * ponytail: off-peak stops at midnight; a café's window past it waits for the slots API's per-day prices.
 */
export function kindFrom(f: KindForm, was: StationType | undefined, open: readonly [number, number], gaming: boolean, id: string): { kind: StationType } | { why: string } {
  const name = f.name.trim();
  const unit = (was?.unit[0] ?? f.unit).trim();
  if (!name) return { why: 'Give it a name.' };
  if (!unit) return { why: 'Say what one is called, like PC or pitch.' };
  const price = paiseFrom(f.price);
  if (!price) return { why: 'Its price an hour, in rupees.' };
  const coop = gaming && f.coop.trim() ? paiseFrom(f.coop) : undefined;
  if (gaming && f.coop.trim() && !coop) return { why: 'The co-op price in rupees, or leave it empty.' };
  let offPeak: StationType['offPeak'];
  if (f.op !== 'none') {
    const p = paiseFrom(f.opPrice);
    if (!p) return { why: 'The off-peak price in rupees.' };
    if (p >= price) return { why: 'Off-peak is cheaper than the price an hour.' };
    if (f.opFrom < open[0] || f.opTo > Math.min(open[1], 24) || f.opFrom >= f.opTo) return { why: 'Off-peak hours sit inside your opening, before midnight.' };
    offPeak = { from: f.opFrom, to: f.opTo, weekdays: f.op === 'weekdays', price: p };
  }
  const base = was ?? { id, unit: [unit, plural(unit)] as [string, string], step: (gaming ? 30 : 60) as 30 | 60, whole: !gaming };
  return { kind: { ...base, name, count: f.count, price, coop, games: gaming ? f.games.trim() || undefined : undefined, offPeak } };
}
