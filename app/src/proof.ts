// That a code send or Google's start comes from Orbit itself (User flow, Account security; api/src/auth/proof.ts):
// App Attest on iPhones, Play Integrity on Android, by @expo/app-integrity. Each proof signs a challenge from the API
// and what it's for (contract: proofOf), so it works once and only for that.
// A build made before the module, a phone that can't (no App Attest, no Google Play services), or a check that fails
// sends no proof, and the API decides: it lets the request through until PROOF=enforce, then says to update the app.
// - iPhone: the first proof attests a new key with Apple; later ones are assertions with it. Its id is kept in kv-store,
//   which a reinstall clears along with the key itself.
// - Android: the number of the Google Cloud project linked to Play, in PROJECT (it isn't secret; like API_URL, an
//   EXPO_PUBLIC_ variable can stand in). Without it no proof goes, and the API refuses once enforcing. Play's token
//   provider is made at launch, and made again if it has expired.
import { proofOf, type Proof } from '@orbit/contract';
import { requireOptionalNativeModule } from 'expo';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import type { Result } from './api';
import { api } from './session';

let integrity: typeof import('@expo/app-integrity') | null = null;
if (requireOptionalNativeModule('ExpoAppIntegrity')) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: a static import throws on a build without it
    integrity = require('@expo/app-integrity');
  } catch {
    integrity = null;
  }
}
const KEY = 'orbit.attestKey';
const PROJECT = process.env.EXPO_PUBLIC_PLAY_PROJECT_NUMBER || ''; // the owner writes the number in once the project exists
let preparing: Promise<void> | null = null;
const prepare = (m: NonNullable<typeof integrity>) =>
  (preparing ??= m.prepareIntegrityTokenProviderAsync(PROJECT!).catch((e: unknown) => {
    preparing = null;
    throw e;
  }));
if (integrity && Platform.OS === 'android' && PROJECT) prepare(integrity).catch(() => {});

async function prove(what: string, fresh: boolean): Promise<Proof | undefined> {
  const m = integrity;
  if (!m || (Platform.OS === 'ios' ? !m.isSupported : !PROJECT)) return undefined;
  const c = await api.call<{ challenge: string }>('POST', '/auth/challenge');
  if (!c.ok) return undefined;
  const challenge = c.data.challenge;
  const signed = `${challenge}:${what}`;
  try {
    if (Platform.OS === 'android') {
      const token = async () => {
        await prepare(m);
        return m.requestIntegrityCheckAsync(signed);
      };
      // A provider that has expired fails the first try: make a new one and try once more.
      const first = await token().catch(() => null);
      if (first) return { kind: 'android', challenge, token: first };
      preparing = null;
      return { kind: 'android', challenge, token: await token() };
    }
    const kept = fresh ? null : Storage.getItemSync(KEY);
    if (kept) {
      try {
        return { kind: 'ios', challenge, keyId: kept, assertion: await m.generateAssertionAsync(kept, signed) };
      } catch {
        // the phone lost the key: attest a new one
      }
    }
    const keyId = await m.generateKeyAsync();
    const attestation = await m.attestKeyAsync(keyId, signed);
    Storage.setItemSync(KEY, keyId);
    return { kind: 'ios', challenge, keyId, attestation };
  } catch {
    return undefined; // Apple or Google didn't answer: the API decides
  }
}

// POST `path` with `body` and a proof. An iPhone key the API doesn't know (Redis forgot it) is attested anew, once.
async function proved<T>(path: string, what: string, body: Record<string, unknown> = {}): Promise<Result<T>> {
  const proof = await prove(what, false);
  const r = await api.call<T>('POST', path, { ...body, proof });
  if (r.ok || r.error.error !== 'unproven' || proof?.kind !== 'ios' || !proof.assertion) return r;
  return api.call<T>('POST', path, { ...body, proof: await prove(what, true) });
}

// A sign-in code to `to`.
export const requestCode = (to: string) => proved<{ retryIn: number }>('/auth/code', proofOf.code, { to });
export const startGoogle = () => proved<{ url: string; verifier: string }>('/auth/google/start', proofOf.google);
