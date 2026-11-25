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
