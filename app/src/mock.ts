// Mock Discover data until the API serves it. Same events as web/src/app/mock.ts, so the app and
// the site show the same thing; posters are PNG copies of web/public/mock (iOS can't draw their SVG text).
// ponytail: duplicated from web on purpose; both go when the discover endpoint lands in @orbit/contract.
import type { MediaItem } from './media';

export type EventCard = {
  slug: string;
  category: string; // a slug from categories in src/app/index.tsx
  repeats?: string; // how often the host runs it, e.g. "Every Sunday"; none for one-offs
  title: string;
  host: string;
  date: string; // pre-formatted until real timestamps arrive
  time: string;
  area: string;
  pricePaise: number; // 0 = free
  media: MediaItem;
};

// Static until location lands (web asks the browser and names the area with Google's Geocoding).
export const place = { area: 'Gachibowli', city: 'Hyderabad' };

export const spotlight: EventCard & { status: string } = {
  slug: 'build-anything-hackathon', category: 'hackathons', repeats: 'Every year',
  title: 'Build Anything Hackathon', host: 'CircuitFeed', date: 'Sat 22 Nov', time: '9:00 AM', area: 'Gachibowli',
  pricePaise: 49900, status: 'Registrations open',
  media: { source: require('../assets/mock/hackathon-poster.png'), ratio: '1:1.414' },
};

export const thisWeek: EventCard[] = [
  { slug: 'open-mic-night', category: 'comedy', repeats: 'Every Friday', title: 'Open Mic Night', host: 'Punchline Collective', date: 'Fri 21 Nov', time: '8:00 PM', area: 'Jubilee Hills', pricePaise: 29900, media: { source: require('../assets/mock/open-mic.png'), ratio: '3:4' } },
  { slug: 'campus-esports-cup', category: 'gaming', title: 'Campus Esports Cup', host: 'Respawn Club', date: 'Sat 22 Nov', time: '11:00 AM', area: 'Gachibowli', pricePaise: 9900, media: { source: require('../assets/mock/esports-cup.png'), ratio: '3:4' } },
  { slug: 'sunday-5-a-side', category: 'sports', repeats: 'Every Sunday', title: 'Sunday 5-a-side Football', host: 'Kickoff Hyderabad', date: 'Sun 23 Nov', time: '7:00 AM', area: 'Gachibowli', pricePaise: 14900, media: { source: require('../assets/mock/football.png'), ratio: '4:3' } },
  { slug: 'sunday-jam', category: 'music', repeats: 'Every Sunday', title: 'Sunday Jam', host: 'Jam Circle Hyderabad', date: 'Sun 23 Nov', time: '5:00 PM', area: 'KBR Park', pricePaise: 0, media: { source: require('../assets/mock/sunday-jam.png'), ratio: '4:3' } },
  { slug: 'founders-breakfast', category: 'startups', repeats: 'Every month', title: 'Founders Breakfast', host: 'Hyderabad Founders Club', date: 'Tue 25 Nov', time: '8:30 AM', area: 'HITEC City', pricePaise: 19900, media: { source: require('../assets/mock/founders-breakfast.png'), ratio: '4:3' } },
  { slug: 'design-critique-night', category: 'art', repeats: 'Every month', title: 'Design Critique Night', host: 'Pixel Club, CBIT', date: 'Tue 25 Nov', time: '6:00 PM', area: 'Gandipet', pricePaise: 0, media: { source: require('../assets/mock/design-crit.png'), ratio: '1:1.414' } },
  { slug: 'udaan-cultural-fest', category: 'fests', repeats: 'Every year', title: 'Udaan Cultural Fest', host: 'Cultural Committee, MGIT', date: 'Wed 26 Nov', time: '10:00 AM', area: 'Gandipet', pricePaise: 19900, media: { source: require('../assets/mock/fest-poster.png'), ratio: '1:1.414' } },
  { slug: 'reel-society-screening', category: 'film', repeats: 'Every Wednesday', title: 'Wednesday Screening', host: 'Reel Society', date: 'Wed 26 Nov', time: '6:30 PM', area: 'Kukatpally', pricePaise: 4900, media: { source: require('../assets/mock/screening.png'), ratio: '4:3' } },
  { slug: 'pottery-for-beginners', category: 'workshops', repeats: 'Every Thursday', title: 'Pottery for Beginners', host: 'Clay Days', date: 'Thu 27 Nov', time: '4:00 PM', area: 'Banjara Hills', pricePaise: 149900, media: { source: require('../assets/mock/pottery.png'), ratio: '3:4' } },
];
