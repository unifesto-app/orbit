// Plain TS (no React Native) so app.config.ts and the screen can both import it.
export const variants = {
  launch: { name: 'Orbit Launch', word: 'launch', id: 'in.heyorbit.launch', scheme: 'orbitlaunch', line: 'Events for organisers, fests and performers' },
  station: { name: 'Orbit Station', word: 'station', id: 'in.heyorbit.station', scheme: 'orbitstation', line: 'Venues: turfs, courts and gaming cafés' },
  crew: { name: 'Orbit Crew', word: 'crew', id: 'in.heyorbit.crew', scheme: 'orbitcrew', line: 'Door and day staff for an event' },
} as const;

export type Variant = keyof typeof variants;
