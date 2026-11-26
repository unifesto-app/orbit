import type { ExpoConfig } from 'expo/config';
import { withDangerousMod } from 'expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';
import { variants } from './variants.ts';

// Without APP_VARIANT (Xcode's fingerprint step, expo-doctor, a bare `expo config`), the variant ios/ was prebuilt for.
const xcodeEnv = path.join(import.meta.dirname, 'ios/.xcode.env');
const key = process.env.APP_VARIANT || (fs.existsSync(xcodeEnv) ? /^export APP_VARIANT=(\w+)$/m.exec(fs.readFileSync(xcodeEnv, 'utf8'))?.[1] : undefined);
if (!key || !Object.hasOwn(variants, key)) {
  throw new Error(`APP_VARIANT must be one of ${Object.keys(variants).join(', ')} (got ${key ? `"${key}"` : 'nothing'})`);
}
const v = variants[key as keyof typeof variants];
// Android's Firebase file (FCM push), once the owner has put it in host/: one file holds all three apps, matched by
// package name. Prebuild fails when googleServicesFile names a missing file, so it's set only when the file is there.
// Never committed (.gitignore).
const firebase = path.join(import.meta.dirname, 'google-services.json');

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
    // App Attest, so a code send proves it comes from one of Orbit's host apps (api/src/auth/proof.ts); every one signs
    // in. Each App ID needs App Attest turned on in Apple's portal, or the build won't sign.
    // Push (src/push.tsx): production APNs, as every build ships from TestFlight or the App Store and the APNs key is
    // Production-only. Each App ID needs the Push Notifications capability too.
    entitlements: { 'com.apple.developer.devicecheck.appattest-environment': 'production', 'aps-environment': 'production' },
  },
  android: {
    package: v.id,
    ...(fs.existsSync(firebase) && { googleServicesFile: './google-services.json' }),
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
    ['expo-notifications', { color: '#869381', defaultChannel: 'default' }], // push (src/push.tsx); Sage, as the Orbit app's
    // The ticket scanner (host apps plan, decision 16). Camera only: no microphone on either platform. The full name, not
    // $(PRODUCT_NAME): that's the Xcode target's, squashed from the label ("PlayPartner").
    ['expo-camera', { cameraPermission: `${v.name} uses the camera to scan tickets.`, microphonePermission: false, recordAudioAndroid: false }],
    // Event posters and 4:3s in Event Partner's editor (src/app/edit.tsx): the photo library only, no camera or microphone.
    ['expo-image-picker', { photosPermission: `${v.name} uses your photos for event posters.`, cameraPermission: false, microphonePermission: false }],
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
