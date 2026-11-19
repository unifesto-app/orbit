import { z } from "zod";
import { Text } from "./text.ts";

// App content: the words in the app that Orbit itself writes, edited in Galaxy's App content page (owner, 19 Nov 2026:
// "build CMS for Orbit App in galaxy web"). Three lists, each saved whole:
//   ads   Orbit's own ad strips (app/src/orbitAd.tsx): Home shows the first two marked Home, Search and Account the
//         first marked for each. Not a host's paid Boost, so never labelled Promoted.
//   help  Account › Help and support's questions, each answer opening under it.
//   asks  What to ask Orbit: the chips on the chat's welcome and on Search.
// Hosts' events and pages are theirs, never here. GET /public/app-content serves all three; a list nobody has saved yet,
// or one saved under an older schema that no longer reads, falls back to DEFAULT_CONTENT, which is what the app showed
// before the CMS, so an empty table or an offline phone looks exactly as it did.

// A strip's fill, by name: Orbit's two fills (@orbit/tokens palette), each carrying Stone words. Sage is the accent and
// never a fill; Charcoal would vanish into the page.
export const AD_COLOURS = { forest: "Forest", moss: "Moss" } as const;
export type AdColour = keyof typeof AD_COLOURS;

export const AD_PLACES = { home: "Home", search: "Search", account: "Account" } as const;
export type AdPlace = keyof typeof AD_PLACES;

// Where an ad may open, as an app route. The app pushes it straight to the router, so only these: a screen below, or
// one event's or host's page by its link. Anything else (a web address, a path with a query) is refused.
export const AD_LINKS = {
  "/search": "Search",
  "/chat": "Ask Orbit",
  "/inbox": "Notifications",
  "/account/payment": "Payment methods",
  "/account/interests": "Interests",
  "/account/tickets": "Tickets",
  "/account/saved": "Saved",
} as const;
// Object.hasOwn, never `in`: "constructor" and "toString" are in every object.
export const isAppLink = (href: string) => Object.hasOwn(AD_LINKS, href) || /^\/(event|host)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(href);

// Lengths a strip fits on a small phone: about 190pt of words, one line each. `starts` and `ends` (owner, 19 Nov 2026:
// "add start and end dates to ads", "with timing") are moments with their offset, as Galaxy writes them in India's
// time; none means from now, or until taken down. The app checks them against its own clock each time it draws.
const moment = z.iso.datetime({ offset: true });
export const Ad = z
  .object({
    kicker: Text(1, 20),
    title: Text(1, 24),
    line: Text(1, 32),
    colour: z.enum(Object.keys(AD_COLOURS) as [AdColour, ...AdColour[]]),
    href: Text(1, 100).refine(isAppLink, "Pick a screen in the app, or /event/… or /host/… with its link").optional(),
    places: z.array(z.enum(Object.keys(AD_PLACES) as [AdPlace, ...AdPlace[]])).min(1, "Show it somewhere").max(3),
    starts: moment.optional(),
    ends: moment.optional(),
  })
  .refine((a) => !a.starts || !a.ends || Date.parse(a.ends) > Date.parse(a.starts), { message: "End it after it starts", path: ["ends"] });
export type Ad = z.infer<typeof Ad>;

/** Showing at `now`: started, or no start, and not yet ended. */
export const adLive = (a: Pick<Ad, "starts" | "ends">, now: number) => (!a.starts || Date.parse(a.starts) <= now) && (!a.ends || now < Date.parse(a.ends));

/** The next moment after `now` an ad starts or ends, when a screen must redraw; Infinity if none. */
export const nextChange = (ads: readonly Pick<Ad, "starts" | "ends">[], now: number) =>
  Math.min(...ads.flatMap((a) => [a.starts, a.ends]).map((t) => (t ? Date.parse(t) : Infinity)).filter((t) => t > now));

export const HelpAnswer = z.object({ q: Text(1, 80), a: Text(1, 400) });
export type HelpAnswer = z.infer<typeof HelpAnswer>;

// The app keys rows by their words, so two questions or chips can't be the same.
const unique = (words: string[]) => new Set(words.map((w) => w.toLowerCase())).size === words.length;
const ITEMS = { ads: Ad, help: HelpAnswer, asks: Text(1, 40) };
export const CONTENT = {
  ads: z.array(ITEMS.ads).max(10),
  help: z.array(ITEMS.help).max(20).refine((a) => unique(a.map((h) => h.q)), "Two questions are the same"),
  asks: z.array(ITEMS.asks).max(6).refine(unique, "Two chips are the same"),
};
export type ContentKey = keyof typeof CONTENT;
export const CONTENT_KEYS = Object.keys(CONTENT) as ContentKey[];
export const isContentKey = (k: string): k is ContentKey => Object.hasOwn(CONTENT, k);

export const AppContent = z.object(CONTENT);
export type AppContent = z.infer<typeof AppContent>;

// What the app showed before the CMS (app/src/mock.ts, account/help.tsx, orbitSays.tsx on 19 Nov 2026).
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
};

/**
 * Each list read on its own: one that's missing, or isn't a list, is the default. Inside a list, items this build can't
 * read (a link, colour or place added since) are left out one by one, so an older app keeps the rest.
 */
export function readContent(raw: unknown): AppContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const read = <K extends ContentKey>(k: K): AppContent[K] => {
    const list = o[k];
    if (!Array.isArray(list)) return DEFAULT_CONTENT[k];
    const r = CONTENT[k].safeParse(list.filter((i) => ITEMS[k].safeParse(i).success));
    return r.success ? (r.data as AppContent[K]) : DEFAULT_CONTENT[k];
  };
  return { ads: read("ads"), help: read("help"), asks: read("asks") };
}

/** The ads a screen shows at `now`, in order: Home two, Search and Account one. */
export const adsFor = (ads: readonly Ad[], place: AdPlace, now: number) =>
  ads.filter((a) => a.places.includes(place) && adLive(a, now)).slice(0, place === "home" ? 2 : 1);

// PUT /galaxy/app-content/:key: the whole list, and when the page read it (`at`, null if never saved). A save over a
// change made since is refused, so two staff can't silently undo each other.
export const SaveContent = z.object({ value: z.unknown(), at: z.iso.datetime({ offset: true }).nullable() });
// GET /galaxy/app-content: what's live, with when and by whom each list was last saved.
export type ContentAdmin = { content: AppContent; saved: Record<ContentKey, { at: string; by: string | null } | null> };
