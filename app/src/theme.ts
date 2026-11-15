// Orbit brand tokens, from the approved Theme and Typography boards
// (docs/context/artifacts/orbit-logo-concepts). Accent is #295EFF, rgb(41, 94, 255) (owner, 15 Nov 2026;
// was #375DF6, and #2953A4 on the Theme board).
// Accent goes on elements only (dots, progress, switches, selection), never on text or buttons.
// Buttons are frosted glass with a white label (Glass in src/glass.tsx; owner, 15 Nov 2026).
export const color = {
  ground: '#121215',
  card: '#1C1C1E',
  raised: '#2C2C30',
  text: '#FFFFFF',
  secondary: 'rgba(255, 255, 255, 0.64)',
  accent: '#295EFF',
} as const;

// One corner for everything (owner, 15 Nov 2026: "reduce the round of corners in entire app", "use same roundness
// across all. use the all events poster one", "make the poster 8px", then 6 with 8px padding, picked in the corners
// demo): 6px on cards' contents, buttons, pills, tags, posters, logos, photos and the carousel's pill. The three names
// stay so a part can be tuned apart again later. Only the tiny dots stay round.
const CORNER = 6;
export const radius = { sm: CORNER, md: CORNER, lg: CORNER } as const;

// Nested corners (owner, 15 Nov 2026): across cards and containers, inner radius = outer radius - padding, so the edges
// of nested shapes stay parallel. Work outward from the innermost corner: a container's radius is its content's radius
// plus the padding between them.
export const around = (inner: number, padding: number) => inner + padding;

// Two gaps (owner, 15 Nov 2026: "consistent small gaps and big gaps"): small inside a card or container (its padding
// and between its parts), big between cards, rows and sections. Line spacing inside a block of text is type, not a gap.
// Small is 8, the card padding the owner picked in the corners demo ("poster 6 + padding 8 = card face 14 + rim 2 =
// rim corner 16").
export const space = { small: 8, big: 24 } as const;

// The thin frosted glass rim on cards and along the carousel's bottom (owner, 15 Nov 2026: "need thin border").
export const rim = 2;

// Plus Jakarta Sans for headlines, titles and buttons; DM Sans for text, meta and prices.
// Names are the keys loaded in src/app/_layout.tsx. Don't add fontWeight next to them.
export const font = {
  headline: 'PlusJakartaSans_700Bold',
  title: 'PlusJakartaSans_600SemiBold',
  text: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  price: 'DMSans_600SemiBold',
} as const;
