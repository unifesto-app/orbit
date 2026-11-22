// A real host's monogram until logos upload (moved from the Orbit app's src/hosts.ts on 22 Nov 2026, shared with the
// host apps): its initials on one of the mock hosts' colours, picked from its id so it keeps the same one everywhere.
const PALETTE: readonly [string, string][] = [
  ['#F2C14E', '#141414'],
  ['#166534', '#FFFFFF'],
  ['#B5532E', '#FFFFFF'],
  ['#FF3D7F', '#FFFFFF'],
  ['#C6F432', '#0A0F1F'],
  ['#12002B', '#22D3EE'],
  ['#7598FF', '#0A0F1F'],
  ['#099268', '#FFFFFF'],
];
export function markOf(h: { id: string; name: string }) {
  const words = h.name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const initials = words.slice(0, 2).map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, '')][0]!.toUpperCase()).join('') || '?';
  let n = 0;
  for (const ch of h.id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[n % PALETTE.length]!;
  return { initials, bg, fg };
}
