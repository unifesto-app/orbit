// The sign-in sheet (User flow doc, settled 15 Nov 2026): signing in and signing up are the same steps, with no
// passwords anywhere. It opens over whatever needed an account (Save, Follow, Book, Sign in; src/session.ts), so closing
// it, or finishing, lands back there with the tapped thing done. Frosted glass like every modal, an X to close.
// The steps, as the doc orders them:
// - One field, Phone number or email, and Continue, which always sends a 6-digit code (WhatsApp or email). Then Continue
//   with Google and Continue with Apple side by side (Apple on iOS only, as today), then Use a passkey.
// - Not in by phone: add a WhatsApp number and its code (decision 2). A number already on an account signs in to it
//   and asks to add the way they started with.
// - A phone code for an account this phone hasn't signed in to shows the masked account first: "Is this you?", with
//   Not me, start fresh (the recycled-SIM guard from the Fable review).
// - New people: About you, a name (prefilled from Google or Apple) and a date of birth with the age shown back, and the
//   terms line. Under 18 makes no account (decision 5). A phone-only account is then offered a passkey.
// Nothing asks for an email, push or anything else here.
// Every step is the Orbit API's (api/src/auth/routes.ts): it checks the codes, knows the accounts and says which step is
// next; its messages show as they come.
// - Google, Apple and Use a passkey get their proof on the phone (src/ways.ts) and go through the same steps: a linked
//   one signs in; a new one adds a WhatsApp number, then About you with its name.
// - Signed in, a few questions may follow before the sheet closes, each answered once: add the email or Google or Apple
//   they started with (a number already on Orbit), Keep my account (set to be deleted), and, for a new phone-only
//   account, a passkey, so it outlives the SIM (User doc).
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import type { AuthStep, Me } from '@orbit/contract';

import { Code, Field, Pill, RIM } from '../account/kit';
import { day, type Way } from '../account/rules';
import { BROKEN, type Result } from '../api';
import { Glass } from '../glass';
import { Icon } from '../icons';
import { api, keepAccount, runPending, setAccount, signIn, thisDevice } from '../session';
import { Choice, Frame, GoogleMark, Phone, styles as sheet, With } from '../sheet';
import { ADULT, ageOn, type Contact, readContact, readDob, sentTo, toOf, typeDob } from '../signin';
import { color, font } from '../theme';
import { addPasskey, appleHere, appleProof, type Got, googleProof, passkeyAnswer, passkeysHere } from '../ways';

const WWW = 'https://www.unifesto.app'; // the legal pages, as Account links them

type Step =
  | { at: 'start' }
  | { at: 'code'; to: Contact; signup?: string; wait: number }
  | { at: 'phone'; signup: string }
  | { at: 'whose'; ticket: string; name: string; since: number }
  | { at: 'link'; token: string }
  | { at: 'way'; token: string; provider: 'google' | 'apple' }
  | { at: 'keep'; due: string }
  | { at: 'passkey' }
  | { at: 'about'; signup: string };

// The questions after signing in: the session is made by then, so closing the sheet keeps it.
const AFTER: readonly Step['at'][] = ['link', 'way', 'keep', 'passkey'];
const NAMES = { google: 'Google', apple: 'Apple' } as const;

export default function Login() {
  const [step, go] = useState<Step>({ at: 'start' });
  const via = useRef<Way>('phone'); // how they came in, read when the last step lands
  const made = useRef(false); // About you made the account just now
  const [name, setName] = useState(''); // About you's, prefilled when the API knows it
  const [error, setError] = useState<string | null>(null); // the API's message, under the title
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // the same, read at once: a code filled in twice sends it once

  const setStep = (next: Step) => {
    setError(null);
    go(next);
  };
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
      // A step that took too long (its token or ticket ran out) can't be finished: start again, with the API's word why.
      // Not from the questions after signing in: they're signed in by then, and Not now still closes.
      if (r.error.error === 'expired' && !AFTER.includes(step.at)) go({ at: 'start' });
      setError(r.error.message);
      return false;
    }
    then(r.data);
    return true;
  }

  // Back to what opened the sheet, and do what was tapped there. Once only, and not at all if the sheet was already
  // closed (X, a swipe, back) while the last request was under way: the sign-in still counts, but there's nothing to go
  // back from.
  const done = useRef(false);
  const open = useRef(true);
  const signedInHere = useRef(false); // the questions after signing in may follow; closing at one still counts
  useEffect(
    () => () => {
      open.current = false;
      // Closed (X, a swipe) at a question after signing in: still do what was tapped.
      if (signedInHere.current && !done.current) {
        done.current = true;
        runPending();
      }
    },
    [],
  );
  const close = () => {
    if (done.current || !open.current) return;
    done.current = true;
    router.back();
    runPending();
  };
  // The questions after signing in, one by one, then back to what opened the sheet.
  const later = useRef<Step[]>([]);
  const advance = () => {
    const n = later.current.shift();
    if (n) setStep(n);
    else close();
  };
  // Where the API says to go next. Signed in counts at once, before any question after it, so closing the sheet then
  // keeps the session the API just made.
  const next = (s: AuthStep) => {
    if (s.step === 'signedIn') {
      signIn(s, via.current);
      signedInHere.current = true;
      const phoneOnly = made.current && via.current === 'phone' && !s.me.email && passkeysHere() === 'ready';
      later.current = [
        ...(s.addEmail ? [{ at: 'link' as const, token: s.addEmail.token }] : []),
        ...(s.addWay ? [{ at: 'way' as const, token: s.addWay.token, provider: s.addWay.provider }] : []),
        ...(s.me.deletionDue ? [{ at: 'keep' as const, due: s.me.deletionDue }] : []),
        ...(phoneOnly ? [{ at: 'passkey' as const }] : []),
      ];
      return advance();
    }
    if (s.step === 'confirm') return setStep({ at: 'whose', ticket: s.ticket, name: s.name, since: s.since });
    if (s.step === 'phone') return setStep({ at: 'phone', signup: s.signup });
    if (s.step === 'aboutYou') {
      setName((n) => n || s.name || '');
      return setStep({ at: 'about', signup: s.signup });
    }
    setError(BROKEN.message); // a step this version of the app doesn't know
  };

  const send = (to: Contact, signup?: string) =>
    run(
      async () => {
        const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
        // A code went there under 30 seconds ago (Change number, then the same one again): it still works, so go to it.
        return !r.ok && r.error.error === 'tooSoon' ? { ok: true as const, data: { retryIn: r.error.retryIn ?? 30 } } : r;
      },
      (r) => setStep({ at: 'code', to, signup, wait: r.retryIn }),
    );
  const verify = (to: Contact, code: string, signup?: string) =>
    run(() => api.call<AuthStep>('POST', '/auth/code/verify', { to: toOf(to), code, device: thisDevice(), ...(signup && { signup }) }), next);
  // A new code to the same place. The wait comes back either way: from the send, or from "too soon".
  const resend = async (to: Contact) => {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await api.call<{ retryIn: number }>('POST', '/auth/code', { to: toOf(to) });
    working.current = false;
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    return r.ok ? r.data.retryIn : (r.error.retryIn ?? null);
  };
  const confirm = (ticket: string, me: boolean) => run(() => api.call<AuthStep>('POST', '/auth/confirm', { ticket, me, device: thisDevice() }), next);
  const create = (signup: string, dob: string) =>
    run(
      () => api.call<AuthStep>('POST', '/auth/signup', { signup, name: name.trim(), dob, device: thisDevice() }),
      (s) => {
        made.current = s.step === 'signedIn';
        next(s);
      },
    );
  // Continue with Google or Apple, or Use a passkey: the proof from the phone first (nothing said if they closed its
  // sheet), then the API's next step.
  // Locked while its sheet is up, so a second tap (or Continue) doesn't start another sign-in over it.
  const prove = async <P extends object>(way: 'google' | 'apple' | 'passkey', get: () => Promise<Got<P>>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const g = await get();
    working.current = false;
    setBusy(false);
    if (!g.ok) return g.error && setError(g.error.message);
    via.current = way;
    void run(() => api.call<AuthStep>('POST', `/auth/${way}`, { ...g.proof, device: thisDevice() }), next);
  };
  // "Add this email to your account?": signed in already, by the number; yes adds the email.
  const addEmail = (token: string) =>
    void run(
      () => api.authed<Me>('POST', '/me/email', { token }),
      (me) => {
        setAccount(me);
        advance();
      },
    );
  // The same for the Google or Apple they started with.
  const addWay = (token: string) => void run(() => api.authed('POST', '/me/ways', { token }), advance);
  const keep = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const problem = await keepAccount();
    working.current = false;
    setBusy(false);
    if (problem) setError(problem);
    else advance();
  };
  // Add a passkey right after sign-up: fresh by the code just used, so no confirm first.
  const offerPasskey = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await addPasskey();
    working.current = false;
    setBusy(false);
    if (r.ok) advance();
    else if (r.error) setError(r.error.message);
  };

  const head = {
    start: { title: 'Sign in or sign up' },
    code: { title: 'Enter the code', note: step.at === 'code' ? sentTo(step.to) : undefined },
    phone: { title: 'Your WhatsApp number' },
    whose: { title: 'Is this you?' },
    link: { title: 'Add this email to your account?', note: 'Your number is already on Orbit.' },
    way: { title: `Add ${step.at === 'way' ? NAMES[step.provider] : ''} to your account?`, note: 'Your number is already on Orbit.' },
    keep: { title: 'Keep your account?', note: step.at === 'keep' ? `It’s set to be deleted on ${day(step.due)}.` : undefined },
    passkey: { title: 'Add a passkey?', note: 'Next time, sign in with Face ID or your fingerprint.' },
    about: { title: 'About you' },
  }[step.at];

  return (
    <Frame title={head.title} note={head.note} error={error}>
      {step.at === 'start' && (
        <Start
          busy={busy}
          onContact={(c) => {
            via.current = c.kind;
            void send(c);
          }}
          onGoogle={() => void prove('google', googleProof)}
          onApple={() => void prove('apple', appleProof)}
          onPasskey={() => void prove('passkey', passkeyAnswer)}
        />
      )}
      {step.at === 'code' && (
        <Code
          key={toOf(step.to)}
          to={step.to}
          wait={step.wait}
          onCode={(code) => verify(step.to, code, step.signup)}
          onResend={() => resend(step.to)}
          onChange={() => setStep(step.signup ? { at: 'phone', signup: step.signup } : { at: 'start' })}
        />
      )}
      {step.at === 'phone' && <Phone busy={busy} onPhone={(e164) => void send({ kind: 'phone', e164 }, step.signup)} />}
      {step.at === 'whose' && (
        <Choice yes="Yes, sign in" no="Not me, start fresh" busy={busy} onYes={() => void confirm(step.ticket, true)} onNo={() => void confirm(step.ticket, false)}>
          <Account name={step.name} since={step.since} />
        </Choice>
      )}
      {/* Both answers sign in: the number proved the account. */}
      {step.at === 'link' && <Choice yes="Add email" no="Not now" busy={busy} onYes={() => addEmail(step.token)} onNo={advance} />}
      {step.at === 'way' && <Choice yes={`Add ${NAMES[step.provider]}`} no="Not now" busy={busy} onYes={() => addWay(step.token)} onNo={advance} />}
      {step.at === 'keep' && <Choice yes="Keep my account" no="Not now" busy={busy} onYes={() => void keep()} onNo={advance} />}
      {step.at === 'passkey' && <Choice yes="Add a passkey" no="Not now" busy={busy} onYes={() => void offerPasskey()} onNo={advance} />}
      {step.at === 'about' && <About name={name} busy={busy} onName={setName} onDone={(dob) => void create(step.signup, dob)} />}
    </Frame>
  );
}


function Start({
  busy,
  onContact,
  onGoogle,
  onApple,
  onPasskey,
}: {
  busy: boolean;
  onContact: (c: Contact) => void;
  onGoogle: () => void;
  onApple: () => void;
  onPasskey: () => void;
}) {
  const [text, setText] = useState('');
  const read = readContact(text);
  const contact = read && read !== 'abroad' ? read : null;
  const go = () => contact && onContact(contact);
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        <Field
          label="Phone number or email"
          value={text}
          onChangeText={setText}
          placeholder="98765 43210 or you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="go"
          onSubmitEditing={go}
        />
        {read === 'abroad' && <Text style={styles.line}>Orbit takes Indian (+91) numbers only.</Text>}
      </View>
      <Pill label="Continue" size="wide" disabled={!contact || busy} onPress={go} />

      <Text style={styles.or}>or</Text>
      {/* Side by side at the same size (User doc). Short labels, so both fit a phone's width; each still says the
          whole "Continue with" to a screen reader. */}
      <View style={styles.pair}>
        <With label="Google" onPress={onGoogle} mark={<GoogleMark />} disabled={busy} />
        {appleHere && <With label="Apple" onPress={onApple} mark={<Icon name="apple" size={20} color={color.text} />} disabled={busy} />}
      </View>
      {/* Only where the phone can use passkeys (User doc); a build without the module shows it and says to update. */}
      {passkeysHere() !== 'no' && <Pill label="Use a passkey" size="wide" disabled={busy} onPress={onPasskey} />}
    </View>
  );
}

// The masked account a phone number opens (masked by the API), so someone with a recycled SIM can say it isn't theirs.
function Account({ name, since }: { name: string; since: number }) {
  return (
    <Glass style={styles.accountRim}>
      <View style={styles.accountFace}>
        <Text style={styles.accountName}>{name}</Text>
        <Text style={styles.line}>On Orbit since {since}</Text>
      </View>
    </Glass>
  );
}

// About you, the last sign-up screen: Continue makes the account. The date can't be changed afterwards except by
// support, so the age shows back under it. Under 18, no account: a host can add them as a guest (decision 5).
function About({ name, busy, onName, onDone }: { name: string; busy: boolean; onName: (n: string) => void; onDone: (dob: string) => void }) {
  const [dobText, setDobText] = useState('');
  const [today] = useState(() => Date.now());
  const dob = readDob(dobText, today);
  const age = dob ? ageOn(dob, today) : null;
  const ok = !!name.trim() && age !== null && age >= ADULT;
  const ageLine =
    age === null
      ? dobText.length === 10
        ? 'That date doesn’t exist. Check the day and month.'
        : null
      : age < ADULT
        ? 'Orbit is for people 18 and over. A host can still add you to their event as a guest.'
        : `You’re ${age}`;
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        <Field label="Name" value={name} onChangeText={onName} placeholder="Your full name" autoCapitalize="words" autoComplete="name" textContentType="name" />
      </View>
      <View style={styles.block}>
        <Field
          label="Date of birth"
          value={dobText}
          onChangeText={(t) => setDobText(typeDob(t))}
          placeholder="DD/MM/YYYY"
          keyboardType="number-pad"
          autoComplete="birthdate-full"
          maxLength={10}
        />
        {ageLine && <Text style={styles.line}>{ageLine}</Text>}
      </View>
      <Text style={[styles.line, styles.block]}>
        By continuing you agree to the{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(`${WWW}/terms`)} accessibilityRole="link">
          Terms
        </Text>{' '}
        and{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(`${WWW}/privacy`)} accessibilityRole="link">
          Privacy Policy
        </Text>
      </Text>
      <Pill label="Continue" size="wide" disabled={!ok || busy} onPress={() => dob && onDone(dob)} />
    </View>
  );
}

const styles = {
  ...sheet,
  ...StyleSheet.create({
  // A card like Account's: 1px rim, 16 inside.
  accountRim: { marginHorizontal: 20, padding: 1, borderRadius: RIM },
  accountFace: { borderRadius: RIM - 1, backgroundColor: color.card, padding: 16, gap: 2, alignItems: 'center' },
  accountName: { fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
  }),
};
