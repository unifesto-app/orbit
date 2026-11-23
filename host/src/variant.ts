import * as Application from 'expo-application';

import { variants } from '../variants';

// The native bundle id picks the app, never Constants.expoConfig: one Metro serves all three apps' JS, and once a dev
// client is added the config comes from Metro, so it would be whichever variant Metro started with.
export const variant = Object.values(variants).find((x) => x.id === Application.applicationId);
export const isStation = variant?.id === variants.station.id;
export const isLaunch = variant?.id === variants.launch.id;
// Only Orbit Event Partner (launch) signs in so far, so its screens fall back to its names.
export const thisApp = variant ?? variants.launch;
