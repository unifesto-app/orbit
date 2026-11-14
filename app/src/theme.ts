// Orbit brand tokens, from the approved Theme and Typography boards
// (docs/context/artifacts/orbit-logo-concepts). Accent changed to #375DF6 on 14 Nov 2026.
// Accent goes on elements only (dots, progress, switches, selection), never on text or buttons.
// Buttons are white with a dark label.
export const color = {
  ground: '#121215',
  card: '#1C1C1E',
  raised: '#2C2C30',
  text: '#FFFFFF',
  secondary: 'rgba(255, 255, 255, 0.64)',
  accent: '#375DF6',
} as const;

// Plus Jakarta Sans for headlines, titles and buttons; DM Sans for text, meta and prices.
// Names are the keys loaded in src/app/_layout.tsx. Don't add fontWeight next to them.
export const font = {
  headline: 'PlusJakartaSans_700Bold',
  title: 'PlusJakartaSans_600SemiBold',
  text: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  price: 'DMSans_600SemiBold',
} as const;
