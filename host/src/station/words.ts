// How Station says a booking, on Today and the scanner: "2 × Gaming PC", "6:00 to 7:00 PM", "Meera".
import { type Claim, type StationType, type Venue, timeLabel } from './day';

/** "1 PC", "2 pitches". */
export const units = (t: StationType, n: number) => `${n} ${n === 1 ? t.unit[0] : t.unit[1]}`;
/** "Meera" from "Meera P.". */
export const first = (who = '') => who.split(' ')[0];
/** "6:00 to 7:00 PM"; the start keeps its AM or PM when the end's differs. */
export function range(a: number, b: number) {
  const x = timeLabel(a);
  const y = timeLabel(b);
  return `${x.slice(-2) === y.slice(-2) ? x.slice(0, -3) : x} to ${y}`;
}
/** "2 × Gaming PC"; a pitch or court booked whole is its name. The words name the things, never "stations". */
export function what(v: Venue, c: Claim) {
  const t = v.types.find((x) => x.id === c.type);
  if (!t) return '';
  return t.whole ? (c.count > 1 ? units(t, c.count) : t.name) : `${c.count} × ${t.name}`;
}
/** "RZ7Q 2M9X": the code in two halves, as the Orbit app's ticket prints it. */
export const spaced = (code = '') => `${code.slice(0, 4)} ${code.slice(4)}`;
