// Station's three mock venues, the people app's places to play (app/src/kinds.ts and mock.ts) as their counter sees
// them, and a made-up day of claims around any `now`: the same day for the same venue and time, every state the
// counter meets in it (someone 20 minutes late, someone due in, a walk-in, a block).
// ponytail: mock until the slots API (H8.1 to H8.5) serves a venue's stations and claims.
import { type Claim, HOUR, MIN, type StationType, type Venue, hours, steps, taken, walkInStart } from './day.ts';

export const venues: Venue[] = [
  {
    id: 'respawn-zone', name: 'Respawn Zone', initials: 'RZ', bg: '#12002B', fg: '#22D3EE', area: 'Gachibowli', open: [11, 26],
    types: [
      { id: 'pc', name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], step: 30, whole: false },
      { id: 'ps5', name: 'PS5', count: 4, unit: ['PS5', 'PS5s'], step: 30, whole: false },
      { id: 'vr', name: 'VR bay', count: 2, unit: ['bay', 'bays'], step: 30, whole: false },
    ],
  },
  {
    id: 'kickoff-arena', name: 'Kickoff Arena', initials: 'KA', bg: '#14532D', fg: '#FFFFFF', area: 'Gachibowli', open: [6, 24],
    types: [
      { id: 'football', name: '5-a-side football', count: 2, unit: ['pitch', 'pitches'], step: 60, whole: true },
      { id: 'cricket', name: 'Box cricket', count: 1, unit: ['box', 'boxes'], step: 60, whole: true },
    ],
  },
  {
    id: 'smash-court', name: 'Smash Court', initials: 'SC', bg: '#0B7285', fg: '#FFFFFF', area: 'Kondapur', open: [5, 23],
    types: [{ id: 'badminton', name: 'Badminton', count: 4, unit: ['court', 'courts'], step: 60, whole: true }],
  },
];

const NAMES = ['Rahul S.', 'Aditi K.', 'Sai Teja', 'Meera P.', 'Nikhil V.', 'Varun M.', 'Divya R.', 'Rohit G.', 'Harsha B.', 'Lavanya T.', 'Imran K.', 'Sneha J.', 'Karthik N.', 'Pooja L.', 'Abhishek D.', 'Fatima Z.', 'Manoj C.', 'Keerthi A.', 'Yash P.', 'Nandini S.', 'Tarun R.', 'Zoya H.', 'Vamsi K.', 'Ishita M.'];
const STAFF = ['Ravi', 'Sana', 'Kiran']; // the desk, for "first at 6:12 PM by Ravi"
const BLOCKS: Record<string, { type: string; from: number; to: number; why: string }> = {
  'respawn-zone': { type: 'ps5', from: 14, to: 21, why: 'Controller repair' },
  'kickoff-arena': { type: 'cricket', from: 20, to: 23, why: 'Private party' },
  'smash-court': { type: 'badminton', from: 6, to: 8, why: 'Coaching' },
};

// A small seeded generator (mulberry32), so a venue's day is the same every time it's drawn.
function seeded(text: string) {
  let a = [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockDay(v: Venue, now: number): Claim[] {
  const { day, closes, state } = hours(v, now);
  const rnd = seeded(`${v.id}${day}`);
  const claims: Claim[] = [];
  // 8 characters, as the Orbit app's ticket prints them for typing in when a QR won't scan ("RZ7Q 2M9X").
  const code = () => `${v.initials}${Math.floor(rnd() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0')}`;
  const order = [...NAMES].sort(() => rnd() - 0.5); // each name once before any comes round again
  let named = 0;
  const name = () => order[named++ % order.length];
  const fits = (t: StationType, start: number, end: number, count: number) =>
    steps(v, t, day).every((at) => at < start || at >= end || taken(claims, t, at).free >= count);
  const add = (c: Omit<Claim, 'id'>) => {
    const t = v.types.find((x) => x.id === c.type)!;
    const end = Math.min(c.end, closes); // nothing runs past closing
    if (c.start < end && fits(t, c.start, end, c.count)) claims.push({ id: `${c.kind[0]}${claims.length}`, ...c, end });
  };

  // While it's open, the states worth seeing around now, on the first type: a booking started this step with nobody
  // here (late, then a no-show), one due in, a walk-in that started this step. Then the venue's block.
  if (state === 'open') {
    const t = v.types[0];
    const here = walkInStart(t, now);
    const step = t.step * MIN;
    add({ type: t.id, kind: 'booking', count: t.whole ? 1 : 2, start: here, end: here + HOUR, who: name(), code: code() });
    add({ type: t.id, kind: 'booking', count: t.whole ? 1 : 3, start: here + step, end: here + step + 2 * HOUR, who: name(), code: code() });
    add({ type: t.id, kind: 'walkin', count: 1, start: here, end: here + HOUR });
  }
  const b = BLOCKS[v.id];
  if (b) add({ type: b.type, kind: 'block', count: 1, start: day + b.from * HOUR, end: day + b.to * HOUR, why: b.why });

  // Then bookings across the day: busier in the evening, and early mornings on pitches and courts.
  for (const s of v.types) {
    // Two tries a half hour at a café (groups come and go), one an hour on a pitch or court.
    for (const at of steps(v, s, day).flatMap((x) => (s.whole ? [x] : [x, x]))) {
      const h = (at - day) / HOUR;
      if (rnd() > ((h >= 17 && h < 23) || (s.whole && h < 9) ? 0.65 : 0.2)) continue;
      const end = Math.min(at + (1 + Math.floor(rnd() * (s.whole ? 2 : 3))) * HOUR, day + v.open[1] * HOUR);
      const count = s.whole ? 1 : 1 + Math.floor(rnd() * Math.min(4, s.count));
      // Anyone whose time has started came, but one in eight earlier ones never did and was released.
      const gone = end <= now && rnd() < 0.125;
      const came = at > now ? {} : gone ? { released: at + 15 * MIN } : { checkedIn: at + 3 * MIN, in: count, by: STAFF[Math.floor(rnd() * STAFF.length)] };
      add({ type: s.id, kind: 'booking', count, start: at, end, who: name(), code: code(), ...came });
    }
  }
  return claims.sort((x, y) => x.start - y.start);
}
