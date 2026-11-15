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
// ponytail: no API, so every code works, Google signs in to the mock account, Apple comes back as a new person, and a
// passkey signs straight in. The mock account's phone or email (src/account/data.ts) is a returning person; anything
// else is new. Real Google, Apple and passkeys need native modules (expo-web-browser for Cognito's hosted page,
// expo-apple-authentication, a passkey module with the unifesto.app associated domain): a rebuild each.
import { router } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { profile } from '../account/data';
import { Field, Pill, RIM, styles as kit } from '../account/kit';
import { type Way, year } from '../account/rules';
import { Glass } from '../glass';
import { Icon } from '../icons';
import { CloseButton, GlassFill } from '../rows';
import { runPending, signIn } from '../session';
import { ADULT, ageOn, type Contact, maskName, readContact, readDob, readPhone, showPhone, typeDob } from '../signin';
import { color, font, space } from '../theme';

const WWW = 'https://www.unifesto.app'; // the legal pages, as Account links them
const RESEND = 30; // seconds before a code can be sent again (User doc, Code limits)
const CODE = 6;

type Step =
  | { at: 'start' }
  | { at: 'code'; to: Contact }
  | { at: 'phone' }
  | { at: 'whose'; then: 'link' | 'done' }
  | { at: 'link' }
  | { at: 'about' }
  | { at: 'passkey' };

// ponytail: the mock's one account stands in for the API's lookup.
const known = (c: Contact) => (c.kind === 'phone' ? c.e164 === profile.phone : c.email === profile.email);
const WAY_NAME: Partial<Record<Way, string>> = { google: 'Google', apple: 'Apple', email: 'this email' };

export default function Login() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>({ at: 'start' });
  const [via, setVia] = useState<Way>('phone'); // how they came in
  const [name, setName] = useState(''); // prefilled from Google or Apple

  // Once only: a second tap (or a code filled in twice) would go back again, off the page that opened the sheet.
  const done = useRef(false);
  const finish = (way: Way = via) => {
    if (done.current) return;
    done.current = true;
    signIn(way);
    router.back();
    runPending();
  };
  // A proven phone that's on an account: "Is this you?", then, if they came in another way, whether to add that way.
  // ponytail: the doc asks only on a device the account hasn't used, which the API knows (it issues the device id), so
  // the mock asks every time.
  const toAccount = () => setStep({ at: 'whose', then: via === 'phone' ? 'done' : 'link' });
  const proven = (to: Contact) => {
    if (to.kind === 'email') return known(to) ? finish() : setStep({ at: 'phone' });
    return known(to) ? toAccount() : setStep({ at: 'about' });
  };
  const created = () => (via === 'phone' ? setStep({ at: 'passkey' }) : finish());

  const head = {
    start: { title: 'Sign in or sign up' },
    code: { title: 'Enter the code', note: step.at === 'code' ? sentTo(step.to) : undefined },
    phone: { title: 'Your WhatsApp number' },
    whose: { title: 'Is this you?' },
    link: { title: `Add ${WAY_NAME[via] ?? 'it'} to your account?`, note: 'Your number is already on Orbit.' },
    about: { title: 'About you' },
    passkey: { title: 'Add a passkey?', note: 'Sign in with Face ID or your fingerprint, even without your SIM.' },
  }[step.at];

  return (
    // A sheet on iOS, so a small gap at its top; full screen on Android, clear of the status bar (as Sheet in rows.tsx).
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small, paddingBottom: insets.bottom + space.big }]}>
      <GlassFill />
      <View style={styles.head}>
        <View style={kit.grow}>
          <Text style={styles.title} accessibilityRole="header">
            {head.title}
          </Text>
          {head.note && <Text style={styles.note}>{head.note}</Text>}
        </View>
        <CloseButton />
      </View>

      {step.at === 'start' && (
        <Start
          onContact={(c) => {
            setVia(c.kind);
            setStep({ at: 'code', to: c });
          }}
          // ponytail: Google's account is the mock account's email, so it signs in (a proven email on an account).
          onGoogle={() => finish('google')}
          onApple={() => {
            // ponytail: Apple hides the email, so it's a new person; Apple gives the name.
            setVia('apple');
            setName(profile.name);
            setStep({ at: 'phone' });
          }}
          onPasskey={() => finish('passkey')}
        />
      )}
      {step.at === 'code' && <Code key={step.to.kind} to={step.to} onProven={() => proven(step.to)} onChange={() => setStep(step.to.kind === via ? { at: 'start' } : { at: 'phone' })} />}
      {step.at === 'phone' && <Phone onPhone={(e164) => setStep({ at: 'code', to: { kind: 'phone', e164 } })} />}
      {step.at === 'whose' && (
        <Choice yes="Yes, sign in" no="Not me, start fresh" onYes={() => (step.then === 'link' ? setStep({ at: 'link' }) : finish())} onNo={() => setStep({ at: 'about' })}>
          <Account />
        </Choice>
      )}
      {/* Both answers sign in: the number proved the account. */}
      {step.at === 'link' && <Choice yes={via === 'email' ? 'Add email' : `Add ${WAY_NAME[via]}`} no="Not now" onYes={() => finish()} onNo={() => finish()} />}
      {step.at === 'about' && <About name={name} onName={setName} onDone={created} />}
      {/* ponytail: no passkey module yet, so Add a passkey only finishes; it comes with the native rebuild. */}
      {step.at === 'passkey' && <Choice yes="Add a passkey" no="Not now" onYes={() => finish()} onNo={() => finish()} />}
    </View>
  );
}

const sentTo = (to: Contact) => (to.kind === 'phone' ? `On WhatsApp to ${showPhone(to.e164)}` : `Emailed to ${to.email}`);

function Start({
  onContact,
  onGoogle,
  onApple,
  onPasskey,
}: {
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
          textContentType="username" // so a passkey can be offered from the field later
          returnKeyType="go"
          onSubmitEditing={go}
        />
        {read === 'abroad' && <Text style={styles.line}>Orbit takes Indian (+91) numbers only.</Text>}
      </View>
      <Pill label="Continue" size="wide" disabled={!contact} onPress={go} />

      <Text style={styles.or}>or</Text>
      {/* Side by side at the same size (User doc). Short labels, so both fit a phone's width; each still says the
          whole "Continue with" to a screen reader. */}
      <View style={styles.pair}>
        <With label="Google" onPress={onGoogle} mark={<GoogleMark />} />
        {Platform.OS === 'ios' && <With label="Apple" onPress={onApple} mark={<Icon name="apple" size={20} color={color.text} />} />}
      </View>
      {/* ponytail: shown on every phone until the passkey module can ask whether this one supports them. */}
      <Pill label="Use a passkey" size="wide" onPress={onPasskey} />
    </View>
  );
}

// Continue with Google or Apple: a frosted pill like every button, the company's mark beside a white label.
function With({ label, mark, onPress }: { label: string; mark: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Continue with ${label}`} style={kit.grow}>
      <Glass style={styles.way}>
        {mark}
        <Text style={styles.wayText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// Google's four-colour G, which its sign-in buttons must show.
function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48" accessible={false}>
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

// The 6-digit code: it goes on by itself once the sixth digit is in; iOS offers an emailed or texted code above the
// keyboard (not a WhatsApp one). Resend waits 30 seconds (User doc).
function Code({ to, onProven, onChange }: { to: Contact; onProven: () => void; onChange: () => void }) {
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(RESEND);
  useEffect(() => {
    if (!left) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <View style={styles.body}>
      <Glass style={[styles.codeBox, styles.block]}>
        <TextInput
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, CODE);
            setCode(digits);
            if (digits.length === CODE) onProven(); // ponytail: every code works until the API checks it
          }}
          style={styles.codeText}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          keyboardAppearance="dark"
          maxLength={CODE}
          autoFocus
          placeholder="••••••"
          placeholderTextColor={color.secondary}
          accessibilityLabel={`${CODE}-digit code`}
        />
      </Glass>
      <View style={styles.pair}>
        <Pill label={left ? `Resend in ${left}s` : 'Resend code'} size="small" disabled={left > 0} onPress={() => setLeft(RESEND)} />
        <Pill label={to.kind === 'phone' ? 'Change number' : 'Change email'} size="small" onPress={onChange} />
      </View>
    </View>
  );
}

// Anyone who came in by email, Google or Apple adds a WhatsApp number: every account has a verified phone (decision 2).
function Phone({ onPhone }: { onPhone: (e164: string) => void }) {
  const [text, setText] = useState('');
  const read = readPhone(text);
  const phone = read && read !== 'abroad' ? read : null;
  const go = () => phone && onPhone(phone);
  return (
    <View style={styles.body}>
      <View style={styles.block}>
        <Field
          label="WhatsApp number"
          value={text}
          onChangeText={setText}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus
        />
        {read === 'abroad' && <Text style={styles.line}>Orbit takes Indian (+91) numbers only.</Text>}
      </View>
      <Pill label="Send code" size="wide" disabled={!phone} onPress={go} />
    </View>
  );
}

// The masked account a phone number opens, so someone with a recycled SIM can say it isn't theirs.
function Account() {
  return (
    <Glass style={styles.accountRim}>
      <View style={styles.accountFace}>
        <Text style={styles.accountName}>{maskName(profile.name)}</Text>
        <Text style={styles.line}>On Orbit since {year(profile.since)}</Text>
      </View>
    </Glass>
  );
}

// A question with two answers, the second in grey: "Not me, start fresh", "Not now".
function Choice({ yes, no, onYes, onNo, children }: { yes: string; no: string; onYes: () => void; onNo: () => void; children?: ReactNode }) {
  return (
    <View style={styles.body}>
      {children}
      <Pill label={yes} size="wide" onPress={onYes} />
      <Pill label={no} size="wide" muted onPress={onNo} />
    </View>
  );
}

// About you, the last sign-up screen: Continue makes the account. The date can't be changed afterwards except by
// support, so the age shows back under it. Under 18, no account: a host can add them as a guest (decision 5).
function About({ name, onName, onDone }: { name: string; onName: (n: string) => void; onDone: () => void }) {
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
      <Pill label="Continue" size="wide" disabled={!ok} onPress={onDone} />
    </View>
  );
}

const WAY = 50; // as tall as the wide pills

const styles = StyleSheet.create({
  screen: { flex: 1, gap: space.big },
  head: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  title: { fontFamily: font.headline, fontSize: 22, lineHeight: 28, color: color.text },
  note: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  body: { gap: space.small + 4 },
  block: { marginHorizontal: 20, gap: 6 },
  line: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  link: { color: color.text, textDecorationLine: 'underline' },
  or: { alignSelf: 'center', fontFamily: font.medium, fontSize: 13, color: color.secondary },
  pair: { marginHorizontal: 20, flexDirection: 'row', justifyContent: 'center', gap: space.small },
  way: { height: WAY, borderRadius: WAY / 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.small },
  wayText: { fontFamily: font.title, fontSize: 14, color: color.text },
  codeBox: { height: 56, borderRadius: 28, justifyContent: 'center' },
  codeText: { height: '100%', fontFamily: font.price, fontSize: 24, letterSpacing: 12, color: color.text, textAlign: 'center' },
  // A card like Account's: 1px rim, 16 inside.
  accountRim: { marginHorizontal: 20, padding: 1, borderRadius: RIM },
  accountFace: { borderRadius: RIM - 1, backgroundColor: color.card, padding: 16, gap: 2, alignItems: 'center' },
  accountName: { fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
});
