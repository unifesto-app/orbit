// Orbit's brand and design tokens: the one place the web, the app, Galaxy and the brand kit take their look from.
// Values come from the brand guidelines canvas (https://claude.ai/artifact/R9S2HUVQ9q4PAHC9YPPBQ2) and the owner's
// calls of 15 to 18 Nov 2026. Change a value here, run `pnpm --filter @orbit/tokens build`, and every surface follows.

// The owner's rubber-plant palette (18 Nov 2026), plus Charcoal from the posters.
export const palette = {
  charcoal: '#121215', // every background (owner, 18 Nov 2026: "the bg should be always #121215 only")
  forest: '#1d372a', // fills and glass
  moss: '#515f46', // fills; never text (2.7:1 on Charcoal)
  sage: '#869381', // the accent, on elements only
  stone: '#dfdad7', // all text
  night: '#081b17', // shadows only, never a background
} as const;

// Functional colours, not brand: each means one thing.
export const functional = {
  love: '#ff453a', // a loved event's filled heart in the app (Loved it)
  galaxy: '#7598ff', // staff: Galaxy's glow and lock
} as const;

// What each colour is for. Surfaces read these, not the palette.
export const role = {
  ground: palette.charcoal, // page, panel, card, poster and sign backgrounds
  text: palette.stone,
  text2: alpha(palette.stone, 0.64), // secondary text
  hairline: alpha(palette.stone, 0.08), // dividers inside a panel
  border: alpha(palette.stone, 0.12), // a panel's outline: panels are Charcoal too, set apart by this line
  track: alpha(palette.stone, 0.12), // the empty part of a progress bar or switch
  accent: palette.sage, // progress, switches, selection, live dots; never a button, never body text
  onAccent: palette.charcoal, // a tick or label on a Sage fill (Stone on Sage is only 2.3:1)
  fill: palette.forest, // raised fills
  shadow: palette.night,
} as const;

// One corner (owner, 15 Nov 2026), and pills for every button, chip and search field: never squared buttons.
export const radius = { corner: 6, pill: 999 } as const;

// Two gaps (owner, 15 Nov 2026): small inside a card, big between cards, rows and sections. The thin rim on cards.
export const space = { small: 8, big: 24, rim: 2 } as const;

// Plus Jakarta Sans for display, headlines, titles and buttons; DM Sans for text, meta and prices; Sacramento for asides
// only (psst…, coming soon, see you soon, revealing on). Sofachrome is the logo's letters only; never type a word in it.
export const font = {
  display: 'Plus Jakarta Sans',
  text: 'DM Sans',
  script: 'Sacramento',
  weight: { display: 800, headline: 700, title: 600, medium: 500, text: 400, price: 600 },
  tracking: { display: '-0.045em' }, // display on posters and pages
} as const;

// The glass on every button and floating control: dark frost with a Stone label, never tinted with Sage.
export const glass = {
  background: `linear-gradient(180deg, ${alpha(palette.stone, 0.08)}, ${alpha(palette.stone, 0)} 45%), linear-gradient(180deg, ${alpha(palette.charcoal, 0.5)}, ${alpha(palette.charcoal, 0.72)})`,
  border: alpha(palette.stone, 0.22),
  highlight: `inset 0 1px 0 ${alpha(palette.stone, 0.22)}`,
  label: palette.stone,
} as const;

// The 3D look shared by the wordmark, the symbols (heart, star, spark, pearl) and one line of type per piece:
// a body shaded from the top-left, a raw gloss (never smoothed) and a soft Night shadow.
export const depth = {
  light: { azimuth: 225, elevation: 44 }, // top-left
  // The wordmark's lighter body, also used on the one 3D line of type.
  wordmark: [[0, palette.stone], [0.45, '#c3c7bd'], [0.8, palette.sage], [1, '#6b7863']],
  // The symbols' body.
  symbol: [[0, palette.stone], [0.3, palette.sage], [0.72, palette.moss], [1, palette.forest]],
  // On screen, for a wordmark 650 px wide (the 2027 launch posters): gloss blur, drop and shadow blur, in px.
  // Scale them with the wordmark. Under 48 px tall the wordmark goes flat.
  wordmarkFilter: { gloss: 5, drop: 8, blur: 7, minHeight: 48 },
  shadowOpacity: 0.75,
} as const;

/** `#rrggbb` at an opacity, as `rgba(r, g, b, a)`. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The three 0-255 channels of a `#rrggbb` colour. */
export function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = channels(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
