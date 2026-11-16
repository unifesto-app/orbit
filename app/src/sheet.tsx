// What the sign-in sheet (src/app/login.tsx) and the confirm-it's-you sheet (src/app/account/verify.tsx) share: the
// glass frame with its title and X, the 6-digit code, the WhatsApp number, two-answer questions, and the Continue with
// Google or Apple pills.
import { type ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Field, Pill, styles as kit } from './account/kit';
import { Glass } from './glass';
import { CloseButton, GlassFill } from './rows';
import { type Contact, readPhone, showPhone } from './signin';
import { color, font, space } from './theme';

const CODE = 6;

export const sentTo = (to: Contact) => (to.kind === 'phone' ? `On WhatsApp to ${showPhone(to.e164)}` : `Emailed to ${to.email}`);

// The sheet: a gap at its top on iOS, full screen on Android clear of the status bar (as Sheet in rows.tsx), the title
// with an optional grey line and the X, then the API's message when it said no.
export function Frame({ title, note, error, children }: { title: string; note?: string; error?: string | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small, paddingBottom: insets.bottom + space.big }]}>
      <GlassFill />
      <View style={styles.head}>
        <View style={kit.grow}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {note && <Text style={styles.note}>{note}</Text>}
        </View>
        <CloseButton />
      </View>
      {error && (
        <Text style={[styles.line, styles.block]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
      {children}
    </View>
  );
}

// Continue with Google or Apple: a frosted pill like every button, the company's mark beside a white label.
export function With({ label, mark, onPress }: { label: string; mark: ReactNode; onPress: () => void }) {
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
export function GoogleMark() {
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
// keyboard (not a WhatsApp one). A wrong one clears for another try. Resend waits as long as the API says (30 seconds,
// User doc).
export function Code({
  to,
  wait,
  onCode,
  onResend,
  onChange,
  changeLabel,
}: {
  to: Contact;
  wait: number;
  onCode: (code: string) => Promise<boolean | null>;
  onResend: () => Promise<number | null>;
  onChange: () => void;
  changeLabel?: string; // the second pill, "Change number" or "Change email" unless said
}) {
  const [code, setCode] = useState('');
  // Counted against the clock, not ticks: timers stop while they're in WhatsApp reading the code.
  const [until, setUntil] = useState(() => Date.now() + wait * 1000);
  const [now, setNow] = useState(Date.now);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (!left) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [left, now]);
  const waitFor = (s: number) => {
    setUntil(Date.now() + s * 1000);
    setNow(Date.now());
  };
  return (
    <View style={styles.body}>
      <Glass style={[styles.codeBox, styles.block]}>
        <TextInput
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, CODE);
            setCode(digits);
            if (digits.length === CODE) void onCode(digits).then((ok) => ok === false && setCode(''));
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
        <Pill
          label={left ? `Resend in ${left}s` : 'Resend code'}
          size="small"
          disabled={left > 0}
          onPress={() => void onResend().then((s) => s !== null && waitFor(s))}
        />
        <Pill label={changeLabel ?? (to.kind === 'phone' ? 'Change number' : 'Change email')} size="small" onPress={onChange} />
      </View>
    </View>
  );
}

// Anyone who came in by email, Google or Apple adds a WhatsApp number: every account has a verified phone (decision 2).
export function Phone({ busy, onPhone }: { busy: boolean; onPhone: (e164: string) => void }) {
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
      <Pill label="Send code" size="wide" disabled={!phone || busy} onPress={go} />
    </View>
  );
}

// A question with two answers, the second in grey: "Not me, start fresh", "Not now".
export function Choice({
  yes,
  no,
  busy,
  onYes,
  onNo,
  children,
}: {
  yes: string;
  no: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.body}>
      {children}
      <Pill label={yes} size="wide" disabled={busy} onPress={onYes} />
      <Pill label={no} size="wide" muted disabled={busy} onPress={onNo} />
    </View>
  );
}

const WAY = 50; // as tall as the wide pills

export const styles = StyleSheet.create({
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
});
