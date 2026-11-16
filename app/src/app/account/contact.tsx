// Change your number, or add or change your email (User doc, Managing sign-in methods), from Edit profile. The API's
// steps (api/src/auth/security.ts), in order:
// 1. Confirm it's you: a code to your own number, unless this phone did in the last 10 minutes. In the 7 days after
//    "Is this you?" an email change needs it from your email instead (the recycled-SIM hold), when you have one.
// 2. The new number or email, and a code sent to it.
// 3. That code makes the change; the API tells the old one. A confirm that has lapsed meanwhile starts again at 1.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Code, Field, Note, Page, Pill, SignInNote } from '../../account/kit';
import { changeStart, day, type Security } from '../../account/rules';
import { BROKEN, type Result } from '../../api';
import { api, patchAccount, useSession } from '../../session';
import { type Contact, readContact, readPhone, sentTo, toOf } from '../../signin';
import { color, font, space } from '../../theme';

type Way = 'phone' | 'email';
type Step =
  | { at: 'check' }
  | { at: 'prove'; to: Contact; wait: number }
  | { at: 'new'; s: Security }
  | { at: 'code'; to: Contact; wait: number; s: Security }
  | { at: 'wait'; until: string };

export default function ChangeContact() {
  const way: Way = useLocalSearchParams<{ way?: string }>().way === 'email' ? 'email' : 'phone';
  const me = useSession()?.me;
  return (
    <Page title={way === 'phone' ? 'Change number' : me?.email ? 'Change email' : 'Add email'}>
      {me ? <Steps key={me.id} way={way} /> : <SignInNote>Sign in to change it.</SignInNote>}
    </Page>
  );
}

// A code to `to`. One sent there under 30 seconds ago still works, so it goes on to it (as the sign-in sheet does).
async function sendCode(to: Contact): Promise<Result<{ retryIn: number }>> {
  const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
  return !r.ok && r.error.error === 'tooSoon' ? { ok: true, data: { retryIn: r.error.retryIn ?? 30 } } : r;
}

// The account's own number and email come from the API's answer, not the phone's copy, which another device may have
// changed since.
function Steps({ way }: { way: Way }) {
  const [step, go] = useState<Step>({ at: 'check' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // the same, read at once: a code filled in twice sends it once
  // Left (back) while a request was out: its answer still counts, but nothing goes on from here.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  // One request at a time. False when the API said no (its message shows), null when one was already under way.
  async function run<T>(request: () => Promise<Result<T>>, then: (data: T) => void): Promise<boolean | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await request();
    working.current = false;
    setBusy(false);
    if (!r.ok) {
      // The hold: the wait note says when, in place of the API's "confirm with your email", already done.
      if (r.error.error === 'held' && r.error.until) go({ at: 'wait', until: r.error.until });
      else setError(r.error.message);
      if (open.current && r.error.error === 'needsFresh') void start(); // the 10 minutes ran out: confirm again
      return false;
    }
    then(r.data);
    return true;
  }

  // Where to begin (changeStart), again after your email's code in case the hold still stands.
  const start = (provedByEmail = false) => {
    go({ at: 'check' }); // a failed read shows Try again
    return run(
      () => api.authed<Security>('GET', '/me/security'),
      (s) => {
        if (!open.current) return; // left meanwhile: no code to send
        const next = changeStart(way, s, provedByEmail);
        if (!next) return setError(BROKEN.message); // every account has a number; never here
        if (next.next === 'new') return go({ at: 'new', s });
        if (next.next === 'wait') return go({ at: 'wait', until: next.until });
        const to: Contact = next.via === 'email' ? { kind: 'email', email: next.to } : { kind: 'phone', e164: next.to };
        void run(
          () => sendCode(to),
          (r) => go({ at: 'prove', to, wait: r.retryIn }),
        );
      },
    );
  };
  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the screen opens
  }, []);

  // A new code to the same place. The wait comes back either way: from the send, or from "too soon".
  const resend = async (to: Contact) => {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await sendCode(to);
    working.current = false;
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    return r.ok ? r.data.retryIn : (r.error.retryIn ?? null);
  };

  return (
    <View style={styles.body}>
      {step.at === 'prove' && <Note>{`Confirm it’s you. ${sentTo(step.to)}.`}</Note>}
      {step.at === 'code' && <Note>{`${sentTo(step.to)}.`}</Note>}
      {step.at === 'wait' && <Note>{`You signed in with your number on a new phone, so your email can change from ${day(step.until)}.`}</Note>}
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}

      {step.at === 'check' && error && <Pill label="Try again" size="wide" disabled={busy} onPress={() => void start()} />}
      {step.at === 'prove' && (
        <Code
          key={`prove|${toOf(step.to)}`}
          to={step.to}
          wait={step.wait}
          onCode={(code) =>
            run(
              () => api.authed('POST', '/me/fresh', { via: step.to.kind, code }),
              () => void start(step.to.kind === 'email'),
            )
          }
          onResend={() => resend(step.to)}
        />
      )}
      {step.at === 'new' && (
        <NewContact
          way={way}
          busy={busy}
          onSend={(to) => {
            if (toOf(to) === (to.kind === 'phone' ? step.s.phone : step.s.email))
              return setError(to.kind === 'phone' ? 'That’s already your number.' : 'That’s already your email.');
            void run(
              () => sendCode(to),
              (r) => go({ at: 'code', to, wait: r.retryIn, s: step.s }),
            );
          }}
        />
      )}
      {step.at === 'code' && (
        <Code
          key={`new|${toOf(step.to)}`}
          to={step.to}
          wait={step.wait}
          onCode={(code) =>
            run(
              () => api.authed<{ phone: string } | { email: string }>('PUT', `/me/${way}`, { to: toOf(step.to), code }),
              (changed) => {
                patchAccount(changed);
                if (open.current) router.back();
              },
            )
          }
          onResend={() => resend(step.to)}
          onChange={() => go({ at: 'new', s: step.s })}
        />
      )}
    </View>
  );
}

// The new number or email, and Send code.
function NewContact({ way, busy, onSend }: { way: Way; busy: boolean; onSend: (to: Contact) => void }) {
  const [text, setText] = useState('');
  const phone = way === 'phone' ? readPhone(text) : null;
  const read = way === 'phone' ? (phone && phone !== 'abroad' ? { kind: 'phone' as const, e164: phone } : null) : readContact(text);
  const to = read && read !== 'abroad' && read.kind === way ? read : null;
  const send = () => to && onSend(to);
  return (
    <>
      <View style={styles.block}>
        {way === 'phone' ? (
          <Field
            label="New WhatsApp number"
            value={text}
            onChangeText={setText}
            placeholder="98765 43210"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            autoFocus
            returnKeyType="send"
            onSubmitEditing={send}
          />
        ) : (
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
            returnKeyType="send"
            onSubmitEditing={send}
          />
        )}
        {phone === 'abroad' && <Text style={styles.error}>Orbit takes Indian (+91) numbers only.</Text>}
      </View>
      <Pill label="Send code" size="wide" disabled={!to || busy} onPress={send} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.small, gap: space.small + 4 },
  block: { marginTop: space.small, marginHorizontal: 20, gap: 6 },
  error: { marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
