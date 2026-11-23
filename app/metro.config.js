// Expo's own Metro config, with Sentry's debug IDs in the bundle, so release stack traces map back to the source. Release
// builds upload the maps to Sentry (heyorbit/orbit-app) with SENTRY_AUTH_TOKEN: app/.env.sentry-build-plugin on a Mac,
// an EAS secret on EAS. Debug builds skip the upload.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
