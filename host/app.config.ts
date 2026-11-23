import type { ExpoConfig } from 'expo/config';
import { withDangerousMod } from 'expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';
import { variants } from './variants.ts';

const key = process.env.APP_VARIANT;
if (!key || !Object.hasOwn(variants, key)) {
  throw new Error(`APP_VARIANT must be one of ${Object.keys(variants).join(', ')} (got ${key ? `"${key}"` : 'nothing'})`);
}
const v = variants[key as keyof typeof variants];

const config: ExpoConfig = {
  name: v.label, // the home-screen name; the stores' full name is set in App Store Connect and Play Console
  slug: 'orbit-host',
  version: '1.0.0',
  platforms: ['ios', 'android'],
  orientation: 'portrait',
  icon: `./assets/icons/${key}.png`, // drawn by scripts/app-icon.cjs
  userInterfaceStyle: 'dark',
  scheme: v.scheme,
  ios: {
    supportsTablet: false,
    bundleIdentifier: v.id,
    appleTeamId: '9AH3Z5C5DH',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    // App Attest, so a code send proves it comes from Orbit Launch (api/src/auth/proof.ts). Launch alone signs in so
    // far; Station and Crew get it with their sign-in, once their App IDs have the capability too. The App ID needs App
    // Attest turned on in Apple's portal, or the build won't sign.
    ...(key === 'launch' && { entitlements: { 'com.apple.developer.devicecheck.appattest-environment': 'production' } }),
  },
  android: {
    package: v.id,
    adaptiveIcon: {
      foregroundImage: `./assets/icons/${key}-android.png`,
      monochromeImage: `./assets/icons/${key}-android-mono.png`,
      backgroundColor: '#121215', // Charcoal
    },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store', // the sign-in's Keychain (src/session.ts); on Android, kept out of backups
    // The ticket scanner (host apps plan, decision 16). Camera only: no microphone on either platform.
    ['expo-camera', { cameraPermission: '$(PRODUCT_NAME) uses the camera to scan tickets.', microphonePermission: false, recordAudioAndroid: false }],
  ],
  owner: 'unifesto-app',
};

// Xcode's build phases re-read this config (expo-constants, the Release bundle) and source ios/.xcode.env first, so
// the prebuilt variant goes there: a Run or Archive from Xcode then builds that app without APP_VARIANT in its env.
// ponytail: iOS only; Gradle needs the same when Android builds start.
export default withDangerousMod(config, [
  'ios',
  (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
    const line = `export APP_VARIANT=${key}`;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('export APP_VARIANT='));
    fs.writeFileSync(file, `${lines.join('\n').trimEnd()}\n${line}\n`);
    return cfg;
  },
]);
