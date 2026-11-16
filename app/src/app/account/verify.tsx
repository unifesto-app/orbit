// Confirm it's you, then Change number or Add/Change email (User doc, Sign-in and security). Every change to the ways
// in needs a fresh check: a code to the account's own phone or email, its Google or Apple, or one of its passkeys, in
// the last 10 minutes. Opened two ways:
// - by ensureFresh (src/ways.ts) over the change that asked, which goes on once this closes confirmed;
// - with ?change=phone|email: the check first if it's needed, then the new number or address and the code sent to it.
// Glass like the sign-in sheet, whose pieces it shares (src/sheet.tsx); the API's messages show as they come.
import type { Security } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Field, Pill } from '../../account/kit';
import { maskEmail, maskPhone } from '../../account/rules';
import type { Result } from '../../api';
import { Icon } from '../../icons';
import { api, refreshAccount } from '../../session';
import { Code, Frame, GoogleMark, Phone, sentTo, styles, With } from '../../sheet';
import { type Contact, readContact } from '../../signin';
import { color } from '../../theme';
import { appleHere, appleProof, freshDone, type Got, googleProof, passkeyAnswer, passkeysHere } from '../../ways';

type Step =
  | { at: 'loading' }
  | { at: 'ways' } // how to confirm
  | { at: 'code'; to: Contact; wait: number } // the code for the check
  | { at: 'new' } // the new number or email
  | { at: 'newCode'; to: Contact; wait: number }; // the code sent to it

const toOf = (c: Contact) => (c.kind === 'phone' ? c.e164 : c.email);

export default function Verify() {
  const { change } = useLocalSearchParams<{ change?: 'phone' | 'email' }>();
  const [sec, setSec] = useState<Security | null>(null);
  const [step, go] = useState<Step>({ at: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // read at once: a code filled in twice is sent once
  const confirmed = useRef(false);
  const left = useRef(false);

  // However it closes (X, a swipe, back, or done), whoever was waiting hears whether it was confirmed.
  useEffect(() => () => freshDone(confirmed.current), []);
  useEffect(() => {
    void (async () => {
      const r = await api.authed<Security>('GET', '/me/security');
      if (!r.ok) return setError(r.error.message);
      setSec(r.data);
      go(change && r.data.fresh ? { at: 'new' } : { at: 'ways' });
    })();
  }, [change]);

  const setStep = (next: Step) => {
    setError(null);
    go(next);
  };
  const leave = () => {
    if (left.current) return;
    left.current = true;
    router.back();
  };
  // Confirmed: on to the change, or back to what asked.
  const ready = () => {
    if (change) return setStep({ at: 'new' });
    confirmed.current = true;
    leave();
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
  // A code to `to`; a code sent there under 30 seconds ago still works, so go to it.
  const send = (to: Contact, next: (wait: number) => Step) =>
    run(
      async () => {
        const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
        return !r.ok && r.error.error === 'tooSoon' ? { ok: true as const, data: { retryIn: r.error.retryIn ?? 30 } } : r;
      },
      (r) => setStep(next(r.retryIn)),
    );
  const resend = async (to: Contact) => {
    const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
    if (!r.ok) setError(r.error.message);
    return r.ok ? r.data.retryIn : (r.error.retryIn ?? null);
  };
  // Google, Apple or a passkey: its sheet first, then the API checks it's this account's.
  const prove = async <P extends object>(get: () => Promise<Got<P>>, via: 'google' | 'apple' | 'passkey') => {
    if (working.current) return;
    setError(null);
    const g = await get();
    if (!g.ok) return g.error && setError(g.error.message);
    void run(() => api.authed('POST', '/me/fresh', { via, ...g.proof }), ready);
  };
  // The new number or email, proven by its code. The account on the phone is read again to show it.
  const save = (to: Contact, code: string) =>
    run(
      () => api.authed(`PUT`, `/me/${to.kind}`, { to: toOf(to), code }),
      () => {
        void refreshAccount();
        leave();
      },
    );

  const title = {
    loading: 'Confirm it’s you',
    ways: 'Confirm it’s you',
    code: 'Enter the code',
    new: change === 'phone' ? 'New WhatsApp number' : sec?.email ? 'New email' : 'Add an email',
    newCode: 'Enter the code',
  }[step.at];
  const note = step.at === 'code' || step.at === 'newCode' ? sentTo(step.to) : undefined;

  return (
    <Frame title={title} note={note} error={error}>
      {step.at === 'ways' && sec && (
        <View style={styles.body}>
          {sec.phone && (
            <Pill label={`Code to ${maskPhone(sec.phone)}`} size="wide" disabled={busy} onPress={() => void send({ kind: 'phone', e164: sec.phone! }, (wait) => ({ at: 'code', to: { kind: 'phone', e164: sec.phone! }, wait }))} />
          )}
          {sec.email && (
            <Pill label={`Code to ${maskEmail(sec.email)}`} size="wide" disabled={busy} onPress={() => void send({ kind: 'email', email: sec.email! }, (wait) => ({ at: 'code', to: { kind: 'email', email: sec.email! }, wait }))} />
          )}
          {sec.passkeys.length > 0 && passkeysHere() !== 'no' && <Pill label="Use a passkey" size="wide" disabled={busy} onPress={() => void prove(passkeyAnswer, 'passkey')} />}
          {(sec.google || (sec.apple && appleHere)) && (
            <View style={styles.pair}>
              {sec.google && <With label="Google" mark={<GoogleMark />} onPress={() => void prove(googleProof, 'google')} />}
              {sec.apple && appleHere && <With label="Apple" mark={<Icon name="apple" size={20} color={color.text} />} onPress={() => void prove(appleProof, 'apple')} />}
            </View>
          )}
        </View>
      )}
      {step.at === 'code' && (
        <Code
          key={toOf(step.to)}
          to={step.to}
          wait={step.wait}
          onCode={(code) => run(() => api.authed('POST', '/me/fresh', { via: step.to.kind, code }), ready)}
          onResend={() => resend(step.to)}
          onChange={() => setStep({ at: 'ways' })}
          changeLabel="Another way"
        />
      )}
      {step.at === 'new' && change === 'phone' && <Phone busy={busy} onPhone={(e164) => void send({ kind: 'phone', e164 }, (wait) => ({ at: 'newCode', to: { kind: 'phone', e164 }, wait }))} />}
      {step.at === 'new' && change === 'email' && <NewEmail busy={busy} onEmail={(email) => void send({ kind: 'email', email }, (wait) => ({ at: 'newCode', to: { kind: 'email', email }, wait }))} />}
      {step.at === 'newCode' && (
        <Code key={toOf(step.to)} to={step.to} wait={step.wait} onCode={(code) => save(step.to, code)} onResend={() => resend(step.to)} onChange={() => setStep({ at: 'new' })} />
      )}
    </Frame>
  );
}

function NewEmail({ busy, onEmail }: { busy: boolean; onEmail: (email: string) => void }) {
  const [text, setText] = useState('');
  const read = readContact(text);
  const email = read && read !== 'abroad' && read.kind === 'email' ? read.email : null;
  const go = () => email && onEmail(email);
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        <Field
          label="Email"
          value={text}
          onChangeText={setText}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={go}
        />
      </View>
      <Pill label="Send code" size="wide" disabled={!email || busy} onPress={go} />
    </View>
  );
}
