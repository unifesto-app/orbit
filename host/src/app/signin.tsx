// Signing in to any of Orbit's host apps, one screen for all three (sign-in take, approved 22 Nov 2026: https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg).
// Codes only for now (owner, 22 Nov 2026: "Codes first"): one field takes a phone number or an email, a 6-digit code
// comes on WhatsApp or by email, and the API says what's next (signinSteps.ts): "Is this you?" for a phone code on a new
// phone, a WhatsApp number for a new account started by email, About you for a new account, or signed in. The steps and
// their care are the Orbit app's (app/src/app/login.tsx; User flow doc), on one Orbit account for every app:
// - one request at a time, read at once, so a code filled in twice is sent once, and Back waits for the answer;
// - a code sent under 30 seconds ago (Back, then the same number) still works, so it goes to the code screen;
// - a step that took too long (its ticket or sign-up ran out) starts again, with the API's word why;
// - every message is the API's own, under the field, and read out by VoiceOver and TalkBack.
// ponytail: Google, Apple and passkeys come later, each with its own API and setup change. The questions the Orbit app
// asks after signing in (add the email or way you started with) wait for Launch's account screens.
import { ADULT, type ApiError, type AuthStep, ageOn } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';
import { DARK_TINT, Glass } from '@orbit/mobile/glass';
import { readContact, readDob, sentTo, toOf, typeDob } from '@orbit/mobile/signin';
import { color, font, space } from '@orbit/mobile/theme';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field, Pill, Wide, styles as ui } from '../launch/ui';
import { requestCode } from '../proof';
import { api, openDemo, signIn, thisDevice } from '../session';
import { type Step, clock, initialsOf, secondsLeft, stepAfter, stepBack } from '../signinSteps';
import { thisApp } from '../variant';

const ICON = {
  launch: require('../../assets/icons/launch.png'),
  station: require('../../assets/icons/station.png'),
  crew: require('../../assets/icons/crew.png'),
}[thisApp.word]; // static requires, for Metro
const BACK = require('../../assets/tabs/chevron.png');
const WWW = 'https://heyorbit.in'; // Orbit's terms and privacy pages

export default function SignIn() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>({ at: 'contact' });
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // the same as `busy`, read at once
  const [error, setError] = useState<string | null>(null);
  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };
  // Said aloud when it appears: iOS has no live regions.
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  // One request at a time. Its answer moves on; a refusal shows its message, and one that ran out starts again. False
  // when the API said no, null when one was already under way.
  async function run<T>(request: () => Promise<Result<T>>, then: (data: T) => void): Promise<boolean | null> {
    if (working.current) return null;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await request();
    working.current = false;
    setBusy(false);
    if (r.ok) {
      then(r.data);
      return true;
    }
    if (r.error.error === 'expired') setStep({ at: 'contact' });
    setError(r.error.message);
    return false;
  }
  const answer = (s: AuthStep) => (s.step === 'signedIn' ? signIn(s) : go(stepAfter(s))); // signed in: the guards take over
  // A code to `to`. One sent there under 30 seconds ago still works, so that goes to the code screen as well.
  const send = (to: string, shown: string, signup?: string) =>
    run(
      async () => {
        const r = await requestCode(to);
        const tooSoon = !r.ok && r.error.error === 'tooSoon' ? (r.error as ApiError).retryIn : undefined;
        return tooSoon !== undefined ? { ok: true as const, data: { retryIn: tooSoon } } : r;
      },
      (d) => go({ at: 'code', to, shown, signup, until: Date.now() + d.retryIn * 1000 }),
    );

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + (step.at === 'contact' ? 68 : 14), paddingBottom: insets.bottom + space.big }]}
        keyboardShouldPersistTaps="handled"
      >
        {step.at !== 'contact' && (
          <Pressable
            onPress={() => go(stepBack(step))}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Back"
            accessibilityState={{ disabled: busy }}
            hitSlop={4}
            style={({ pressed }) => [styles.back, busy && styles.off, pressed && ui.pressed]}
          >
            <Glass tint={DARK_TINT} style={styles.backCircle}>
              <Image source={BACK} style={styles.backMark} />
            </Glass>
          </Pressable>
        )}
        {step.at === 'contact' || step.at === 'phone' ? (
          <Contact
            key={step.at}
            phoneOnly={step.at === 'phone'}
            busy={busy}
            error={error}
            onSend={(text) => {
              const c = readContact(text);
              const signup = step.at === 'phone' ? step.signup : undefined;
              if (c === 'abroad') return setError('Orbit takes Indian (+91) numbers only.');
              if (!c) return setError(signup ? 'Check the number.' : 'Check the number or email.');
              if (signup && c.kind !== 'phone') return setError('Add a WhatsApp number here.');
              void send(toOf(c), sentTo(c), signup);
            }}
          />
        ) : step.at === 'code' ? (
          <Code
            key={step.to}
            step={step}
            busy={busy}
            error={error}
            onCode={(code) => run(() => api.call<AuthStep>('POST', '/auth/code/verify', { to: step.to, code, device: thisDevice(), ...(step.signup && { signup: step.signup }) }), answer)}
            onResend={() => send(step.to, step.shown, step.signup)}
          />
        ) : step.at === 'confirm' ? (
          <Confirm step={step} busy={busy} error={error} onAnswer={(me) => run(() => api.call<AuthStep>('POST', '/auth/confirm', { ticket: step.ticket, me, device: thisDevice() }), answer)} />
        ) : (
          <AboutYou
            prefill={step.name}
            busy={busy}
            error={error}
            onDone={(name, dob) => run(() => api.call<AuthStep>('POST', '/auth/signup', { signup: step.signup, name, dob, device: thisDevice() }), answer)}
          />
        )}
        {__DEV__ && step.at === 'contact' && (
          <Text style={styles.demo} onPress={openDemo} accessibilityRole="button">
            Open the Punchline demo (development builds only)
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// The API's message, or one of ours, under what it's about.
function Problem({ text }: { text: string | null }) {
  return text ? <Text style={styles.error}>{text}</Text> : null;
}

function Contact({ phoneOnly, busy, error, onSend }: { phoneOnly: boolean; busy: boolean; error: string | null; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const can = !!text.trim() && !busy;
  return (
    <>
      {!phoneOnly && <Image source={ICON} style={styles.icon} accessibilityLabel={thisApp.name} />}
      <Text style={styles.title} accessibilityRole="header">
        {phoneOnly ? 'Add your WhatsApp number' : `Sign in to ${thisApp.name}`}
      </Text>
      <Text style={styles.line}>
        {phoneOnly ? 'Every Orbit account has one. Its code comes on WhatsApp.' : 'Use the phone number or email on your Orbit account. New to Orbit? You’ll make one next.'}
      </Text>
      <View style={styles.gapBig}>
        <Field
          label={phoneOnly ? 'WhatsApp number' : 'Phone number or email'}
          value={text}
          onChangeText={setText}
          placeholder={phoneOnly ? '98765 43210' : '98765 43210 or you@example.com'}
          keyboardType={phoneOnly ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={phoneOnly ? 'tel' : 'email'}
          textContentType={phoneOnly ? 'telephoneNumber' : 'username'}
          returnKeyType="send"
          onSubmitEditing={() => can && onSend(text)}
        />
      </View>
      <Problem text={error} />
      <View style={styles.gap}>
        <Wide label={busy ? 'Sending…' : 'Continue'} disabled={!can} onPress={() => onSend(text)} />
      </View>
      <Text style={styles.note}>A 6-digit code comes on {phoneOnly ? 'WhatsApp' : 'WhatsApp, or by email'}.</Text>
      {!phoneOnly && <Text style={[styles.note, styles.foot]}>One Orbit account works in every Orbit app. Google, Apple and passkeys come here soon.</Text>}
    </>
  );
}

function Code({ step, busy, error, onCode, onResend }: { step: Extract<Step, { at: 'code' }>; busy: boolean; error: string | null; onCode: (code: string) => Promise<boolean | null>; onResend: () => void }) {
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = secondsLeft(step.until, now);
  // A refused code clears, for the next try.
  const submit = (c: string) => void onCode(c).then((ok) => ok === false && setCode(''));
  const type = (t: string) => {
    const digits = t.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits); // a full code goes at once, as the phone fills it from the message
  };
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        Enter the code
      </Text>
      <Text style={styles.line}>{step.shown}.</Text>
      <View style={styles.gapBig}>
        <Field label="6-digit code" code value={code} onChangeText={type} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} autoFocus />
      </View>
      <Problem text={error} />
      <View style={styles.gap}>
        <Wide label={busy ? 'Checking…' : 'Continue'} disabled={code.length !== 6 || busy} onPress={() => submit(code)} />
      </View>
      <View style={styles.pills}>
        <Pill label={left > 0 ? `Resend in ${clock(left)}` : 'Resend the code'} onPress={left > 0 || busy ? undefined : onResend} />
      </View>
    </>
  );
}

function Confirm({ step, busy, error, onAnswer }: { step: Extract<Step, { at: 'confirm' }>; busy: boolean; error: string | null; onAnswer: (me: boolean) => void }) {
  const initials = initialsOf(step.name);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        Is this you?
      </Text>
      <Text style={styles.line}>This number already has an Orbit account. Sign in only if it’s yours.</Text>
      <View style={[ui.card, styles.account]} accessible accessibilityLabel={`${step.name}, on Orbit since ${step.since}`}>
        <View style={styles.initials}>{initials ? <Text style={styles.initialsText}>{initials}</Text> : null}</View>
        <View style={styles.accountLines}>
          <Text style={styles.accountName}>{step.name}</Text>
          <Text style={styles.small}>On Orbit since {step.since}</Text>
        </View>
      </View>
      <Problem text={error} />
      <View style={styles.gapBig}>
        <Wide label="Yes, it’s me" disabled={busy} onPress={() => onAnswer(true)} />
      </View>
      <View style={styles.gapSmall}>
        <Wide label="Not me, start fresh" muted disabled={busy} onPress={() => onAnswer(false)} />
      </View>
      <Text style={styles.note}>For your safety, changing your email or deleting the account waits 7 days after a phone code on a new phone. An email code skips this.</Text>
    </>
  );
}

function AboutYou({ prefill, busy, error, onDone }: { prefill: string | null; busy: boolean; error: string | null; onDone: (name: string, dob: string) => void }) {
  const [name, setName] = useState(prefill ?? '');
  const [typed, setTyped] = useState('');
  const dob = readDob(typed, Date.now());
  const age = dob ? ageOn(dob, Date.now()) : null;
  const ok = !!name.trim() && age !== null && age >= ADULT;
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        About you
      </Text>
      <Text style={styles.line}>You’re new to Orbit. This account works in every Orbit app, the one people book in too.</Text>
      <View style={styles.gapBig}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Your full name" autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={100} />
      </View>
      <View style={styles.gap}>
        <Field label="Date of birth" value={typed} onChangeText={(t) => setTyped(typeDob(t))} placeholder="DD/MM/YYYY" keyboardType="number-pad" maxLength={10} />
      </View>
      {age !== null && <Text style={styles.note}>{age >= ADULT ? `You’re ${age}.` : `Orbit is for people ${ADULT} and over.`}</Text>}
      {typed.length === 10 && !dob && <Text style={styles.note}>Check the date.</Text>}
      <Text style={[styles.note, styles.terms]}>
        By continuing you agree to Orbit’s{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(`${WWW}/terms`).catch(() => {})} accessibilityRole="link">
          Terms
        </Text>{' '}
        and{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(`${WWW}/privacy`).catch(() => {})} accessibilityRole="link">
          Privacy
        </Text>
        .
      </Text>
      <Problem text={error} />
      <View style={styles.gap}>
        <Wide label={busy ? 'Making your account…' : 'Continue'} disabled={!ok || busy} onPress={() => dob && onDone(name.trim(), dob)} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  body: { flexGrow: 1, paddingHorizontal: 20 },
  back: { alignSelf: 'flex-start', marginLeft: -4, marginBottom: 32 },
  off: { opacity: 0.4 },
  backCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backMark: { width: 18, height: 18, tintColor: color.text, transform: [{ scaleX: -1 }] },
  icon: { width: 72, height: 72, borderRadius: 16, marginBottom: space.big },
  title: { fontFamily: font.headline, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.text },
  line: { marginTop: space.small, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  note: { marginTop: 12, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  foot: { marginTop: 'auto', paddingTop: space.big },
  terms: { marginTop: space.big },
  link: { color: color.text, textDecorationLine: 'underline' },
  error: { marginTop: 12, fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.text },
  gapBig: { marginTop: 32 },
  gap: { marginTop: 16 },
  gapSmall: { marginTop: 12 },
  pills: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  account: { marginTop: space.big, flexDirection: 'row', alignItems: 'center', gap: 12 },
  initials: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.fill, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: font.headline, fontSize: 16, color: color.text },
  accountLines: { flex: 1, gap: 2 },
  accountName: { fontFamily: font.title, fontSize: 17, color: color.text },
  demo: { marginTop: space.big, fontFamily: font.medium, fontSize: 13, color: color.secondary, textDecorationLine: 'underline' },
});
