// The pieces every Account screen is built from. A page is the pushed-page back bar over a scroll; settings sit in
// cards like every other card in the app (6px contents, 8 padding, face 14, frosted rim 16), and a card holds text
// only: no leading icons, no chevrons (owner, 15 Nov 2026: "never use icons in card"). Buttons are frosted pills with
// white labels, never squared; a chip's pick is an accent dot, never accent text.
import { Children, Fragment, type ReactNode, isValidElement, useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Switch, Text, TextInput, type TextInputProps, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from '../glass';
import { Icon, type IconName } from '../icons';
import { BackBar, FaceWash, Glow, Section, TOP } from '../rows';
import { needsAccount } from '../session';
import type { Contact } from '../signin';
import { around, color, font, radius, space, stoneAt } from '../theme';

// Room in every card (owner, 15 Nov 2026: "add proper spacing and padding to cards"): 16 inside and 16 between rows,
// as the event page's When and where and FAQ cards got for the same words. Corners nest outward: 6 + 16 = 22, rim 24.
export const PAD = 16;
// Account's frosted rim is 1px, half the app's (owner, 15 Nov 2026: "change rim to 1px"), on cards and photos alike.
export const EDGE = 1;
const FACE = around(radius.sm, PAD);
export const RIM = around(FACE, EDGE); // a card's outer corner, also the Account panel's bottom corners
const ROW = 28; // a row's least height; with half the gap above and below as hitSlop, a 44pt tap target
const SLOP = { top: PAD / 2, bottom: PAD / 2 };
const ICON = 22; // a row's icon
const ICON_GAP = 12; // from the icon to its label

export const REVEAL = 120; // how much taller the profile's panel is than Account's, its head grown
export const TINT = 0.5; // the accent's glow at the panel's bottom centre; Explore's boxes are 0.75

// Each row's icon in its own colour (owner, 15 Nov 2026: "should have various acents"): Search's Explore colours, Open
// Color shades plus the brand blue, no two alike within a card. The icon only: labels stay white.
export const TONE = {
  orange: '#E8590C',
  pink: '#D6336C',
  violet: '#7048E8',
  cyan: '#1098AD',
  green: '#2F9E44',
  yellow: '#FCC419',
  mint: '#099268',
  red: '#E03131',
  blue: '#295EFF',
  grape: '#AE3EC9',
} as const;

// A screen pushed over the tabs: its title, then the content; the frosted back circle pinned on top.
export function Page({
  title,
  tint,
  bar,
  children,
}: {
  title?: string;
  tint?: string; // a colour glowing from the top, as a host's own pages have (Galaxy's host page)
  bar?: ReactNode; // at the back bar's right, as a saved list's ⋯ menu
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [scrollY] = useState(() => new Animated.Value(0));
  return (
    <View style={styles.screen}>
      {tint && <Glow tint={tint} />}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets // iOS: the keyboard never covers a field or the button under it
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: insets.bottom + space.big }}>
        {title && (
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        )}
        {children}
      </Animated.ScrollView>
      <BackBar scrollY={scrollY}>{bar}</BackBar>
    </View>
  );
}

// The frosted glass panel at the top of Account and the profile (owner, 15 Nov 2026: "add 4:3 glass bg in account
// page", "add radial orbit kind tint to the card of app accent"): edge to edge from the top of the screen, 4:3 plus
// `extra`, its contents centred under the back bar, the accent glowing up from its bottom centre in a 4:3 box. Native
// glass rounds every corner alike, so the glass runs STRETCH above the screen, where its top corners can't be seen even
// as the page bounces; its bottom corners are the cards'. Put it first in a Page. No space dots (owner, 19 Nov 2026:
// "remove space dots, completely").
const STRETCH = 400;
export function Panel({ extra = 0, children }: { extra?: number; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const rest = (width * 3) / 4;
  const lift = insets.top + TOP; // how far down Page starts its content; the panel starts above that, at the top
  return (
    <View style={[styles.panel, { height: rest + extra, marginTop: -lift, paddingTop: lift }]}>
      <Glass style={styles.panelGlass} />
      <View style={[styles.panelGlow, { height: rest }]}>
        <FaceWash tint={color.accent} opacity={TINT} corner={RIM} />
      </View>
      {children}
    </View>
  );
}

// A card of rows, under a section heading when it has one. A hairline between rows, in the middle of the gap (owner,
// 15 Nov 2026: "add hairline"). `bare` drops the frosted rim, leaving the face alone (owner, 17 Nov 2026: "in Delete
// Account, remove the rim of all cards").
export function Group({ title, bare = false, children }: { title?: string; bare?: boolean; children: ReactNode }) {
  const rows = Children.toArray(children); // drops the false and null of rows shown only sometimes
  // With icons, the hairline starts where the text does, as in iOS Settings.
  const indent = rows.some((r) => isValidElement<{ icon?: IconName }>(r) && !!r.props.icon) ? ICON + ICON_GAP : 0;
  const face = (
    <View style={[styles.face, bare && styles.outline]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.hairline, { marginLeft: indent }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
  return (
    <>
      {title && <Section title={title} />}
      {bare ? (
        <View style={[styles.bare, !title && styles.spaced]}>{face}</View>
      ) : (
        <Glass style={[styles.rim, !title && styles.spaced]}>{face}</Glass>
      )}
    </>
  );
}

// One line in a card: an icon in its own colour on the left (owner, 15 Nov 2026: "add icon on left", "should have
// various acents"; an exception to "never use icons in card", for Account's rows), a label (and a grey note under it),
// a grey value on the right, or a control. A row that opens something is pressable as a whole.
export function Row({
  icon,
  tone = color.text,
  lead,
  label,
  note,
  value,
  right,
  checked,
  disabled = false,
  onPress,
}: {
  icon?: IconName;
  tone?: string;
  lead?: ReactNode; // a host's logo or an event's poster in place of the icon (Galaxy's rows)
  label: string;
  note?: string;
  value?: string;
  right?: ReactNode;
  checked?: boolean; // a row that ticks, as a list in the heart's modal: a checkbox to screen readers
  disabled?: boolean; // faded and not pressable while a request is out, as the sign-in sheet's ways in
  onPress?: () => void;
}) {
  const body = (
    <>
      {icon && (
        <View style={styles.icon}>
          <Icon name={icon} size={ICON} color={tone} />
        </View>
      )}
      {lead}
      <View style={[styles.grow, styles.lines]}>
        <Text style={styles.label}>{label}</Text>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
      {value !== undefined && (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole={checked === undefined ? 'button' : 'checkbox'}
      disabled={disabled}
      accessibilityState={checked === undefined ? { disabled } : { checked, disabled }}
      hitSlop={SLOP}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

// A switch: the accent on the track when on (an element, never text).
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={{ true: color.accent, false: color.track }}
      ios_backgroundColor={color.track}
      thumbColor={value ? color.onAccent : color.text}
    />
  );
}

// Every button: frosted glass, a white label, fully round. `size` small is the 32pt pill; wide spans the page.
export function Pill({
  label,
  onPress,
  size = 'normal',
  muted = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  size?: 'small' | 'normal' | 'wide';
  muted?: boolean; // a grey label, for a state rather than an action ("Following")
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      hitSlop={size === 'small' ? 6 : 0}
      style={[size === 'wide' && styles.wideWrap, disabled && styles.disabled]}>
      <Glass style={styles[size]}>
        <Text style={[size === 'small' ? styles.smallText : styles.pillText, muted && styles.mutedText]}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

// A pick among a few: frosted like every button, its pick shown by an accent dot (as Search's chips).
export function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: o === value }}>
          <Glass style={styles.chip}>
            {o === value && <View style={styles.dot} />}
            <Text style={styles.chipText}>{o}</Text>
          </Glass>
        </Pressable>
      ))}
    </View>
  );
}

// A text field: its label, then a frosted pill like the search box (owner: "also squared search").
export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Glass style={[styles.input, input.multiline && styles.area]}>
        <TextInput
          style={[styles.inputText, input.multiline && styles.areaText]}
          placeholderTextColor={color.secondary}
          keyboardAppearance="dark"
          accessibilityLabel={label}
          {...input}
        />
      </Glass>
    </View>
  );
}

// The 6-digit code (the sign-in sheet, and changing your number or email): it goes on by itself once the sixth digit is
// in; iOS offers an emailed or texted code above the keyboard (not a WhatsApp one). A wrong one clears for another try.
// Resend waits as long as the API says (30 seconds, User doc). `onChange` shows Change number or Change email.
// A code that didn't go (refused, or typed while a resend was out) clears for another try.
const CODE = 6;
export function Code({
  to,
  wait,
  onCode,
  onResend,
  onChange,
}: {
  to: Contact;
  wait: number;
  onCode: (code: string) => Promise<boolean | null>;
  onResend: () => Promise<number | null>;
  onChange?: () => void;
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
    <View style={styles.code}>
      <Glass style={styles.codeBox}>
        <TextInput
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, CODE);
            setCode(digits);
            if (digits.length === CODE) void onCode(digits).then((ok) => ok !== true && setCode('')); // refused, or another request was out
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
      <View style={styles.codePair}>
        <Pill
          label={left ? `Resend in ${left}s` : 'Resend code'}
          size="small"
          disabled={left > 0}
          onPress={() => void onResend().then((s) => s !== null && waitFor(s))}
        />
        {onChange && <Pill label={to.kind === 'phone' ? 'Change number' : 'Change email'} size="small" onPress={onChange} />}
      </View>
    </View>
  );
}

// Grey text under a page's title when the page has nothing to list yet. The only text that isn't a title or a value:
// descriptions are gone from Account (owner, 15 Nov 2026: "keep only titles remove all descriptions").
export function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.pageNote}>{children}</Text>;
}

// Signed out, where your own things would be (Tickets, Saved, Following, Event Request): one line, and Sign in, which
// opens the sign-in sheet over the page; once signed in, the page fills in under it (src/session.ts).
export function SignInNote({ children }: { children: string }) {
  return (
    <View style={styles.signIn}>
      <Note>{children}</Note>
      <Pill label="Sign in" size="wide" onPress={() => needsAccount()} />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  title: { marginHorizontal: 20, fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },

  panel: { justifyContent: 'center' },
  panelGlass: { position: 'absolute', top: -STRETCH, left: 0, right: 0, bottom: 0, borderRadius: RIM },
  panelGlow: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  rim: { marginHorizontal: 20, padding: EDGE, borderRadius: RIM },
  bare: { marginHorizontal: 20 },
  spaced: { marginTop: space.big },
  face: { borderRadius: FACE, backgroundColor: color.card, padding: PAD },
  outline: { borderWidth: 1, borderColor: color.border }, // a bare group has no rim
  // Inside the card's padding on both sides (owner: "right side make it full hairline", then "dont use full hairline").
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: PAD / 2, backgroundColor: stoneAt(0.12) },
  row: { minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: space.small },
  lines: { gap: 2 }, // line spacing between a row's label and its note
  icon: { marginRight: ICON_GAP - space.small }, // the row's own gap makes up the rest
  label: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  value: { maxWidth: '50%', fontFamily: font.text, fontSize: 14, color: color.secondary },

  normal: { height: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  small: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  wide: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  wideWrap: { marginHorizontal: 20 },
  pillText: { fontFamily: font.title, fontSize: 14, color: color.text },
  smallText: { fontFamily: font.title, fontSize: 13, color: color.text },
  mutedText: { color: color.secondary },
  disabled: { opacity: 0.4 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontFamily: font.medium, fontSize: 13, color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },

  field: { gap: 6 },
  fieldLabel: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  input: { height: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center' },
  inputText: { fontFamily: font.text, fontSize: 15, color: color.text, height: '100%' },
  // A few lines (a note, a reason): the card's corner, since a pill can't grow taller.
  area: { height: undefined, minHeight: 96, paddingVertical: 12, borderRadius: RIM, justifyContent: 'flex-start' },
  areaText: { height: undefined, lineHeight: 21, textAlignVertical: 'top' },

  code: { gap: space.small + 4 },
  codeBox: { marginHorizontal: 20, height: 56, borderRadius: 28, justifyContent: 'center' },
  codeText: { height: '100%', fontFamily: font.price, fontSize: 24, letterSpacing: 12, color: color.text, textAlign: 'center' },
  codePair: { marginHorizontal: 20, flexDirection: 'row', justifyContent: 'center', gap: space.small },

  pageNote: { marginHorizontal: 20, marginTop: space.small, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  signIn: { gap: space.big },
});
