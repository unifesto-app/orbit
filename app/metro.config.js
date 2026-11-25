// Expo's own Metro config, with Sentry's debug IDs in the bundle, so release stack traces map back to the source. Release
// builds upload the maps to Sentry (heyorbit/orbit-app) with SENTRY_AUTH_TOKEN: app/.env.sentry-build-plugin on a Mac,
// an EAS secret on EAS. Debug builds skip the upload.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

// Sentry's Expo Router helper tries expo-router/build/global-state/router-store, which expo-router 58 no longer has. The
// require is in a try, so it already comes back empty at runtime; resolving it to an empty module says so up front, and
// stops Metro warning about expo-router's package.json on every lookup. Everything else goes to Sentry's resolver.
// ponytail: drop this once @sentry/react-native reads expo-router 58's store.
const resolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, name, platform) =>
  name === 'expo-router/build/global-state/router-store'
    ? { type: 'empty' }
    : (resolve ?? context.resolveRequest)(context, name, platform);

module.exports = config;
