// Mock Home data until the API serves it. Posters are PNGs (iOS can't draw the web mocks' SVG text).
// Every event has a 3:4 poster, the app's only card shape. A few also have the 4:3 poster the carousel
// shows. Its top-edge colour (sampled once at upload) only fills in while the image loads.
// Venues and about text match the web's mock (web/src/app/mock.ts); people, links and bios are invented.
// ponytail: static data and a fixed clock; both go when the discover endpoint lands in @orbit/contract.
import type { CategorySlug } from '@orbit/contract';
import type { ImageSourcePropType } from 'react-native';

import type { Credit, Tier } from './detail';
import type { StatusEvent } from './status';
import type { Place, PlanEvent, PlanHost, Viewer } from './home/layout';
import type { MediaItem } from './media';

export type Wide = { source: ImageSourcePropType; edge: string };
export type Host = PlanHost & {
  name: string;
  initials: string;
  bg: string;
  fg: string;
  about: string; // the one line on cards
  kind: string; // "Comedy group", under Hosted by
  bio: string; // the host page's About
  followers: number; // shown from 10 (Discover decision 16)
  verified: boolean; // Orbit staff's call (Hosts flow)
  banner?: Wide;
};
// Seats, sale dates, a waitlist or a cancellation give the event its status (src/status.ts).
export type Event = PlanEvent &
  Omit<StatusEvent, 'startsAt' | 'announced' | 'pricePaise' | 'tiers'> & {
  title: string;
  category: CategorySlug; // one per event (Discover decision 12)
  when: string; // pre-formatted in India time until real timestamps reach the UI
  repeats?: string; // only for a series, e.g. "Every Sunday" (Discover decision 15)
  pricePaise: number; // 0 = free
  poster: MediaItem; // 3:4
  wide?: Wide; // 4:3, for the carousel
  // The colour of the poster its page shows (the 4:3 when there is one), sampled once at upload like `edge`: its most
  // common vivid colour, or its dominant one when it has almost none. It tints that page's cards.
  tone: string;
  venue: { name: string; address: string };
  about: string;
  people?: Credit[]; // speakers, guests and the rest, in the order the host lists them
  tiers?: Tier[]; // ticket types, when there's more than one; pricePaise is then the card's price
  agenda?: { time: string; item: string }[]; // the event's slots, in order, shown when When is tapped
  faq?: { q: string; a: string }[];
  terms?: string[]; // the host's own terms for this event, shown above the usual ones (defaultTerms)
};

// The terms every event's Terms & Conditions ends with. They follow the Booking and Money flows: one QR per booking
// admitting everyone on it, refunds per booking, a cancelled event refunded in full.
// ponytail: placeholder wording until Orbit's own terms are written.
export const defaultTerms = [
  'Your ticket admits everyone booked on it. Show its QR code at the door.',
  'Tickets can’t be resold. The host may refuse entry on a ticket that has been.',
  'Refunds follow the host’s policy. If the host cancels the event, you get your money back in full.',
  'The host may refuse entry to anyone who breaks the venue’s rules or the host’s code of conduct.',
  'The event may be photographed or filmed.',
];
// Anyone on an event's page: a speaker, a guest, a judge. 1:1 photos come later; the monogram stands in.
export type Person = {
  id: string;
  name: string;
  initials: string;
  bg: string;
  fg: string;
  headline: string; // one line under the name
  bio: string;
  links: { label: string; url: string }[];
};

const poster = (source: ImageSourcePropType): MediaItem => ({ source, ratio: '3:4' });

// Friday morning of the mock week, so "Tonight", "this week" and the When chips read right. 20 Nov 2026 is a
// Friday (the 21st, used until 15 Nov, is a Saturday).
export const now = Date.parse('2026-11-20T09:00:00+05:30');

export const hosts: Host[] = [
  { id: 'respawn', name: 'Respawn Club', initials: 'RC', bg: '#12002B', fg: '#22D3EE', area: 'Gachibowli', about: 'Esports · Gachibowli', kind: 'Gaming club', bio: 'A campus esports league for Hyderabad. Cups for college teams every month, with real screens, casters and a proper bracket.', followers: 1240, verified: true, joined: '2026-11-18T09:00:00+05:30', banner: { source: require('../assets/mock/respawn-banner.png'), edge: '#12002B' } },
  { id: 'kickoff', name: 'Kickoff Hyderabad', initials: 'KH', bg: '#166534', fg: '#FFFFFF', area: 'Gachibowli', about: 'Football every Sunday · Gachibowli', kind: 'Sports community', bio: 'Five-a-side every Sunday morning on a floodlit turf. Teams are mixed on the spot, so you can come on your own.', followers: 860, verified: true, joined: '2026-11-19T08:00:00+05:30', banner: { source: require('../assets/mock/kickoff-banner.png'), edge: '#166534' } },
  { id: 'clay-days', name: 'Clay Days', initials: 'CD', bg: '#B5532E', fg: '#FFFFFF', area: 'Banjara Hills', about: 'Pottery every Thursday · Banjara Hills', kind: 'Pottery studio', bio: 'A small pottery studio in Banjara Hills. Beginners’ classes every Thursday, and open wheel time at weekends.', followers: 412, verified: true, joined: '2026-11-15T09:00:00+05:30', banner: { source: require('../assets/mock/clay-days-banner.png'), edge: '#B5532E' } },
  { id: 'mgit', name: 'Cultural Committee, MGIT', initials: 'CC', bg: '#FF3D7F', fg: '#FFFFFF', area: 'Gandipet', about: 'Udaan Cultural Fest · Gandipet', kind: 'College fest', bio: 'The people behind Udaan, MGIT’s yearly fest of dance, music and drama, with food stalls running till late.', followers: 3120, verified: true, joined: '2026-09-14T10:00:00+05:30' },
  { id: 'punchline', name: 'Punchline Collective', initials: 'PC', bg: '#F2C14E', fg: '#141414', area: 'Jubilee Hills', about: 'Open mic every Friday · Jubilee Hills', kind: 'Comedy group', bio: 'An open mic every Friday in Jubilee Hills, where new comics try five minutes on a very forgiving room.', followers: 2050, verified: true, joined: '2026-08-31T10:00:00+05:30' },
  { id: 'circuitfeed', name: 'CircuitFeed', initials: 'CF', bg: '#C6F432', fg: '#0A0F1F', area: 'Gachibowli', about: 'Hackathons · Gachibowli', kind: 'Tech community', bio: 'A builders’ community in Gachibowli. Hackathons, demo nights and build weekends for anyone who ships.', followers: 1780, verified: true, joined: '2026-07-31T10:00:00+05:30' },
  { id: 'jam-circle', name: 'Jam Circle Hyderabad', initials: 'JC', bg: '#0F5257', fg: '#F7F3E8', area: 'KBR Park', about: 'Jams every Sunday · KBR Park', kind: 'Music circle', bio: 'An open jam under the trees in KBR Park every Sunday evening. Bring an instrument, your voice or just yourself.', followers: 640, verified: false, joined: '2026-06-30T10:00:00+05:30' },
  { id: 'founders-club', name: 'Hyderabad Founders Club', initials: 'HF', bg: '#6F4E37', fg: '#F3EBDD', area: 'HITEC City', about: 'Breakfasts every month · HITEC City', kind: 'Startup community', bio: 'A monthly breakfast for the city’s founders: one long table, no slides and no pitches.', followers: 290, verified: true, joined: '2026-05-31T10:00:00+05:30' },
  { id: 'pixel-club', name: 'Pixel Club, CBIT', initials: 'PX', bg: '#FFD60A', fg: '#111111', area: 'Gandipet', about: 'Design crits every month · Gandipet', kind: 'College club', bio: 'CBIT’s design club. Students bring a screen, a poster or a prototype once a month and get honest feedback.', followers: 8, verified: false, joined: '2026-10-14T10:00:00+05:30' },
  { id: 'reel-society', name: 'Reel Society', initials: 'RS', bg: '#7A1E28', fg: '#FFF1E6', area: 'Kukatpally', about: 'Screenings every Wednesday · Kukatpally', kind: 'Film club', bio: 'A film club in Kukatpally. A classic on the big screen every Wednesday, then an open discussion.', followers: 530, verified: false, joined: '2026-08-19T10:00:00+05:30' },
  // Performers, the acts events are "with" (Discover 23; Performer profiles: a Performer is a host kind).
  { id: 'arjun-rao-live', name: 'Arjun Rao', initials: 'AR', bg: '#F25C2A', fg: '#FFFFFF', area: 'Jubilee Hills', about: 'Stand-up · Hyderabad', kind: 'Performer', bio: 'Stand-up in Hindi and English. Started at Punchline’s open mic and now headlines rooms across the south.', followers: 2310, verified: true, joined: '2026-11-12T09:00:00+05:30' },
  { id: 'kabir-strings', name: 'Kabir Strings', initials: 'KS', bg: '#0F5257', fg: '#F7F3E8', area: 'KBR Park', about: 'Acoustic duo · Hyderabad', kind: 'Performer', bio: 'An acoustic duo, guitar and cajón, playing Bollywood and indie covers at jams and cafés across the city.', followers: 640, verified: true, joined: '2026-11-10T09:00:00+05:30' },
  { id: 'the-local-loop', name: 'The Local Loop', initials: 'LL', bg: '#1E3A8A', fg: '#FFFFFF', area: 'Banjara Hills', about: 'Indie band · Hyderabad', kind: 'Performer', bio: 'A five-piece indie band from Hyderabad. Telugu and English songs, loud and danceable.', followers: 1820, verified: true, joined: '2026-11-08T09:00:00+05:30' },
  { id: 'dj-saanvi', name: 'DJ Saanvi', initials: 'DS', bg: '#7048E8', fg: '#FFFFFF', area: 'Jubilee Hills', about: 'DJ · Hyderabad', kind: 'Performer', bio: 'House and Bollywood sets for college fests and rooftops.', followers: 960, verified: false, joined: '2026-11-14T09:00:00+05:30' },
  // Places to play, booked by the hour (Play: a Venue host with stations; src/kinds.ts has their stations and hours).
  { id: 'kickoff-arena', name: 'Kickoff Arena', initials: 'KA', bg: '#14532D', fg: '#FFFFFF', area: 'Gachibowli', about: 'Turf and box cricket · Gachibowli', kind: 'Venue', bio: 'Two floodlit five-a-side pitches and a netted box-cricket box, open from 6 AM to midnight. Book a pitch for your group by the hour.', followers: 1120, verified: true, joined: '2026-11-11T09:00:00+05:30' },
  { id: 'smash-court', name: 'Smash Court', initials: 'SC', bg: '#0B7285', fg: '#FFFFFF', area: 'Kondapur', about: 'Badminton courts · Kondapur', kind: 'Venue', bio: 'Four wooden-floor badminton courts in Kondapur. Rackets and shuttles to hire at the desk.', followers: 380, verified: true, joined: '2026-11-13T09:00:00+05:30' },
  { id: 'respawn-zone', name: 'Respawn Zone', initials: 'RZ', bg: '#12002B', fg: '#22D3EE', area: 'Gachibowli', about: 'Gaming café · Gachibowli', kind: 'Venue', bio: 'Twelve gaming PCs, four PS5s and two VR bays, open till 2 AM. Book a station by the hour, solo or with a friend.', followers: 2040, verified: true, joined: '2026-11-09T09:00:00+05:30' },
];

// ponytail: example.com links stand in for real profiles, so the mock never points at someone's real account.
export const people: Person[] = [
  { id: 'arjun-rao', name: 'Arjun Rao', initials: 'AR', bg: '#F25C2A', fg: '#FFFFFF', headline: 'Stand-up comic', bio: 'Arjun started at Punchline’s open mic three years ago and now headlines rooms across the south. His sets are about growing up in Secunderabad.', links: [{ label: 'Instagram', url: 'https://example.com/arjun-rao' }] },
  { id: 'sana-qureshi', name: 'Sana Qureshi', initials: 'SQ', bg: '#0F5257', fg: '#F7F3E8', headline: 'Singer and songwriter', bio: 'Sana writes in Urdu and English and plays guitar at jams around the city. Her first EP came out this year.', links: [{ label: 'Instagram', url: 'https://example.com/sana-qureshi' }, { label: 'Website', url: 'https://example.com/sana' }] },
  { id: 'vikram-reddy', name: 'Vikram Reddy', initials: 'VR', bg: '#1E3A8A', fg: '#FFFFFF', headline: 'Co-founder and CTO, a Hyderabad fintech', bio: 'Vikram has built payments software for ten years. He judges hackathons for the projects that work on the day, not the slides.', links: [{ label: 'LinkedIn', url: 'https://example.com/vikram-reddy' }] },
  { id: 'ananya-desai', name: 'Ananya Desai', initials: 'AD', bg: '#7048E8', fg: '#FFFFFF', headline: 'Product designer', bio: 'Ananya leads design at a consumer app in HITEC City and mentors students on their first portfolios.', links: [{ label: 'LinkedIn', url: 'https://example.com/ananya-desai' }, { label: 'Website', url: 'https://example.com/ananya' }] },
  { id: 'kiran-kumar', name: 'Kiran Kumar', initials: 'KK', bg: '#099268', fg: '#FFFFFF', headline: 'Backend engineer', bio: 'Kiran has mentored at every CircuitFeed hackathon. Bring him your stuck database and your cold coffee.', links: [{ label: 'LinkedIn', url: 'https://example.com/kiran-kumar' }] },
  { id: 'priya-nair', name: 'Priya Nair', initials: 'PN', bg: '#6F4E37', fg: '#F3EBDD', headline: 'Angel investor', bio: 'Priya backs early teams in Hyderabad and talks about the first year of a company, the part nobody posts about.', links: [{ label: 'LinkedIn', url: 'https://example.com/priya-nair' }] },
  { id: 'farhan-ali', name: 'Farhan Ali', initials: 'FA', bg: '#7A1E28', fg: '#FFF1E6', headline: 'Film critic', bio: 'Farhan writes about cinema and leads the discussion after Reel Society’s screenings.', links: [{ label: 'Website', url: 'https://example.com/farhan-ali' }] },
];

export const events: Event[] = [
  { id: 'open-mic-night', tone: '#F25C2A', category: 'comedy', hostId: 'punchline', area: 'Jubilee Hills', startsAt: '2026-11-20T20:00:00+05:30', announced: '2026-11-09T10:00:00+05:30', title: 'Open Mic Night', when: 'Fri 20 Nov · 8:00 PM', repeats: 'Every Friday', pricePaise: 29900, capacity: 60, left: 9, poster: poster(require('../assets/mock/open-mic.png')), wide: { source: require('../assets/mock/open-mic-4x3.png'), edge: '#F25C2A' }, venue: { name: 'The Green Room', address: 'Road No. 36, Jubilee Hills, Hyderabad' }, about: 'Ten new comics, five minutes each, one very forgiving room. Sign up on the night if you want a spot.', people: [{ personId: 'arjun-rao', role: 'Guest' }], agenda: [{ time: '7:30 PM', item: 'Doors open, sign-ups at the bar' }, { time: '8:00 PM', item: 'First comic on stage' }, { time: '9:15 PM', item: 'Arjun Rao, guest set' }, { time: '10:00 PM', item: 'Close' }], faq: [{ q: 'How do I get a spot?', a: 'Sign up at the bar from 7:30 PM. There are ten spots, first come, first served.' }, { q: 'Is there food?', a: 'The bar serves snacks and drinks. No outside food.' }] },
  { id: 'build-anything-hackathon', tone: '#C7F532', category: 'hackathons', hostId: 'circuitfeed', area: 'Gachibowli', startsAt: '2026-11-21T09:00:00+05:30', announced: '2026-11-19T10:00:00+05:30', title: 'Build Anything Hackathon', when: 'Sat 21 Nov · 9:00 AM', pricePaise: 49900, capacity: 150, left: 8, poster: poster(require('../assets/mock/hackathon-poster.png')), wide: { source: require('../assets/mock/hackathon-4x3.png'), edge: '#0A0F1F' }, venue: { name: 'CircuitFeed Lab', address: 'Financial District, Gachibowli, Hyderabad' }, about: '24 hours to build anything you like: an app, a tool, a game or hardware. Come solo or bring a team of up to four. Mentors from Hyderabad’s product teams drop in through the night. Food, power and Wi-Fi are on us.', people: [{ personId: 'vikram-reddy', role: 'Judge' }, { personId: 'ananya-desai', role: 'Mentor' }, { personId: 'kiran-kumar', role: 'Mentor' }], tiers: [{ name: 'Early bird', pricePaise: 29900, soldOut: true }, { name: 'Solo', pricePaise: 49900 }, { name: 'Team of 4', pricePaise: 179900 }], agenda: [{ time: 'Sat 9:00 AM', item: 'Check-in and breakfast' }, { time: 'Sat 10:00 AM', item: 'Kickoff and team formation' }, { time: 'Sat 10:30 AM', item: 'Hacking starts' }, { time: 'Sun 7:00 AM', item: 'Submissions close' }, { time: 'Sun 7:30 AM', item: 'Demos and judging' }, { time: 'Sun 9:00 AM', item: 'Results' }], faq: [{ q: 'Who can take part?', a: 'Anyone 18 or older. Students, working people and first-time builders are all welcome.' }, { q: 'Do I need a team?', a: 'No. Come solo and join a team at kickoff, or build on your own.' }, { q: 'What should I bring?', a: 'A laptop, a charger and any hardware you want to use. We have extension boards.' }], terms: ['Open to anyone 18 or older. Bring a photo ID.', 'Projects must be started at the event.'] },
  { id: 'campus-esports-cup', tone: '#22D3EE', category: 'gaming', hostId: 'respawn', area: 'Gachibowli', startsAt: '2026-11-21T11:00:00+05:30', announced: '2026-11-11T10:00:00+05:30', title: 'Campus Esports Cup', when: 'Sat 21 Nov · 11:00 AM', pricePaise: 9900, capacity: 32, left: 0, waitlist: true, poster: poster(require('../assets/mock/esports-cup.png')), venue: { name: 'Respawn Club Arena', address: 'Gachibowli, Hyderabad' }, about: 'A one-day knockout for teams of five from any campus in the city. Bring your own peripherals; we bring the screens.' },
  { id: 'sunday-5-a-side', tone: '#15803D', category: 'sports', hostId: 'kickoff', area: 'Gachibowli', startsAt: '2026-11-22T07:00:00+05:30', announced: '2026-11-04T10:00:00+05:30', title: 'Sunday 5-a-side Football', when: 'Sun 22 Nov · 7:00 AM', repeats: 'Every Sunday', pricePaise: 14900, capacity: 20, left: 0, poster: poster(require('../assets/mock/football-3x4.png')), venue: { name: 'Turf 5', address: 'Gachibowli, Hyderabad' }, about: 'Early-morning five-a-side on a floodlit turf. Teams are mixed on the spot, so come alone or with friends.' },
  { id: 'sunday-jam', tone: '#085858', category: 'music', hostId: 'jam-circle', area: 'KBR Park', startsAt: '2026-11-22T17:00:00+05:30', announced: '2026-11-11T10:00:00+05:30', title: 'Sunday Jam', when: 'Sun 22 Nov · 5:00 PM', repeats: 'Every Sunday', pricePaise: 0, poster: poster(require('../assets/mock/sunday-jam-3x4.png')), wide: { source: require('../assets/mock/sunday-jam.png'), edge: '#0F5257' }, venue: { name: 'KBR Park, main gate', address: 'Road No. 2, Banjara Hills, Hyderabad' }, about: 'An open jam under the trees. Bring an instrument, your voice or just yourself.', people: [{ personId: 'sana-qureshi', role: 'Guest' }] },
  { id: 'founders-breakfast', tone: '#F8E8D8', category: 'startups', hostId: 'founders-club', area: 'HITEC City', startsAt: '2026-11-24T08:30:00+05:30', announced: '2026-11-14T10:00:00+05:30', title: 'Founders Breakfast', when: 'Tue 24 Nov · 8:30 AM', repeats: 'Every month', pricePaise: 19900, capacity: 40, left: 14, poster: poster(require('../assets/mock/founders-breakfast-3x4.png')), wide: { source: require('../assets/mock/founders-breakfast.png'), edge: '#F3EBDD' }, venue: { name: 'Café Commons', address: 'HITEC City, Hyderabad' }, about: 'Forty founders, one long table and no slides. Breakfast is included.', people: [{ personId: 'priya-nair', role: 'Speaker' }, { personId: 'vikram-reddy', role: 'Speaker' }], agenda: [{ time: '8:30 AM', item: 'Coffee and introductions' }, { time: '9:00 AM', item: 'Priya Nair on the first year' }, { time: '9:30 AM', item: 'Vikram Reddy on hiring your first engineers' }, { time: '10:00 AM', item: 'Open table' }], faq: [{ q: 'Who should come?', a: 'Founders and early team members, at any stage.' }, { q: 'Can I pitch?', a: 'No pitches and no slides. Come to talk.' }] },
  { id: 'design-critique-night', tone: '#FFD70A', category: 'meetups', hostId: 'pixel-club', area: 'Gandipet', startsAt: '2026-11-24T18:00:00+05:30', announced: '2026-11-07T10:00:00+05:30', title: 'Design Critique Night', when: 'Tue 24 Nov · 6:00 PM', repeats: 'Every month', pricePaise: 0, salesOpen: '2026-11-21T18:00:00+05:30', poster: poster(require('../assets/mock/design-crit.png')), wide: { source: require('../assets/mock/design-crit-4x3.png'), edge: '#FFD60A' }, venue: { name: 'CBIT, Seminar Hall 2', address: 'Gandipet, Hyderabad' }, about: 'Bring one thing you made, a screen, a poster or a prototype, and get honest feedback from designers and peers.', people: [{ personId: 'ananya-desai', role: 'Guest' }] },
  { id: 'udaan-cultural-fest', tone: '#FF3C7E', category: 'fests', hostId: 'mgit', area: 'Gandipet', startsAt: '2026-11-25T10:00:00+05:30', announced: '2026-10-31T10:00:00+05:30', title: 'Udaan Cultural Fest', when: 'Wed 25 Nov · 10:00 AM', pricePaise: 19900, poster: poster(require('../assets/mock/fest-poster.png')), venue: { name: 'MGIT main ground', address: 'Gandipet, Hyderabad' }, about: 'A full day of dance, music and drama competitions, with food stalls running till late.', people: [{ personId: 'sana-qureshi', role: 'Performer' }, { personId: 'arjun-rao', role: 'Performer' }], agenda: [{ time: '10:00 AM', item: 'Inauguration' }, { time: '11:00 AM', item: 'Dance competition' }, { time: '2:00 PM', item: 'Battle of the bands' }, { time: '5:00 PM', item: 'Drama finals' }, { time: '8:00 PM', item: 'Sana Qureshi and Arjun Rao, closing night' }], faq: [{ q: 'Do I need to be an MGIT student?', a: 'No. Udaan is open to everyone with a ticket. Bring a photo ID.' }, { q: 'Is there parking?', a: 'Yes, free on the college grounds.' }, { q: 'Can I enter a competition?', a: 'Registrations for the competitions are on the fest desk on the day.' }] },
  { id: 'reel-society-screening', tone: '#7A1E28', category: 'film', hostId: 'reel-society', area: 'Kukatpally', startsAt: '2026-11-25T18:30:00+05:30', announced: '2026-11-17T10:00:00+05:30', title: 'Wednesday Screening', when: 'Wed 25 Nov · 6:30 PM', repeats: 'Every Wednesday', pricePaise: 4900, poster: poster(require('../assets/mock/screening-3x4.png')), wide: { source: require('../assets/mock/screening.png'), edge: '#2A0E12' }, venue: { name: 'Reel Society Screening Room', address: 'Kukatpally, Hyderabad' }, about: 'A classic on the big screen, followed by an open discussion. The title is announced on the night.', people: [{ personId: 'farhan-ali', role: 'Speaker' }] },
  { id: 'pottery-for-beginners', tone: '#B5532E', category: 'workshops', hostId: 'clay-days', area: 'Banjara Hills', startsAt: '2026-11-26T16:00:00+05:30', announced: '2026-11-10T10:00:00+05:30', title: 'Pottery for Beginners', when: 'Thu 26 Nov · 4:00 PM', repeats: 'Every Thursday', pricePaise: 149900, capacity: 10, left: 6, poster: poster(require('../assets/mock/pottery.png')), venue: { name: 'Clay Days Studio', address: 'Road No. 12, Banjara Hills, Hyderabad' }, about: 'Two hours on the wheel with a teacher beside you. Your piece is fired and ready to collect in two weeks.' },
  // Past, for host pages and people. Home and Search show only upcoming events, so these never reach them.
  { id: 'design-critique-18-nov', tone: '#FFD70A', category: 'meetups', hostId: 'pixel-club', area: 'Gandipet', startsAt: '2026-11-18T18:00:00+05:30', announced: '2026-10-28T10:00:00+05:30', title: 'Design Critique Night', when: 'Wed 18 Nov · 6:00 PM', repeats: 'Every month', pricePaise: 0, poster: poster(require('../assets/mock/design-crit.png')), wide: { source: require('../assets/mock/design-crit-4x3.png'), edge: '#FFD60A' }, venue: { name: 'CBIT, Seminar Hall 2', address: 'Gandipet, Hyderabad' }, about: 'Bring one thing you made, a screen, a poster or a prototype, and get honest feedback from designers and peers.', people: [{ personId: 'ananya-desai', role: 'Guest' }] },
  { id: 'open-mic-night-13-nov', tone: '#F25C2A', category: 'comedy', hostId: 'punchline', area: 'Jubilee Hills', startsAt: '2026-11-13T20:00:00+05:30', announced: '2026-11-02T10:00:00+05:30', title: 'Open Mic Night', when: 'Fri 13 Nov · 8:00 PM', repeats: 'Every Friday', pricePaise: 29900, poster: poster(require('../assets/mock/open-mic.png')), venue: { name: 'The Green Room', address: 'Road No. 36, Jubilee Hills, Hyderabad' }, about: 'Ten new comics, five minutes each, one very forgiving room.', people: [{ personId: 'arjun-rao', role: 'Guest' }] },
  { id: 'monsoon-hack', tone: '#C6F432', category: 'hackathons', hostId: 'circuitfeed', area: 'Gachibowli', startsAt: '2026-08-22T09:00:00+05:30', announced: '2026-08-01T10:00:00+05:30', title: 'Monsoon Hack', when: 'Sat 22 Aug · 9:00 AM', pricePaise: 29900, poster: poster(require('../assets/mock/hackathon-poster.png')), venue: { name: 'CircuitFeed Lab', address: 'Financial District, Gachibowli, Hyderabad' }, about: 'A rainy-weekend hackathon: 24 hours, any idea, teams of up to four.', people: [{ personId: 'vikram-reddy', role: 'Judge' }, { personId: 'kiran-kumar', role: 'Mentor' }] },
  { id: 'udaan-2025', tone: '#FF3C7E', category: 'fests', hostId: 'mgit', area: 'Gandipet', startsAt: '2025-11-26T10:00:00+05:30', announced: '2025-10-30T10:00:00+05:30', title: 'Udaan Cultural Fest 2025', when: 'Wed 26 Nov 2025 · 10:00 AM', pricePaise: 14900, poster: poster(require('../assets/mock/fest-poster.png')), venue: { name: 'MGIT main ground', address: 'Gandipet, Hyderabad' }, about: 'Last year’s Udaan: a full day of dance, music and drama.', people: [{ personId: 'sana-qureshi', role: 'Performer' }] },
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
    initial: 'A', // Abhinavtej Reddy, the Account mock (src/account/data.ts)
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

// What an event is like, as small cards on its page under About (owner, 19 Nov 2026: "add interest cards for events",
// all four kinds): its category first (drawn from `category`), then these. Read from each event's About.
// ponytail: written here by hand; the host picks them on the event once events reach the API.
export const vibes: Record<string, readonly string[]> = {
  'open-mic-night': ['Stand-up', 'New comics', 'Sign up on the night'],
  'open-mic-night-13-nov': ['Stand-up', 'New comics', 'Sign up on the night'],
  'build-anything-hackathon': ['24 hours', 'Solo or teams of four', 'Mentors'],
  'monsoon-hack': ['24 hours', 'Teams'],
  'campus-esports-cup': ['Teams of five', 'Knockout', 'Any campus'],
  'sunday-5-a-side': ['Five-a-side', 'Floodlit turf', 'Fine to come alone'],
  'sunday-jam': ['Open jam', 'Outdoors', 'Bring an instrument'],
  'founders-breakfast': ['Forty founders', 'No slides', 'Breakfast included'],
  'design-critique-night': ['Bring your work', 'Honest feedback'],
  'design-critique-18-nov': ['Bring your work', 'Honest feedback'],
  'udaan-cultural-fest': ['Dance, music and drama', 'Competitions', 'Food stalls'],
  'udaan-2025': ['Dance, music and drama', 'Competitions'],
  'reel-society-screening': ['A classic', 'Discussion after', 'Title on the night'],
  'pottery-for-beginners': ['On the wheel', 'A teacher beside you', 'Take your piece home'],
};

// How many people are interested in an event before your own tap, the same number every time.
// ponytail: a stand-in until the API counts real Interested taps.
export function interestedBase(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 6 + (h % 180);
}
