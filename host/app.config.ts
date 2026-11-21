import type { ExpoConfig } from 'expo/config';
import { variants } from './variants.ts';

const key = process.env.APP_VARIANT;
if (!key || !(key in variants)) {
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

export default config;
