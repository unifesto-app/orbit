import { z } from "zod";
import { categories, type CategorySlug } from "./categories.ts";
import { Text } from "./text.ts";

// App content: what Orbit itself puts in the app, edited in Galaxy's App content page (owner, 19 Nov 2026: "build CMS
// for Orbit App in galaxy web", then "featured & promoted", "Ad strips image uplaod also instead of text", "also add
// custom ads in carousel"). Five lists, each saved whole:
//   ads       Orbit's own ad strips (app/src/orbitAd.tsx), words or an uploaded 4.5:1 image: Home shows the first two
//             live ones marked Home, Search and Account the first live one marked for each. Not a host's paid Boost, so
//             never labelled Promoted.
//   help      Account › Help and support's questions, each answer opening under it.
//   asks      What to ask Orbit: the chips on the chat's welcome and on Search.
//   featured  Home's carousel, right after a promoted slide, in staff's order: an event's or host's own 4:3 picture
//             (a pick), or Orbit's own 4:3 image slide. No label. The carousel fills the rest as before.
//   promoted  Events marked Promoted: the label, first in lists, the carousel's lead and Home's middle banner
//             (app/src/home/layout.ts), set by staff until hosts can buy Boost.
//   interests The kinds of event offered on Account › Interests and Home's one ask, in staff's order (orbit-pm X13,
//             26 Nov 2026): staff hide or reorder categories, never add one, since each one's drawing ships in the app.
// Each item but help and asks has optional `starts` and `ends`. Hosts' own events and pages are theirs, never edited
// here. GET /public/app-content serves all five; a list nobody has saved yet, or one saved under an older schema that
// no longer reads, falls back to DEFAULT_CONTENT, which is what the app showed before the CMS.

// A strip's fill, by name: Orbit's two fills (@orbit/tokens palette), each carrying Stone words. Sage is the accent and
// never a fill; Charcoal would vanish into the page.
export const AD_COLOURS = { forest: "Forest", moss: "Moss" } as const;
export type AdColour = keyof typeof AD_COLOURS;

export const AD_PLACES = { home: "Home", search: "Search", account: "Account" } as const;
export type AdPlace = keyof typeof AD_PLACES;

// Where an ad or a slide may open, as an app route. The app pushes it straight to the router, so only these: a screen
// below, or one event's or host's page by its link. Anything else (a web address, a path with a query) is refused.
export const AD_LINKS = {
  "/search": "Search",
  "/chat": "Ask Orbit",
  "/inbox": "Notifications",
  "/account/payment": "Payment methods",
  "/account/interests": "Interests",
  "/account/tickets": "Tickets",
  "/account/saved": "Saved",
} as const;
const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PAGE = new RegExp(`^/(event|host)/${SLUG}$`);
const EVENT = new RegExp(`^/event/${SLUG}$`);
// Object.hasOwn, never `in`: "constructor" and "toString" are in every object.
export const isAppLink = (href: string) => Object.hasOwn(AD_LINKS, href) || PAGE.test(href);
const appLink = Text(1, 100).refine(isAppLink, "Pick a screen in the app, or /event/… or /host/… with its link");

// An image staff uploaded (POST /galaxy/app-content/image): the API's own /media/content/<uploader>/<name>.webp. The
// API also checks it's this API's address; here only the shape. `edge` is its top row's colour, measured at upload,
// which fills the space above a carousel slide while it loads.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const IMAGE_LINK = new RegExp(`^https?://[^/?#\\s]+/media/content/${UUID}/[\\w-]{22}\\.webp$`);
const image = z.string().max(300).regex(IMAGE_LINK, "Upload the image again");
const edge = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// `starts` and `ends` (owner, 19 Nov 2026: "add start and end dates to ads", "with timing") are moments with their
// offset, as Galaxy writes them in India's time; none means from now, or until taken down. The app checks them against
// its own clock each time it draws.
const moment = z.iso.datetime({ offset: true });
const timing = { starts: moment.optional(), ends: moment.optional() };
type Timed = { starts?: string; ends?: string };
const endsAfter = (a: Timed) => !a.starts || !a.ends || Date.parse(a.ends) > Date.parse(a.starts);
const END = { message: "End it after it starts", path: ["ends"] };

// A strip: words, one line each in what fits a small phone (about 190pt), or an uploaded image that fills it. An image
// strip's `title` is what a screen reader says for it, and its kicker and line aren't shown.
export const Ad = z
  .object({
    kicker: Text(1, 20).optional(),
    title: Text(1, 24),
    line: Text(1, 32).optional(),
    image: image.optional(),
    colour: z.enum(Object.keys(AD_COLOURS) as [AdColour, ...AdColour[]]),
    href: appLink.optional(),
    places: z.array(z.enum(Object.keys(AD_PLACES) as [AdPlace, ...AdPlace[]])).min(1, "Show it somewhere").max(3),
    ...timing,
  })
  .refine((a) => !!a.image || (!!a.kicker && !!a.line), { message: "Add a kicker and a line, or an image", path: ["kicker"] })
  .refine(endsAfter, END);
export type Ad = z.infer<typeof Ad>;

// A carousel slide: a pick (an event's or host's page, drawn with its own 4:3 poster or banner), or Orbit's own image
// slide (an uploaded 4:3 image, what a screen reader says for it, an optional pill and where it opens).
export const SLIDE_KINDS = { pick: "Event or host", image: "Image slide" } as const;
export const Slide = z
  .object({
    kind: z.enum(["pick", "image"]),
    href: Text(1, 100).optional(),
    image: image.optional(),
    edge: edge.optional(),
    label: Text(1, 80).optional(),
    action: Text(1, 16).optional(),
    ...timing,
  })
  .refine((s) => (s.kind === "pick" ? !!s.href && PAGE.test(s.href) : true), { message: "Give an event’s or host’s link: /event/… or /host/…", path: ["href"] })
  .refine((s) => (s.kind === "image" ? !!s.image && !!s.edge && !!s.label : true), { message: "Upload a 4:3 image and say what it shows", path: ["image"] })
  .refine((s) => s.kind === "pick" || !s.href || isAppLink(s.href), { message: "Pick a screen in the app, or /event/… or /host/… with its link", path: ["href"] })
  .refine(endsAfter, END);
export type Slide = z.infer<typeof Slide>;

// An event marked Promoted, by its link.
export const Promotion = z
  .object({ href: Text(1, 100).regex(EVENT, "Give an event’s link: /event/…"), ...timing })
  .refine(endsAfter, END);
export type Promotion = z.infer<typeof Promotion>;

/** Showing at `now`: started, or no start, and not yet ended. */
export const liveAt = (a: Timed, now: number) => (!a.starts || Date.parse(a.starts) <= now) && (!a.ends || now < Date.parse(a.ends));

/** The next moment after `now` anything starts or ends, when a screen must redraw; Infinity if none. */
export const nextChange = (items: readonly Timed[], now: number) =>
  Math.min(...items.flatMap((a) => [a.starts, a.ends]).map((t) => (t ? Date.parse(t) : Infinity)).filter((t) => t > now));

export const HelpAnswer = z.object({ q: Text(1, 80), a: Text(1, 400) });
export type HelpAnswer = z.infer<typeof HelpAnswer>;

// A category offered on the Interests picker: one of the fixed ten (contract/src/categories.ts).
const Offered = z.enum(categories.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]], "Pick one of Orbit’s categories");

// The app keys rows by their words or links, so two can't be the same.
const unique = (words: string[]) => new Set(words.map((w) => w.toLowerCase())).size === words.length;
const ITEMS = { ads: Ad, help: HelpAnswer, asks: Text(1, 40), featured: Slide, promoted: Promotion, interests: Offered };
const MAX = { ads: 10, help: 20, asks: 6, featured: 6, promoted: 10, interests: categories.length };
export const CONTENT = {
  ads: z.array(ITEMS.ads).max(MAX.ads),
  help: z.array(ITEMS.help).max(MAX.help).refine((a) => unique(a.map((h) => h.q)), "Two questions are the same"),
  asks: z.array(ITEMS.asks).max(MAX.asks).refine(unique, "Two chips are the same"),
  featured: z.array(ITEMS.featured).max(MAX.featured),
  promoted: z.array(ITEMS.promoted).max(MAX.promoted).refine((a) => unique(a.map((p) => p.href)), "That event is in the list twice"),
  interests: z.array(ITEMS.interests).min(1, "Show at least one category").max(MAX.interests).refine(unique, "A category is in the list twice"),
};
export type ContentKey = keyof typeof CONTENT;
export const CONTENT_KEYS = Object.keys(CONTENT) as ContentKey[];
export const isContentKey = (k: string): k is ContentKey => Object.hasOwn(CONTENT, k);
// What one item of each list is called, for the API's messages ("Ad 2: …").
export const ITEM_NAMES: Record<ContentKey, string> = { ads: "Ad", help: "Question", asks: "Chip", featured: "Slide", promoted: "Event", interests: "Category" };

export const AppContent = z.object(CONTENT);
export type AppContent = z.infer<typeof AppContent>;

// What the app showed before the CMS (app/src/mock.ts, account/help.tsx, orbitSays.tsx on 19 Nov 2026): the two mock
// events marked promoted, and the carousel's own picks.
export const DEFAULT_CONTENT: AppContent = {
  ads: [
    // Its own words say "till 30 Nov", so it ends then.
    { kicker: "Card offer", title: "10% off with cards", line: "Up to ₹150, till 30 Nov", colour: "forest", href: "/account/payment", places: ["home", "account"], ends: "2026-12-01T00:00:00+05:30" },
    { kicker: "Play", title: "First slot ₹200 off", line: "Any turf, court or café", colour: "moss", href: "/search", places: ["home", "search"] },
  ],
  help: [
    { q: "Where’s my ticket?", a: "In Account › Tickets, and in the email and WhatsApp message from when you booked. It works offline at the door." },
    { q: "How do refunds work?", a: "Ask from the ticket. The host decides until their cut-off, then Orbit does. Banks take 5 to 7 working days once it’s sent." },
    { q: "I have a new phone number", a: "Change it in Sign-in and security with a code sent to the new number. Lost the old SIM? Sign in another way first." },
    { q: "Deleting my account", a: "Account › Delete account. Every device signs out, and you have 30 days to change your mind." },
  ],
  asks: ["Comedy this weekend", "Turf slots tonight", "Free events near me", "Hackathons this month"],
  featured: [],
  promoted: [{ href: "/event/build-anything-hackathon" }, { href: "/event/reel-society-screening" }],
  interests: categories.map((c) => c.slug),
};

/**
 * Each list read on its own: one that's missing, or isn't a list, is the default. Inside a list, items this build can't
 * read (a link, colour or place added since) are left out one by one, and a list longer than this build allows keeps
 * its first items, so an older app shows what staff published, never the made-up defaults.
 */
export function readContent(raw: unknown): AppContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const read = <K extends ContentKey>(k: K): AppContent[K] => {
    const list = o[k];
    if (!Array.isArray(list)) return DEFAULT_CONTENT[k];
    const r = CONTENT[k].safeParse(list.filter((i) => ITEMS[k].safeParse(i).success).slice(0, MAX[k]));
    return r.success ? (r.data as AppContent[K]) : DEFAULT_CONTENT[k];
  };
  return { ads: read("ads"), help: read("help"), asks: read("asks"), featured: read("featured"), promoted: read("promoted"), interests: read("interests") };
}

/** The ads a screen shows at `now`, in order: Home two, Search and Account one. */
export const adsFor = (ads: readonly Ad[], place: AdPlace, now: number) =>
  ads.filter((a) => a.places.includes(place) && liveAt(a, now)).slice(0, place === "home" ? 2 : 1);

/** The ids of the events marked Promoted at `now`. */
export const promotedAt = (promoted: readonly Promotion[], now: number) =>
  new Set(promoted.filter((p) => liveAt(p, now)).map((p) => p.href.slice("/event/".length)));

/** Every moment anything in the lists starts or ends, for nextChange. */
export const timed = (c: AppContent): Timed[] => [...c.ads, ...c.featured, ...c.promoted];

// POST /galaxy/app-content/image?shape=strip|wide (multipart, field `image`): a JPG, PNG or WebP up to 5 MB, in the
// shape it's for (contract/src/media.ts): an ad strip 4.5:1, a carousel slide 4:3. Answers its link and top-edge colour.
export const CONTENT_SHAPES = { strip: "4.5:1, as 1350 × 300", wide: "4:3, as 1200 × 900" } as const;
export type ContentShape = keyof typeof CONTENT_SHAPES;
export type ContentImage = { url: string; edge: string };

// PUT /galaxy/app-content/:key: the whole list, and when the page read it (`at`, null if never saved). A save over a
// change made since is refused, so two staff can't silently undo each other.
export const SaveContent = z.object({ value: z.unknown(), at: z.iso.datetime({ offset: true }).nullable() });
// GET /galaxy/app-content: what's live, with when and by whom each list was last saved.
export type ContentAdmin = { content: AppContent; saved: Record<ContentKey, { at: string; by: string | null } | null> };
