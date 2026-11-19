// Staff are in India, so a date-and-time box (<input type="datetime-local">) shows and takes India's time, a fixed
// UTC+5:30, and the moment is kept with its offset: "2026-11-30T21:00" in the box is "2026-11-30T21:00:00+05:30".
// Pure, so ist.test.ts runs it on Node.
const IST = 330 * 60_000;

/** A stored moment (any offset, or Z) as the box shows it in India's time; "" for none. */
export const toBox = (iso?: string) => (iso ? new Date(Date.parse(iso) + IST).toISOString().slice(0, 16) : "");

/** What the box says, as a moment in India's time; none when empty (or half filled, which the box reports as ""). */
export const fromBox = (v: string) => (v ? `${v}:00+05:30` : undefined);
