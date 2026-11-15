// Mock Home data until the API serves it. Posters are PNGs (iOS can't draw the web mocks' SVG text).
// Every event has a 3:4 poster, the app's only card shape. A few also have the 4:3 poster the carousel
// shows. Its top-edge colour (sampled once at upload) only fills in while the image loads.
// ponytail: static data and a fixed clock; both go when the discover endpoint lands in @orbit/contract.
import type { CategorySlug } from '@orbit/contract';
import type { ImageSourcePropType } from 'react-native';

import type { Place, PlanEvent, PlanHost, Viewer } from './home/layout';
import type { MediaItem } from './media';

export type Wide = { source: ImageSourcePropType; edge: string };
export type Host = PlanHost & { name: string; initials: string; bg: string; fg: string; about: string; banner?: Wide };
export type Event = PlanEvent & {
  title: string;
  category: CategorySlug; // one per event (Discover decision 12)
  when: string; // pre-formatted until real timestamps reach the UI
  repeats?: string; // only for a series, e.g. "Every Sunday" (Discover decision 15)
  pricePaise: number; // 0 = free
  seats?: string; // the seats line, when decision 3 says to show one
  poster: MediaItem; // 3:4
  wide?: Wide; // 4:3, for the carousel
};

const poster = (source: ImageSourcePropType): MediaItem => ({ source, ratio: '3:4' });

// Friday morning of the mock week, so "Tonight", "this week" and the When chips read right. 20 Nov 2026 is a
// Friday (the 21st, used until 15 Nov, is a Saturday).
export const now = Date.parse('2026-11-20T09:00:00+05:30');

export const hosts: Host[] = [
  { id: 'respawn', name: 'Respawn Club', initials: 'RC', bg: '#12002B', fg: '#22D3EE', area: 'Gachibowli', about: 'Esports · Gachibowli', joined: '2026-11-18T09:00:00+05:30', banner: { source: require('../assets/mock/respawn-banner.png'), edge: '#12002B' } },
  { id: 'kickoff', name: 'Kickoff Hyderabad', initials: 'KH', bg: '#166534', fg: '#FFFFFF', area: 'Gachibowli', about: 'Football every Sunday · Gachibowli', joined: '2026-11-19T08:00:00+05:30', banner: { source: require('../assets/mock/kickoff-banner.png'), edge: '#166534' } },
  { id: 'clay-days', name: 'Clay Days', initials: 'CD', bg: '#B5532E', fg: '#FFFFFF', area: 'Banjara Hills', about: 'Pottery every Thursday · Banjara Hills', joined: '2026-11-15T09:00:00+05:30', banner: { source: require('../assets/mock/clay-days-banner.png'), edge: '#B5532E' } },
  { id: 'mgit', name: 'Cultural Committee, MGIT', initials: 'CC', bg: '#FF3D7F', fg: '#FFFFFF', area: 'Gandipet', about: 'Udaan Cultural Fest · Gandipet', joined: '2026-09-14T10:00:00+05:30' },
  { id: 'punchline', name: 'Punchline Collective', initials: 'PC', bg: '#F2C14E', fg: '#141414', area: 'Jubilee Hills', about: 'Open mic every Friday · Jubilee Hills', joined: '2026-08-31T10:00:00+05:30' },
  { id: 'circuitfeed', name: 'CircuitFeed', initials: 'CF', bg: '#C6F432', fg: '#0A0F1F', area: 'Gachibowli', about: 'Hackathons · Gachibowli', joined: '2026-07-31T10:00:00+05:30' },
  { id: 'jam-circle', name: 'Jam Circle Hyderabad', initials: 'JC', bg: '#0F5257', fg: '#F7F3E8', area: 'KBR Park', about: 'Jams every Sunday · KBR Park', joined: '2026-06-30T10:00:00+05:30' },
  { id: 'founders-club', name: 'Hyderabad Founders Club', initials: 'HF', bg: '#6F4E37', fg: '#F3EBDD', area: 'HITEC City', about: 'Breakfasts every month · HITEC City', joined: '2026-05-31T10:00:00+05:30' },
  { id: 'pixel-club', name: 'Pixel Club, CBIT', initials: 'PX', bg: '#FFD60A', fg: '#111111', area: 'Gandipet', about: 'Design crits every month · Gandipet', joined: '2026-10-14T10:00:00+05:30' },
  { id: 'reel-society', name: 'Reel Society', initials: 'RS', bg: '#7A1E28', fg: '#FFF1E6', area: 'Kukatpally', about: 'Screenings every Wednesday · Kukatpally', joined: '2026-08-19T10:00:00+05:30' },
];

export const events: Event[] = [
  { id: 'open-mic-night', category: 'comedy', hostId: 'punchline', area: 'Jubilee Hills', startsAt: '2026-11-20T20:00:00+05:30', announced: '2026-11-09T10:00:00+05:30', title: 'Open Mic Night', when: 'Fri 20 Nov · 8:00 PM', repeats: 'Every Friday', pricePaise: 29900, seats: '9 seats left', poster: poster(require('../assets/mock/open-mic.png')), wide: { source: require('../assets/mock/open-mic-4x3.png'), edge: '#F25C2A' } },
  { id: 'build-anything-hackathon', category: 'hackathons', hostId: 'circuitfeed', area: 'Gachibowli', startsAt: '2026-11-21T09:00:00+05:30', announced: '2026-11-19T10:00:00+05:30', title: 'Build Anything Hackathon', when: 'Sat 21 Nov · 9:00 AM', pricePaise: 49900, seats: '8 seats left', poster: poster(require('../assets/mock/hackathon-poster.png')), wide: { source: require('../assets/mock/hackathon-4x3.png'), edge: '#0A0F1F' } },
  { id: 'campus-esports-cup', category: 'gaming', hostId: 'respawn', area: 'Gachibowli', startsAt: '2026-11-21T11:00:00+05:30', announced: '2026-11-11T10:00:00+05:30', title: 'Campus Esports Cup', when: 'Sat 21 Nov · 11:00 AM', pricePaise: 9900, poster: poster(require('../assets/mock/esports-cup.png')) },
  { id: 'sunday-5-a-side', category: 'sports', hostId: 'kickoff', area: 'Gachibowli', startsAt: '2026-11-22T07:00:00+05:30', announced: '2026-11-04T10:00:00+05:30', title: 'Sunday 5-a-side Football', when: 'Sun 22 Nov · 7:00 AM', repeats: 'Every Sunday', pricePaise: 14900, poster: poster(require('../assets/mock/football-3x4.png')) },
  { id: 'sunday-jam', category: 'music', hostId: 'jam-circle', area: 'KBR Park', startsAt: '2026-11-22T17:00:00+05:30', announced: '2026-11-11T10:00:00+05:30', title: 'Sunday Jam', when: 'Sun 22 Nov · 5:00 PM', repeats: 'Every Sunday', pricePaise: 0, poster: poster(require('../assets/mock/sunday-jam-3x4.png')), wide: { source: require('../assets/mock/sunday-jam.png'), edge: '#0F5257' } },
  { id: 'founders-breakfast', category: 'startups', hostId: 'founders-club', area: 'HITEC City', startsAt: '2026-11-24T08:30:00+05:30', announced: '2026-11-14T10:00:00+05:30', title: 'Founders Breakfast', when: 'Tue 24 Nov · 8:30 AM', repeats: 'Every month', pricePaise: 19900, poster: poster(require('../assets/mock/founders-breakfast-3x4.png')), wide: { source: require('../assets/mock/founders-breakfast.png'), edge: '#F3EBDD' } },
  { id: 'design-critique-night', category: 'meetups', hostId: 'pixel-club', area: 'Gandipet', startsAt: '2026-11-24T18:00:00+05:30', announced: '2026-11-07T10:00:00+05:30', title: 'Design Critique Night', when: 'Tue 24 Nov · 6:00 PM', repeats: 'Every month', pricePaise: 0, poster: poster(require('../assets/mock/design-crit.png')), wide: { source: require('../assets/mock/design-crit-4x3.png'), edge: '#FFD60A' } },
  { id: 'udaan-cultural-fest', category: 'fests', hostId: 'mgit', area: 'Gandipet', startsAt: '2026-11-25T10:00:00+05:30', announced: '2026-10-31T10:00:00+05:30', title: 'Udaan Cultural Fest', when: 'Wed 25 Nov · 10:00 AM', pricePaise: 19900, poster: poster(require('../assets/mock/fest-poster.png')) },
  { id: 'reel-society-screening', category: 'film', hostId: 'reel-society', area: 'Kukatpally', startsAt: '2026-11-25T18:30:00+05:30', announced: '2026-11-17T10:00:00+05:30', title: 'Wednesday Screening', when: 'Wed 25 Nov · 6:30 PM', repeats: 'Every Wednesday', pricePaise: 4900, poster: poster(require('../assets/mock/screening-3x4.png')), wide: { source: require('../assets/mock/screening.png'), edge: '#2A0E12' } },
  { id: 'pottery-for-beginners', category: 'workshops', hostId: 'clay-days', area: 'Banjara Hills', startsAt: '2026-11-26T16:00:00+05:30', announced: '2026-11-10T10:00:00+05:30', title: 'Pottery for Beginners', when: 'Thu 26 Nov · 4:00 PM', repeats: 'Every Thursday', pricePaise: 149900, seats: '6 seats left', poster: poster(require('../assets/mock/pottery.png')) },
];

const gachibowli: Place = {
  area: 'Gachibowli',
  city: 'Hyderabad',
  nearAreas: ['Gachibowli', 'HITEC City', 'Jubilee Hills', 'Banjara Hills', 'KBR Park', 'Kukatpally', 'Gandipet'],
};
const maisammaguda: Place = { area: 'Maisammaguda', city: 'Hyderabad', nearAreas: [] };

// ponytail: which mock areas count as near a place chosen on the location screen, standing in for the 25 km check
// until events and hosts carry coordinates: all of them for a place in Hyderabad, none anywhere else.
export const nearAreasFor = (p: { area: string; city: string }) =>
  p.area === 'Hyderabad' || p.city === 'Hyderabad' ? gachibowli.nearAreas : [];

// The four Home states drawn on the Orbit canvas ("Home B · states").
export const previews = {
  signedIn: {
    signedIn: true,
    initial: 'K',
    follows: ['punchline', 'circuitfeed', 'jam-circle', 'pixel-club', 'reel-society', 'founders-club'],
    place: gachibowli,
    tickets: [
      { eventId: 'open-mic-night', label: 'Tonight, 8:00 PM' },
      { eventId: 'founders-breakfast', label: 'Tue, 8:30 AM' },
      { eventId: 'pottery-for-beginners', label: 'Thu, 4:00 PM' },
    ],
  },
  signedOut: { signedIn: false, follows: [], place: gachibowli },
  nothingNear: { signedIn: false, follows: [], place: maisammaguda },
  noLocation: { signedIn: false, follows: [], place: null },
} satisfies Record<string, Viewer>;

// Change the key to see another state on the phone; Metro reloads it.
export const viewer: Viewer = previews.signedIn;
