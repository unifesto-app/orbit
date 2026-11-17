// Passkeys, Apple and Google on this phone, each giving the proof the API checks (api/src/auth/ways.ts), and the
// "Confirm it's you" sheet that every change in Sign-in and security waits on (src/app/account/verify.tsx).
// The three native modules load lazily, like expo-secure-store in session.ts: a build made before they were added
// still runs, and asking for one says to update the app instead.
// - Passkeys: react-native-passkey, for heyorbit.in (associated domain webcredentials:heyorbit.in in app.json; the
//   site serves apple-app-site-association and assetlinks.json, deploy/Caddyfile).
// - Apple: expo-apple-authentication's native sheet, iOS only (User doc: no Apple on Android), with a nonce from the API.
// - Google: the API's own Google page in the system's sign-in browser (expo-web-browser). It comes back through
//   heyorbit://google with a grant only the secret the API gave this phone can redeem.
import type { ApiError, Security } from '@orbit/contract';
import { requireOptionalNativeModule } from 'expo';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Alert, NativeModules, Platform } from 'react-native';

import { api } from './session';

// Each is used only when its native half is in this build: the JS of all three loads anyway (the passkey module's
// stands in a proxy that throws on use, Apple's a stand-in that says it isn't available), so the check is native.
/* eslint-disable @typescript-eslint/no-require-imports -- optional: a static import throws on a build without them */
const load = <T>(native: boolean, get: () => T): T | null => {
  if (!native) return null;
  try {
    return get();
  } catch {
    return null;
  }
};
const passkeyModule = load(!!NativeModules.Passkey, () => require('react-native-passkey') as typeof import('react-native-passkey'));
const appleModule = load(Platform.OS === 'ios' && !!requireOptionalNativeModule('ExpoAppleAuthentication'), () => require('expo-apple-authentication') as typeof import('expo-apple-authentication'));
const browserModule = load(!!requireOptionalNativeModule('ExpoWebBrowser'), () => require('expo-web-browser') as typeof import('expo-web-browser'));
/* eslint-enable @typescript-eslint/no-require-imports */

// A proof, or why not: null when the person closed the sheet, which says nothing.
export type Got<T> = { ok: true; proof: T } | { ok: false; error: ApiError | null };
const UPDATE: ApiError = { error: 'update', message: 'Update Orbit from the App Store or Play Store to use this.' };
const no = (error: ApiError | null): Got<never> => ({ ok: false, error });
const said = (message: string): ApiError => ({ error: 'failed', message });

// Passkeys here: 'ready', 'update' (this build hasn't got them) or 'no' (the phone can't: Android before 9).
export function passkeysHere(): 'ready' | 'update' | 'no' {
  if (!passkeyModule) return 'update';
  try {
    return passkeyModule.Passkey.isSupported() ? 'ready' : 'no';
  } catch {
    return 'update';
  }
}
// Continue with Apple shows on iPhones only; a build without it still shows it and says to update.
export const appleHere = Platform.OS === 'ios';

// The phone's passkey sheet. `make`: a new passkey from the API's creation options; otherwise one to sign in with.
const notHere = () => no(passkeysHere() === 'update' ? UPDATE : said('This phone can’t use passkeys.'));
async function passkey(options: unknown, make: boolean): Promise<Got<Record<string, unknown>>> {
  if (passkeysHere() !== 'ready') return notHere();
  try {
    const P = passkeyModule!.Passkey;
    const r = make ? await P.create(options as never) : await P.get(options as never);
    return { ok: true, proof: { clientExtensionResults: {}, ...r } as Record<string, unknown> };
  } catch (e) {
    const code = (e as { error?: string }).error;
    if (code === 'UserCancelled' || code === 'Interrupted') return no(null);
    if (code === 'NoCredentials') return no(said('There’s no Orbit passkey on this phone. Use your phone number or email.'));
    if (code === 'CredentialAlreadyExists') return no(said('This phone already has a passkey for your account.'));
    return no(said('The passkey didn’t work. Try again.'));
  }
}

// Signing in, or the fresh check: the API's challenge, then the phone's sheet.
export async function passkeyAnswer(): Promise<Got<{ challenge: string; credential: Record<string, unknown> }>> {
  if (passkeysHere() !== 'ready') return notHere();
  const o = await api.call<{ challenge: string; options: unknown }>('POST', '/auth/passkey/options');
  if (!o.ok) return no(o.error);
  const r = await passkey(o.data.options, false);
  return r.ok ? { ok: true, proof: { challenge: o.data.challenge, credential: r.proof } } : r;
}

// Add a passkey, signed in and fresh: the API's options, the phone's sheet, then the API keeps it.
export async function addPasskey(): Promise<Got<null>> {
  if (passkeysHere() !== 'ready') return notHere();
  const o = await api.authed<{ challenge: string; options: unknown }>('POST', '/me/passkeys/options');
  if (!o.ok) return no(o.error);
  const r = await passkey(o.data.options, true);
  if (!r.ok) return r;
  const saved = await api.authed('POST', '/me/passkeys', { challenge: o.data.challenge, credential: r.proof });
  return saved.ok ? { ok: true, proof: null } : no(saved.error);
}

// Apple's sheet, with the API's nonce. Apple gives the name the first time only, so it rides along for About you.
export async function appleProof(): Promise<Got<{ idToken: string; nonce: string; code?: string; name?: string }>> {
  if (!appleModule) return no(UPDATE);
  const n = await api.call<{ nonce: string }>('POST', '/auth/nonce');
  if (!n.ok) return no(n.error);
  try {
    const A = appleModule;
    const r = await A.signInAsync({ requestedScopes: [A.AppleAuthenticationScope.FULL_NAME, A.AppleAuthenticationScope.EMAIL], nonce: n.data.nonce });
    if (!r.identityToken) return no(said('Apple didn’t finish. Try again.'));
    const name = [r.fullName?.givenName, r.fullName?.familyName].filter(Boolean).join(' ');
    return { ok: true, proof: { idToken: r.identityToken, nonce: n.data.nonce, ...(r.authorizationCode && { code: r.authorizationCode }), ...(name && { name }) } };
  } catch (e) {
    return (e as { code?: string }).code === 'ERR_REQUEST_CANCELED' ? no(null) : no(said('Apple didn’t finish. Try again.'));
  }
}

// Google: the API's page in the system browser, then back with a grant.
const GOOGLE_SAYS: Record<string, string> = {
  unverified: 'Google hasn’t verified that account’s email. Use another account, or your phone number.',
  notSetUp: 'Google sign-in isn’t set up yet. Use your phone number or email.',
};
// What came back from Google's page. On Android the link also reaches the router (src/app/google.tsx), and the
// browser can report "closed" before it does, so the route hands it here too.
type Back = { grant?: unknown; error?: unknown };
let returned: Back | null = null;
let waiting: ((b: Back) => void) | undefined;
export function googleReturned(b: Back) {
  if (waiting) waiting(b);
  else returned = b;
}
const later = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

export async function googleProof(): Promise<Got<{ grant: string; verifier: string }>> {
  if (!browserModule) return no(UPDATE);
  const s = await api.call<{ url: string; verifier: string }>('POST', '/auth/google/start');
  if (!s.ok) return no(s.error);
  returned = null;
  try {
    const r = await browserModule.openAuthSessionAsync(s.data.url, 'heyorbit://google');
    let q: Back | null = r.type === 'success' ? (Linking.parse(r.url).queryParams ?? {}) : returned;
    if (!q && Platform.OS === 'android')
      q = await Promise.race([new Promise<Back>((resolve) => (waiting = resolve)), later(1500)]); // the link may still be on its way
    waiting = undefined;
    returned = null;
    if (!q) return no(null);
    if (typeof q.grant === 'string') return { ok: true, proof: { grant: q.grant, verifier: s.data.verifier } };
    if (q.error === 'cancelled') return no(null);
    return no(said(GOOGLE_SAYS[String(q.error)] ?? 'Google didn’t finish. Try again.'));
  } catch {
    waiting = undefined;
    return no(said('Google didn’t finish. Try again.'));
  }
}

// "Confirm it's you": every change waits on a fresh check (User doc: a code, Google, Apple or a passkey in the last 10
// minutes). Already fresh goes straight on; otherwise the sheet opens over the screen and this answers once it closes,
// true if they confirmed. An offline read says so and answers false.
let confirmed: ((ok: boolean) => void) | undefined;
export async function ensureFresh(): Promise<boolean> {
  const r = await api.authed<Security>('GET', '/me/security');
  if (!r.ok) {
    Alert.alert(r.error.message);
    return false;
  }
  if (r.data.fresh) return true;
  confirmed?.(false); // one sheet at a time
  return new Promise((resolve) => {
    confirmed = resolve;
    router.push('/account/verify');
  });
}
// The sheet closing: confirmed or not. Once only. Confirmed answers once the sheet has slid away, as what comes next
// is often another sheet (a passkey, Apple, Google) or an alert, which iOS won't show over one still leaving.
// ponytail: a fixed 400 ms for iOS's modal slide; a dismiss callback, if expo-router gets one, would be exact.
export function freshDone(ok: boolean) {
  const answer = confirmed;
  confirmed = undefined;
  if (ok) setTimeout(() => answer?.(true), 400);
  else answer?.(false);
}
