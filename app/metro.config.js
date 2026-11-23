// Expo's own Metro config, with Sentry's debug IDs in the bundle so release stack traces map back to the source once
// uploads are on (app.json's Sentry plugin, disableAutoUpload).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
