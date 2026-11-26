import * as Application from 'expo-application';

import { variants } from '../variants';

// The native bundle id picks the app, never Constants.expoConfig: one Metro serves all three apps' JS, and once a dev
// client is added the config comes from Metro, so it would be whichever variant Metro started with.
export const variant = Object.values(variants).find((x) => x.id === Application.applicationId);
export const isStation = variant?.id === variants.station.id;
export const isLaunch = variant?.id === variants.launch.id;
export const isCrew = variant?.id === variants.crew.id;
// An unknown bundle id (none of the three) falls back to Orbit Event Partner's names.
export const thisApp = variant ?? variants.launch;
// Orbit Play Partner's Money tab: on hides it (Today and Venue only); off, as since X10, shows it to Admins, fed by
// GET /hosts/:id/money (X4). The one place that toggles it. The scanner and the walk-in's Pay now QR aren't in the app
// at all: they come back with their own APIs, not with this flag. A plain constant: flip it and ship a new build.
export const ONE_0 = false;
