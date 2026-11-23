// Plain TS (no React Native) so app.config.ts and the screen can both import it.
// Renamed 23 Nov 2026 (owner): Launch → Event Partner, Station → Play Partner. The keys, words, ids and schemes keep the
// old codenames on purpose: the App IDs carry App Attest, the API's proof list (api/src/auth/proof.ts) and Galaxy's
// client counts use them, and nobody sees them. `label` is the home-screen name (the full name gets cut off there).
export const variants = {
  launch: { name: 'Orbit Event Partner', label: 'Event Partner', word: 'launch', id: 'in.heyorbit.launch', scheme: 'orbitlaunch', line: 'Events for organisers, fests and performers' },
  station: { name: 'Orbit Play Partner', label: 'Play Partner', word: 'station', id: 'in.heyorbit.station', scheme: 'orbitstation', line: 'Venues: turfs, courts and gaming cafés' },
  crew: { name: 'Orbit Crew', label: 'Orbit Crew', word: 'crew', id: 'in.heyorbit.crew', scheme: 'orbitcrew', line: 'Door and day staff for an event' },
} as const;

export type Variant = keyof typeof variants;
