// Mock data for the home and event pages until the API serves discover and event detail.
// The shapes are guesses: replace them with types from @orbit/contract when the endpoints exist.
// The posters in public/mock are hand-drawn stand-ins in each allowed shape (3:4, 4:3, A-series).
import type { MediaItem } from "./media";

export type EventCard = {
  media?: MediaItem;
  slug: string;
  category: string; // a slug from categories in discover.tsx
  repeats?: string; // how often the host runs it, e.g. "Every Sunday"; none for one-offs
  title: string;
  host: string;
  date: string; // pre-formatted until real timestamps arrive
  time: string;
  area: string;
  pricePaise: number; // 0 = free
  taken: number;
  capacity: number | null; // null = no limit
};

export const spotlight: EventCard & { status: string } = {
  slug: "build-anything-hackathon", category: "hackathons", repeats: "Every year",
  title: "Build Anything Hackathon",
  host: "CircuitFeed",
  date: "Sat 22 Nov",
  time: "9:00 AM",
  area: "Gachibowli",
  pricePaise: 49900,
  taken: 48,
  capacity: 60,
  status: "Registrations open",
  media: { src: "/mock/hackathon-poster.svg", ratio: "1:1.414" },
};

export const thisWeek: EventCard[] = [
  // In date order, one or more per Explore type.
  { slug: "open-mic-night", category: "comedy", repeats: "Every Friday", title: "Open Mic Night", host: "Punchline Collective", date: "Fri 21 Nov", time: "8:00 PM", area: "Jubilee Hills", pricePaise: 29900, taken: 71, capacity: 80, media: { src: "/mock/open-mic.svg", ratio: "3:4" } },
  { slug: "campus-esports-cup", category: "gaming", title: "Campus Esports Cup", host: "Respawn Club", date: "Sat 22 Nov", time: "11:00 AM", area: "Gachibowli", pricePaise: 9900, taken: 48, capacity: 64, media: { src: "/mock/esports-cup.svg", ratio: "3:4" } },
  { slug: "sunday-5-a-side", category: "sports", repeats: "Every Sunday", title: "Sunday 5-a-side Football", host: "Kickoff Hyderabad", date: "Sun 23 Nov", time: "7:00 AM", area: "Gachibowli", pricePaise: 14900, taken: 32, capacity: 40, media: { src: "/mock/football.svg", ratio: "4:3" } },
  { slug: "sunday-jam", category: "music", repeats: "Every Sunday", title: "Sunday Jam", host: "Jam Circle Hyderabad", date: "Sun 23 Nov", time: "5:00 PM", area: "KBR Park", pricePaise: 0, taken: 34, capacity: null, media: { src: "/mock/sunday-jam.svg", ratio: "4:3" } },
  { slug: "founders-breakfast", category: "startups", repeats: "Every month", title: "Founders Breakfast", host: "Hyderabad Founders Club", date: "Tue 25 Nov", time: "8:30 AM", area: "HITEC City", pricePaise: 19900, taken: 9, capacity: 40, media: { src: "/mock/founders-breakfast.svg", ratio: "4:3" } },
  { slug: "design-critique-night", category: "meetups", repeats: "Every month", title: "Design Critique Night", host: "Pixel Club, CBIT", date: "Tue 25 Nov", time: "6:00 PM", area: "Gandipet", pricePaise: 0, taken: 52, capacity: 120, media: { src: "/mock/design-crit.svg", ratio: "1:1.414" } },
  { slug: "udaan-cultural-fest", category: "fests", repeats: "Every year", title: "Udaan Cultural Fest", host: "Cultural Committee, MGIT", date: "Wed 26 Nov", time: "10:00 AM", area: "Gandipet", pricePaise: 19900, taken: 640, capacity: 1000, media: { src: "/mock/fest-poster.svg", ratio: "1:1.414" } },
  { slug: "reel-society-screening", category: "film", repeats: "Every Wednesday", title: "Wednesday Screening", host: "Reel Society", date: "Wed 26 Nov", time: "6:30 PM", area: "Kukatpally", pricePaise: 4900, taken: 58, capacity: 60, media: { src: "/mock/screening.svg", ratio: "4:3" } },
  { slug: "pottery-for-beginners", category: "workshops", repeats: "Every Thursday", title: "Pottery for Beginners", host: "Clay Days", date: "Thu 27 Nov", time: "4:00 PM", area: "Banjara Hills", pricePaise: 149900, taken: 6, capacity: 12, media: { src: "/mock/pottery.svg", ratio: "3:4" } },
];

const rupees = (fraction: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: fraction, minimumFractionDigits: fraction });

export function formatPrice(paise: number): string {
  if (paise === 0) return "Free";
  return rupees(paise % 100 ? 2 : 0).format(paise / 100);
}

// Event detail, keyed by slug. Venues and copy are invented for the mock.
export type Tier = { id: string; name: string; pricePaise: number; note?: string; soldOut?: boolean };

type Detail = {
  hostKind: string;
  about: string[];
  venue: { name: string; address: string };
  tiers?: Tier[]; // default: one tier at the card price
  agenda?: { time: string; item: string }[];
  faq?: { q: string; a: string }[];
};

const details: Record<string, Detail> = {
  "build-anything-hackathon": {
    hostKind: "Tech community",
    about: [
      "24 hours to build anything you like: an app, a tool, a game or hardware. Come solo or bring a team of up to four.",
      "Mentors from Hyderabad's product teams drop in through the night. Food, power and Wi-Fi are on us.",
    ],
    venue: { name: "CircuitFeed Lab", address: "Financial District, Gachibowli, Hyderabad" },
    tiers: [
      { id: "early", name: "Early bird", pricePaise: 29900, soldOut: true },
      { id: "solo", name: "Solo", pricePaise: 49900 },
      { id: "team", name: "Team of 4", pricePaise: 179900, note: "One ticket covers four people" },
    ],
    agenda: [
      { time: "Sat 9:00 AM", item: "Check-in and breakfast" },
      { time: "Sat 10:00 AM", item: "Kickoff and team formation" },
      { time: "Sat 10:30 AM", item: "Hacking starts" },
      { time: "Sun 7:00 AM", item: "Submissions close" },
      { time: "Sun 7:30 AM", item: "Demos and judging" },
      { time: "Sun 9:00 AM", item: "Results" },
    ],
    faq: [
      { q: "Who can take part?", a: "Anyone 18 or older. Students, working people and first-time builders are all welcome." },
      { q: "Do I need a team?", a: "No. Come solo and join a team at kickoff, or build on your own." },
      { q: "What should I bring?", a: "A laptop, a charger and any hardware you want to use. We have extension boards." },
    ],
  },
  "open-mic-night": {
    hostKind: "Comedy group",
    about: ["Ten new comics, five minutes each, one very forgiving room. Sign up on the night if you want a spot."],
    venue: { name: "The Green Room", address: "Road No. 36, Jubilee Hills, Hyderabad" },
  },
  "campus-esports-cup": {
    hostKind: "Gaming club",
    about: ["A one-day knockout for teams of five from any campus in the city. Bring your own peripherals; we bring the screens."],
    venue: { name: "Respawn Club Arena", address: "Gachibowli, Hyderabad" },
  },
  "sunday-5-a-side": {
    hostKind: "Sports community",
    about: ["Early-morning five-a-side on a floodlit turf. Teams are mixed on the spot, so come alone or with friends."],
    venue: { name: "Turf 5", address: "Gachibowli, Hyderabad" },
  },
  "sunday-jam": {
    hostKind: "Music circle",
    about: ["An open jam under the trees. Bring an instrument, your voice or just yourself."],
    venue: { name: "KBR Park, main gate", address: "Road No. 2, Banjara Hills, Hyderabad" },
  },
  "founders-breakfast": {
    hostKind: "Startup community",
    about: ["Forty founders, one long table and no slides. Breakfast is included."],
    venue: { name: "Café Commons", address: "HITEC City, Hyderabad" },
  },
  "design-critique-night": {
    hostKind: "College club",
    about: ["Bring one thing you made, a screen, a poster or a prototype, and get honest feedback from designers and peers."],
    venue: { name: "CBIT, Seminar Hall 2", address: "Gandipet, Hyderabad" },
  },
  "udaan-cultural-fest": {
    hostKind: "College fest",
    about: ["A full day of dance, music and drama competitions, with food stalls running till late."],
    venue: { name: "MGIT main ground", address: "Gandipet, Hyderabad" },
  },
  "reel-society-screening": {
    hostKind: "Film club",
    about: ["A classic on the big screen, followed by an open discussion. The title is announced on the night."],
    venue: { name: "Reel Society Screening Room", address: "Kukatpally, Hyderabad" },
  },
  "pottery-for-beginners": {
    hostKind: "Pottery studio",
    about: ["Two hours on the wheel with a teacher beside you. Your piece is fired and ready to collect in two weeks."],
    venue: { name: "Clay Days Studio", address: "Road No. 12, Banjara Hills, Hyderabad" },
  },
};

export type EventPage = EventCard & Detail & { tiers: Tier[] };

export const allEvents: EventCard[] = [spotlight, ...thisWeek];

export function getEvent(slug: string): EventPage | null {
  const card = allEvents.find((e) => e.slug === slug);
  const detail = details[slug];
  if (!card || !detail) return null;
  const tiers = detail.tiers ?? [{ id: "general", name: card.pricePaise ? "General" : "Free entry", pricePaise: card.pricePaise }];
  return { ...card, ...detail, tiers };
}
