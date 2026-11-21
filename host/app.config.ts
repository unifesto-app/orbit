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
  name: v.name,
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
  },
  android: { package: v.id },
  plugins: ['expo-router', 'expo-font'],
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
