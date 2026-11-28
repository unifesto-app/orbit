// That a code send comes from this Orbit app (User flow, Account security; api/src/auth/proof.ts): App Attest on
// iPhones, Play Integrity on Android, by @expo/app-integrity. The Orbit app's own (app/src/proof.ts), with its key id in
// this app's Keychain. Each proof signs a challenge from the API and what it's for (contract: proofOf), so it works once
// and only for that. A build without the module, a phone that can't, or a check that fails sends no proof, and the API
// decides (PROOF=enforce refuses it).
// - iPhone: the first proof attests a new key with Apple; later ones are assertions with it. A key the phone lost (a
//   reinstall keeps the Keychain but not App Attest's keys) fails its assertion here and is attested anew; one the API
//   forgot is refused as unproven and attested anew, once.
// - Android: the Google Cloud project linked to Play, Orbit's own, linked to each partner app in Play Console too; the
//   proof names this app's package, since Google opens a token only under the package that asked.
import { proofOf, type Proof } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { api, kept } from './session';
import { thisApp } from './variant';

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
const PROJECT = process.env.EXPO_PUBLIC_PLAY_PROJECT_NUMBER || '290599115534';
let preparing: Promise<void> | null = null;
const prepare = (m: NonNullable<typeof integrity>) =>
  (preparing ??= m.prepareIntegrityTokenProviderAsync(PROJECT).catch((e: unknown) => {
    preparing = null;
    throw e;
  }));
if (integrity && Platform.OS === 'android') prepare(integrity).catch(() => {});

async function prove(what: string, fresh: boolean): Promise<Proof | undefined> {
  const m = integrity;
  if (!m || (Platform.OS === 'ios' && !m.isSupported)) return undefined;
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
      const first = await token().catch(() => null); // a provider that has expired: make a new one and try once more
      // Which app asked: Google opens the token only under that package (api/src/auth/proof.ts).
      if (first) return { kind: 'android', challenge, token: first, app: thisApp.id };
      preparing = null;
      return { kind: 'android', challenge, token: await token(), app: thisApp.id };
    }
    const held = fresh ? null : kept.get(KEY);
    if (held) {
      try {
        return { kind: 'ios', challenge, keyId: held, assertion: await m.generateAssertionAsync(held, signed) };
      } catch {
        // the phone lost the key: attest a new one
      }
    }
    const keyId = await m.generateKeyAsync();
    const attestation = await m.attestKeyAsync(keyId, signed);
    kept.set(KEY, keyId);
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

// A sign-in code to `to` (the number or the address); `retryIn` seconds until another may be sent.
export const requestCode = (to: string) => proved<{ retryIn: number }>('/auth/code', proofOf.code, { to });
