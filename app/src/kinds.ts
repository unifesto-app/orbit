// What each kind of event or place shows beyond the usual page (owner, 19 Nov 2026: detail screens for Standup Comedy,
// Musical Jams, Hackathons, Meetups, Turf/Court/Ground, Gaming Café/Zone and Fests), keyed off today's categories
// (comedy, music, hackathons, meetups, fests, sports, gaming; the flow's eight tiles are P4.1). From the flow docs:
// - Comedy and Jams: "with [act]" under "by host", the acts being Performer hosts (Discover 23; Performer).
// - Hackathons: tracks and briefs, prizes, rounds with times, criteria with weights and the number of teams, never their
//   names; after results, the winners (Running hackathons 4, 5, 13).
// - Meetups: one line about the inRoom (inRoom 15); Join is on the ticket after check-in.
// - Fests: one-click booking for the group (Booking 13); events inside a fest are Later (Discover 14, 27).
// - Turfs, courts and gaming cafés: a Venue host with stations, prices and hours, booked by the hour (Play 7, 8, 19).
// Outside the docs, and the owner's to change: comedy's runtime, language and seating, a jam's style and what to bring,
// and a fest's type.
// ponytail: written here by hand; the host fills them in on the event once events reach the API.
import { formatPrice } from '@orbit/contract';

/** Performer hosts on an event, in billing order (Discover 23: "with [act]", three names then "+N"). */
export const acts: Record<string, readonly string[]> = {
  'open-mic-night': ['arjun-rao-live'],
  'open-mic-night-13-nov': ['arjun-rao-live'],
  'sunday-jam': ['kabir-strings'],
  'udaan-cultural-fest': ['the-local-loop', 'arjun-rao-live', 'kabir-strings', 'dj-saanvi'],
  'udaan-2025': ['the-local-loop'],
};

/** "with" and up to three names, the rest as "+N": the names to link, and the count left over. */
export function withActs<T>(list: readonly T[], shown = 3): { names: T[]; more: number } {
  return { names: list.slice(0, shown), more: Math.max(list.length - shown, 0) };
}

export type Show = { runtime: string; language: string; age?: '18+' | '21+'; seating?: string };
export type Jam = { style: string; bring: string; onSite?: string; runtime: string };
export type Hackathon = {
  team: [number, number]; // smallest and biggest team
  teams: number; // how many have booked: a count, never names (Running hackathons 4)
  tracks: { name: string; brief: string }[];
  prizes: { place: string; prize: string }[];
  rounds: { name: string; when: string }[];
  criteria: { name: string; weight: number }[]; // weights add to 100
  winners?: { place: string; team: string; members: string; project: string; line: string }[]; // once results are out
};
export type Meetup = { inRoom: boolean };
export type Fest = { type: string; days: string; highlights: string[]; oneClick: boolean };

export const shows: Record<string, Show> = {
  'open-mic-night': { runtime: 'About 2 hours', language: 'Hindi and English', age: '18+', seating: 'First come, first seated' },
  'open-mic-night-13-nov': { runtime: 'About 2 hours', language: 'Hindi and English', age: '18+', seating: 'First come, first seated' },
};

export const jams: Record<string, Jam> = {
  'sunday-jam': {
    style: 'Acoustic covers, Bollywood and indie',
    bring: 'An instrument, your voice, or just yourself',
    onSite: 'A cajón, a keyboard and two mics',
    runtime: 'About 2 hours',
  },
};

const hackRules = {
  team: [2, 4] as [number, number],
  criteria: [
    { name: 'It works', weight: 40 },
    { name: 'The idea', weight: 30 },
    { name: 'Polish', weight: 20 },
    { name: 'The demo', weight: 10 },
  ],
};
export const hackathons: Record<string, Hackathon> = {
  'build-anything-hackathon': {
    ...hackRules,
    teams: 37,
    tracks: [
      { name: 'Open', brief: 'Anything you like: an app, a tool or a game.' },
      { name: 'Hardware', brief: 'Something you can hold. Boards and sensors at the desk.' },
      { name: 'For Hyderabad', brief: 'Something your neighbourhood would use tomorrow.' },
    ],
    prizes: [
      { place: 'First', prize: '₹50,000' },
      { place: 'Second', prize: '₹25,000' },
      { place: 'Best hardware', prize: '₹10,000' },
    ],
    rounds: [
      { name: 'Build', when: 'Sat 10:30 AM to Sun 7:00 AM' },
      { name: 'Demos and judging', when: 'Sun 7:30 AM to 9:00 AM' },
    ],
  },
  'monsoon-hack': {
    ...hackRules,
    teams: 24,
    tracks: [{ name: 'Monsoon', brief: 'Tools for a city in the rain.' }],
    prizes: [
      { place: 'First', prize: '₹30,000' },
      { place: 'Second', prize: '₹15,000' },
    ],
    rounds: [
      { name: 'Build', when: 'Sat 10:00 AM to Sun 6:00 AM' },
      { name: 'Demos and judging', when: 'Sun 7:00 AM' },
    ],
    winners: [
      { place: 'First', team: 'Puddle', members: 'Ravi, Meera and Sana', project: 'Puddle', line: 'A live waterlogging map from people’s photos' },
      { place: 'Second', team: 'Dry Run', members: 'Kiran and Adil', project: 'Drain Watch', line: 'Blocked drains reported in one tap' },
    ],
  },
};

export const meetups: Record<string, Meetup> = {
  'design-critique-night': { inRoom: true },
};

/** The kinds of fest a host can pick (outside the docs: the owner's to change). */
export const FEST_TYPES = ['College cultural fest', 'College tech fest', 'Music festival', 'Food festival', 'Sports fest', 'Community fest'] as const;
export const fests: Record<string, Fest> = {
  'udaan-cultural-fest': {
    type: 'College cultural fest',
    days: 'One day, 10 AM till late',
    highlights: ['Dance and drama competitions', 'Battle of the bands', 'Stand-up on the main stage', 'Food stalls till late'],
    oneClick: true,
  },
  'udaan-2025': { type: 'College cultural fest', days: 'One day', highlights: ['Battle of the bands'], oneClick: true },
};

/** A place to play, booked by the hour (Play): its stations, hours and how a booking starts. */
export type Station = {
  name: string;
  count: number;
  unit: [string, string]; // what one is called, and many: ["pitch", "pitches"]
  pricePaise: number; // an hour
  coopPaise?: number; // an hour for two playing together (gaming)
  offPeak?: { when: string; pricePaise: number }; // one cheaper window (Play 8)
  games?: string; // plain text (Play 8)
  note?: string;
};
export type Venue = { kind: 'turf' | 'court' | 'gaming'; hours: string; address: string; stations: Station[] };

export const venues: Record<string, Venue> = {
  'kickoff-arena': {
    kind: 'turf',
    hours: 'Every day, 6 AM to midnight',
    address: 'Stadium Road, Gachibowli, Hyderabad',
    stations: [
      { name: '5-a-side football', count: 2, unit: ['pitch', 'pitches'], pricePaise: 120000, offPeak: { when: 'before 4 PM on weekdays', pricePaise: 90000 }, note: 'Artificial grass, floodlit' },
      { name: 'Box cricket', count: 1, unit: ['box', 'boxes'], pricePaise: 100000, note: 'Netted and floodlit' },
    ],
  },
  'smash-court': {
    kind: 'court',
    hours: 'Every day, 5 AM to 11 PM',
    address: 'Botanical Garden Road, Kondapur, Hyderabad',
    stations: [
      { name: 'Badminton', count: 4, unit: ['court', 'courts'], pricePaise: 50000, offPeak: { when: '10 AM to 4 PM', pricePaise: 35000 }, note: 'Wooden floor, rackets to hire' },
    ],
  },
  'respawn-zone': {
    kind: 'gaming',
    hours: 'Every day, 11 AM to 2 AM',
    address: 'Above Inorbit Mall entrance, Gachibowli, Hyderabad',
    stations: [
      { name: 'Gaming PC', count: 12, unit: ['PC', 'PCs'], pricePaise: 16200, offPeak: { when: 'before 4 PM on weekdays', pricePaise: 12000 }, games: 'Valorant, CS2, Dota 2, Fortnite' },
      { name: 'PS5', count: 4, unit: ['PS5', 'PS5s'], pricePaise: 25000, coopPaise: 35000, games: 'EA FC 25, Tekken 8, Spider-Man 2' },
      { name: 'VR bay', count: 2, unit: ['bay', 'bays'], pricePaise: 40000, games: 'Beat Saber, Superhot' },
    ],
  },
};

/** The cheapest hour anywhere at a venue, off-peak included: the Book a slot bar's "Starting from". */
export function fromPricePaise(v: Venue): number {
  return Math.min(...v.stations.map((s) => Math.min(s.pricePaise, s.offPeak?.pricePaise ?? Infinity)));
}

/** An hour's price as the venue page writes it: "₹162/hr". */
export const perHour = (paise: number) => `${formatPrice(paise)}/hr`;

/**
 * How a booking starts (Play 7, 19): a pitch or court is booked whole by one person for the group, on the hour; a
 * gaming station starts every 30 minutes, solo or co-op.
 */
export const startsLine = (v: Venue) =>
  v.kind === 'gaming' ? 'Starts every 30 minutes, for as many whole hours as you like' : 'Booked whole for your group, starting on the hour';

/** "2 pitches", "1 box". */
export const countLine = (s: Station) => `${s.count} ${s.count === 1 ? s.unit[0] : s.unit[1]}`;
