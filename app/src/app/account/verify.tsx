// Confirm it's you (User doc, Sign-in and security): every change to the ways in, and deleting the account, needs a
// fresh check: a code to the account's own phone or email, its Google or Apple, or one of its passkeys, in the last 10
// minutes. Opened by ensureFresh (src/ways.ts) over the change that asked, which goes on once this closes confirmed.
// Changing the number or email itself is Edit profile's screen (src/app/account/contact.tsx).
// Glass like the sign-in sheet, whose pieces it shares (src/sheet.tsx); the API's messages show as they come.
import type { Security } from '@orbit/contract';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Code, Pill } from '../../account/kit';
import { maskEmail, maskPhone } from '../../account/rules';
import type { Result } from '../../api';
import { Icon } from '../../icons';
import { useLoad } from '../../load';
import { api, useMe } from '../../session';
import { Frame, GoogleMark, styles, With } from '../../sheet';
import { type Contact, sentTo, toOf } from '../../signin';
import { color } from '../../theme';
import { appleHere, appleProof, freshDone, type Got, googleProof, passkeyAnswer, passkeysHere } from '../../ways';

type Step = { at: 'ways' } | { at: 'code'; to: Contact; wait: number };

export default function Verify() {
  const me = useMe();
  const { data: sec, error: unread, reload } = useLoad(`confirm|${me.id}`, () => api.authed<Security>('GET', '/me/security'));
  const [step, go] = useState<Step>({ at: 'ways' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // read at once: a code filled in twice is sent once
  const confirmed = useRef(false);
  const left = useRef(false);

  // However it closes (X, a swipe, back, or confirmed), whoever was waiting hears whether it was confirmed, and an
  // answer landing after that leaves the screen underneath alone.
  useEffect(
    () => () => {
      left.current = true;
      freshDone(confirmed.current);
    },
    [],
  );

  const setStep = (next: Step) => {
    setError(null);
    go(next);
  };
  const done = () => {
    confirmed.current = true;
    if (left.current) return;
    left.current = true;
    router.back();
  };

  // One request at a time; false when the API said no (its message shows), null when one was already under way.
  async function run<T>(request: () => Promise<Result<T>>, then: (data: T) => void): Promise<boolean | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await request();
    working.current = false;
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return false;
    }
    then(r.data);
    return true;
  }
  // A code to the account's own phone or email; one sent there under 30 seconds ago still works, so go to it.
  const send = (to: Contact) =>
    run(
      async () => {
        const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
        return !r.ok && r.error.error === 'tooSoon' ? { ok: true as const, data: { retryIn: r.error.retryIn ?? 30 } } : r;
      },
      (r) => setStep({ at: 'code', to, wait: r.retryIn }),
    );
  const resend = async (to: Contact) => {
    if (working.current) return null;
    working.current = true;
    const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
    working.current = false;
    if (!r.ok) setError(r.error.message);
    return r.ok ? r.data.retryIn : (r.error.retryIn ?? null);
  };
  // Google, Apple or a passkey: its sheet first, then the API checks it's this account's.
  // Locked while its sheet is up, so a second tap doesn't open another.
  const prove = async <P extends object>(get: () => Promise<Got<P>>, via: 'google' | 'apple' | 'passkey') => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const g = await get();
    working.current = false;
    setBusy(false);
    if (!g.ok) return g.error && setError(g.error.message);
    void run(() => api.authed('POST', '/me/fresh', { via, ...g.proof }), done);
  };

  const phone: Contact | null = sec?.phone ? { kind: 'phone', e164: sec.phone } : null;
  const email: Contact | null = sec?.email ? { kind: 'email', email: sec.email } : null;
  return (
    <Frame title={step.at === 'code' ? 'Enter the code' : 'Confirm it’s you'} note={step.at === 'code' ? sentTo(step.to) : undefined} error={error ?? (sec ? null : (unread?.message ?? null))}>
      {!sec && unread && (
        <View style={styles.body}>
          <Pill label="Try again" size="wide" onPress={reload} />
        </View>
      )}
      {step.at === 'ways' && sec && (
        <View style={styles.body}>
          {phone && <Pill label={`Code to ${maskPhone(sec.phone!)}`} size="wide" disabled={busy} onPress={() => void send(phone)} />}
          {email && <Pill label={`Code to ${maskEmail(sec.email!)}`} size="wide" disabled={busy} onPress={() => void send(email)} />}
          {sec.passkeys.length > 0 && passkeysHere() !== 'no' && <Pill label="Use a passkey" size="wide" disabled={busy} onPress={() => void prove(passkeyAnswer, 'passkey')} />}
          {(sec.google || (sec.apple && appleHere)) && (
            <View style={styles.pair}>
              {sec.google && <With label="Google" mark={<GoogleMark />} disabled={busy} onPress={() => void prove(googleProof, 'google')} />}
              {sec.apple && appleHere && <With label="Apple" mark={<Icon name="apple" size={20} color={color.text} />} disabled={busy} onPress={() => void prove(appleProof, 'apple')} />}
            </View>
          )}
        </View>
      )}
      {step.at === 'code' && (
        <View style={styles.body}>
          <Code
            key={toOf(step.to)}
            to={step.to}
            wait={step.wait}
            onCode={(code) => run(() => api.authed('POST', '/me/fresh', { via: step.to.kind, code }), done)}
            onResend={() => resend(step.to)}
          />
          <View style={styles.pair}>
            <Pill label="Another way" size="small" muted onPress={() => setStep({ at: 'ways' })} />
          </View>
        </View>
      )}
    </Frame>
  );
}
