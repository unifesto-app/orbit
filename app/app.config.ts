import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'node:fs';
import path from 'node:path';

// app.json holds the config; this only adds Android's Firebase file (FCM push) once the owner has put it in app/.
// Expo's prebuild fails when android.googleServicesFile names a missing file, so it's set only when the file is there.
// The file is never committed (.gitignore).
const firebase = path.join(import.meta.dirname, 'google-services.json');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: { ...config.android, ...(fs.existsSync(firebase) && { googleServicesFile: './google-services.json' }) },
});
