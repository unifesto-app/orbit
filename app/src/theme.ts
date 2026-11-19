import { alpha, channels, contrast, functional, palette, radius as corners, role, space as gaps } from '@orbit/tokens';

// The app's names for Orbit's brand tokens (@orbit/tokens, shared with the web and Galaxy). Since 18 Nov 2026 the app
// is on the green kit: Charcoal ground, Stone text, Sage accent (was #295EFF blue).
// Accent goes on elements only (dots, progress, switches, selection), never on text or buttons.
// Buttons are frosted glass with a Stone label (Glass in src/glass.tsx; owner, 15 Nov 2026).
export const color = {
  ground: role.ground,
  // Cards are Charcoal like the page, set apart by their glass rim or, where they have none, a 1px `border` (owner,
  // 19 Nov 2026: "switch cards", ending the iOS greys #1C1C1E and #2C2C30). Tags and placeholders while a poster or
  // photo loads stay grey (owner, same day: "keep tags and placeholders grey"): Stone at 12% over the Charcoal. Forest
  // (`fill`) is for your own: your profile circle and your messages in a support chat.
  card: role.ground,
  raised: alpha(palette.stone, 0.12),
  fill: role.fill,
  border: role.border, // a rimless card's outline
  text: role.text,
  secondary: role.text2,
  accent: role.accent,
  track: role.track, // the empty part of a progress bar or switch
  onAccent: role.onAccent, // a thumb or tick on a Sage fill: Stone on Sage is only 2.3:1
  // A loved event's heart, filled: "Loved it" (owner, 19 Nov 2026: "replace the love with loved it"; the red was a
  // saved heart's from 16 Nov, "for saved events add love red", until saves took a star). iOS's dark-mode red. An
  // element, like the accent, never text.
  love: functional.love,
} as const;

// Stone at an opacity, for tints, hairlines and pressed states (never pure white).
export const stoneAt = (a: number) => alpha(palette.stone, a);
// Charcoal at an opacity, for text set dark over a light poster.
export const groundAt = (a: number) => alpha(palette.charcoal, a);

// Whether text over `bg` reads better in Charcoal than in Stone (owner, 19 Nov 2026: "in home, the location text should
// adapt the bg and switch colors"; Home's header has its own dark glass since 19 Nov, and Orbit's ad strips use this).
// `wash` is the ground laid over it at that opacity. A colour that isn't #rrggbb keeps Stone.
export function darkInkOn(bg: string, wash = 0): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return false;
  const g = channels(role.ground);
  const under = `#${channels(bg)
    .map((c, i) => Math.round(c * (1 - wash) + g[i] * wash).toString(16).padStart(2, '0'))
    .join('')}`;
  return contrast(under, role.ground) > contrast(under, role.text);
}

// One corner for everything (owner, 15 Nov 2026: "reduce the round of corners in entire app", "use same roundness
// across all. use the all events poster one", "make the poster 8px", then 6 with 8px padding, picked in the corners
// demo): 6px on cards' contents, tags, posters, logos and photos. The three names stay so a part can be tuned
// apart again later. Never on a button: every button is a pill, its corner half its height, or a circle when it holds
// only an icon or an initial (owner, 15 Nov 2026: "never use squared buttons"). The search field is a pill too ("also
// squared search"). The tiny dots stay round.
const CORNER = corners.corner;
export const radius = { sm: CORNER, md: CORNER, lg: CORNER } as const;

// Nested corners (owner, 15 Nov 2026): across cards and containers, inner radius = outer radius - padding, so the edges
// of nested shapes stay parallel. Work outward from the innermost corner: a container's radius is its content's radius
// plus the padding between them.
export const around = (inner: number, padding: number) => inner + padding;

// Two gaps (owner, 15 Nov 2026: "consistent small gaps and big gaps"): small inside a card or container (its padding
// and between its parts), big between cards, rows and sections. Line spacing inside a block of text is type, not a gap.
// Small is 8, the card padding the owner picked in the corners demo ("poster 6 + padding 8 = card face 14 + rim 2 =
// rim corner 16").
export const space = { small: gaps.small, big: gaps.big } as const;

// The thin frosted glass rim on cards and along the carousel's bottom (owner, 15 Nov 2026: "need thin border").
export const rim = gaps.rim;

// Plus Jakarta Sans for headlines, titles and buttons; DM Sans for text, meta and prices.
// Names are the keys loaded in src/app/_layout.tsx. Don't add fontWeight next to them.
export const font = {
  headline: 'PlusJakartaSans_700Bold',
  title: 'PlusJakartaSans_600SemiBold',
  text: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  price: 'DMSans_600SemiBold',
  // A thin handwritten script for Search's Explore title (owner, 15 Nov 2026: "use Sacramento", after Handelson Three
  // turned out personal-use only). Google Fonts, OFL.
  script: 'Sacramento_400Regular',
} as const;
