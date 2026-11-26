// Orbit Launch's parts, drawn as the Orbit app draws its own (Events take 1, approved 22 Nov 2026:
// https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg): outlined Charcoal cards holding text, a poster and frosted pills,
// never icons (a > on a row that opens is the one mark), section titles, text-only tags, and the host's own colour
// glowing from the top of a tab.
// ponytail: Station has its own parts (host/src/station/ui.tsx); pull the shared ones into one host kit once both land.
import { DARK_TINT, Glass } from '@orbit/mobile/glass';
import { color, font, radius, space, stoneAt } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { Children, Fragment, type ReactNode } from 'react';
import { Image, type ImageSourcePropType, Pressable, type StyleProp, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';

import { useSession } from '../session';
import { adminHosts, type Host } from './host';

const PAD = 16; // a text card's padding (owner, 19 Nov 2026: "remember for cards add proper padding")
const EDGE = 1; // its outline
const CARD = radius.sm + PAD + EDGE; // corners nest outward from the poster's 6
const POSTER = 72; // 3:4, so 96 tall
const CHEVRON = require('../../assets/tabs/chevron.png');
const EXTERNAL = require('../../assets/tabs/external.png');
const VERIFIED = require('../../assets/tabs/verified.png');
const CARET = require('../../assets/tabs/caret.png');
const GLOW = require('../../assets/tabs/glow.png');

/** The host's colour from the top of the screen, fading into the page by 320pt: a wash behind the page, never text. */
export function Glow({ tint }: { tint: string }) {
  return <Image source={GLOW} resizeMode="stretch" tintColor={tint} style={styles.glow} accessible={false} />;
}

/** A host's 1:1 logo: its monogram on its colour, a rounded square. */
export function Monogram({ host, size }: { host: Pick<Host, 'initials' | 'bg' | 'fg'>; size: number }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, backgroundColor: host.bg }]}>
      <Text style={[styles.monogramText, { color: host.fg, fontSize: Math.round(size * 0.4) }]}>{host.initials}</Text>
    </View>
  );
}

export function Section({ title }: { title: string }) {
  return (
    <Text style={styles.h2} accessibilityRole="header">
      {title}
    </Text>
  );
}

export function Tag({ text }: { text: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

/** Every button: frosted glass, a Stone label, fully round. Small is the 32pt pill on cards; `dark` floats over the page. */
export function Pill({ label, onPress, dark = false }: { label: string; onPress?: () => void; dark?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
      <Glass tint={dark ? DARK_TINT : undefined} style={styles.pill}>
        <Text style={styles.pillText}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

/** The wide button a step ends with (Continue): frosted, 50 tall, across the page's margins. Faded while it can't go. */
export function Wide({ label, onPress, disabled = false, muted = false }: { label: string; onPress: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={({ pressed }) => [disabled && styles.off, pressed && styles.pressed]}>
      <Glass style={styles.wide}>
        <Text style={[styles.wideText, muted && styles.mutedText]}>{label}</Text>
      </Glass>
    </Pressable>
  );
}

/** A labelled field: the label small and grey above a 44 pill, or a 56 one for a code (`code`). */
export function Field({ label, code = false, ...input }: TextInputProps & { label: string; code?: boolean }) {
  return (
    <View style={styles.field}>
      {!code && <Text style={styles.fieldLabel}>{label}</Text>}
      <Glass style={code ? styles.codeBox : styles.input}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={color.secondary}
          selectionColor={color.accent}
          style={[styles.inputText, code && styles.codeText]}
          {...input}
        />
      </Glass>
    </View>
  );
}

/** The top of every Launch tab: the host switcher (its logo, name and caret, the caret only with several), and a control on the right. */
export function HostHead({ host, right }: { host: Host; right?: ReactNode }) {
  const session = useSession();
  const several = !!session && adminHosts(session.me).length > 1;
  return (
    <View style={styles.hostHead}>
      <Pressable
        style={styles.switcher}
        onPress={several ? () => router.push('/pick') : undefined}
        accessibilityRole={several ? 'button' : 'header'}
        accessibilityLabel={several ? `${host.name}. Switch host` : host.name}
      >
        <Monogram host={host} size={32} />
        <Text style={styles.hostName} numberOfLines={1}>
          {host.name}
        </Text>
        {several && <Image source={CARET} style={styles.caret} />}
      </Pressable>
      {right}
    </View>
  );
}

/** Grey words under a card, as a note on what it holds. */
export function Note({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>;
}

/** A person's round initials (people are circles, hosts rounded squares); your own on Forest, as in the Orbit app. */
export function Person({ initials, you = false, waiting = false }: { initials?: string; you?: boolean; waiting?: boolean }) {
  return (
    <View style={[styles.person, you && styles.personYou, waiting && styles.personWaiting]}>
      {initials && <Text style={styles.personText}>{initials}</Text>}
    </View>
  );
}

/** The host's verified tick, as the Orbit app's: the Sage seal over a Stone disc. */
export function Verified({ size = 18 }: { size?: number }) {
  return (
    <View style={[styles.verified, { width: size, height: size }]} accessible accessibilityRole="image" accessibilityLabel="Verified">
      <View style={[styles.verifiedDisc, { width: size / 2, height: size / 2, borderRadius: size / 4 }]} />
      <Image source={VERIFIED} style={{ width: size, height: size, tintColor: color.accent }} />
    </View>
  );
}

/**
 * One line in a card: a label (with a grey `note` under it), a value (grey, or Stone when `strong`), a control, and a >
 * when the whole row opens something, or a ↗ when it opens the web (`external`). `lead` sits before the label (a
 * person's initials). `dot` puts the accent's dot before the value, for a state that's good (a verified bank account).
 * A row reads as one to a screen reader, unless it holds a control of its own; `spoken` replaces what it reads.
 */
export function Row({
  label,
  note,
  lead,
  value,
  strong = false,
  dot = false,
  right,
  onPress,
  external = false,
  plain = false,
  spoken,
}: {
  label: string;
  note?: string;
  lead?: ReactNode;
  value?: string;
  strong?: boolean;
  dot?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  external?: boolean;
  plain?: boolean; // an action done right here (Sign out): no > after it
  spoken?: string;
}) {
  const body = (
    <>
      {lead}
      {note ? (
        <View style={styles.lines2}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowNote}>{note}</Text>
        </View>
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      {dot && <View style={styles.dot} />}
      {value !== undefined && (
        <Text style={[styles.value, strong && styles.strong]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
      {onPress && !plain && <Image source={external ? EXTERNAL : CHEVRON} style={styles.chevron} />}
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={spoken}
      hitSlop={{ top: PAD / 2, bottom: PAD / 2 }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.row} accessible={!right} accessibilityLabel={spoken}>
      {body}
    </View>
  );
}

/**
 * A card of rows between hairlines (Money's numbers, its commission, the bank account). `indent` starts the hairlines
 * where the words do, past a row's `lead` (the Admins' initials), as in iOS Settings.
 */
export function Card({ children, style, indent = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; indent?: number }) {
  const rows = Children.toArray(children); // drops the false and null of rows shown only sometimes
  return (
    <View style={[styles.card, style]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={[styles.hairline, { marginLeft: indent }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}
export const PERSON_INDENT = 32 + 12; // a Person and the row's gap after it

/** One event on Events, holding its own work: the poster and how it's selling, then a row per thing to do on it. */
export function EventCard({
  title,
  poster,
  when,
  tag,
  sold,
  share,
  right,
  children,
}: {
  title: string;
  poster?: ImageSourcePropType; // a draft has none yet, so a blank stands in
  when?: string;
  tag?: string; // the repeat tag
  sold?: string; // "31 of 40 sold · ₹9,269", or Money's "Your earnings ₹9,269"
  share?: number; // 0 to 1, drawn under `sold` in the accent (an element, never text)
  right?: ReactNode; // a control beside the head (a draft's Continue)
  children?: ReactNode;
}) {
  const rows = Children.toArray(children); // drops the false and null of rows shown only sometimes
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        {poster ? <Image source={poster} style={styles.poster} alt={`Poster for ${title}`} /> : <View style={styles.poster} />}
        <View style={styles.lines}>
          {(when || tag) && (
            <View style={styles.whenRow}>
              {when && <Text style={styles.meta}>{when}</Text>}
              {tag && <Tag text={tag} />}
            </View>
          )}
          <Text style={styles.title}>{title}</Text>
          {sold && <Text style={styles.meta}>{sold}</Text>}
          {share !== undefined && (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(1, share) * 100}%` }]} />
            </View>
          )}
        </View>
        {right}
      </View>
      {rows.map((row, i) => (
        <Fragment key={i}>
          <View style={[styles.hairline, i === 0 && styles.firstLine]} />
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  pageTitle: { marginHorizontal: 20, fontFamily: font.headline, fontSize: 30, lineHeight: 36, letterSpacing: -0.3, color: color.text },
  pressed: { opacity: 0.7 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, width: '100%', height: 320 },
  monogram: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: font.headline },
  h2: { marginTop: space.big, marginBottom: 16, marginHorizontal: 20, fontFamily: font.headline, fontSize: 18, color: color.text },
  tag: { minHeight: 22, paddingHorizontal: 8, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: color.raised, justifyContent: 'center' },
  tagText: { fontFamily: font.medium, fontSize: 12, color: color.text },
  pill: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  pillText: { fontFamily: font.title, fontSize: 13, color: color.text },
  off: { opacity: 0.4 },
  wide: { height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  wideText: { fontFamily: font.title, fontSize: 14, color: color.text },
  mutedText: { color: color.secondary },
  field: { gap: 6 },
  fieldLabel: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  input: { height: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', overflow: 'hidden' },
  codeBox: { height: 56, paddingHorizontal: 16, borderRadius: 28, justifyContent: 'center', overflow: 'hidden' },
  inputText: { height: '100%', fontFamily: font.text, fontSize: 15, color: color.text },
  codeText: { fontFamily: font.price, fontSize: 24, letterSpacing: 12, textAlign: 'center' },
  row: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: space.small },
  label: { flex: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  lines2: { flex: 1, gap: 2 }, // a label and its note
  rowLabel: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  rowNote: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  // 32 round, then 12 to the words (the row's 8 and 4 more), as PERSON_INDENT counts.
  person: { width: 32, height: 32, marginRight: 4, borderRadius: 16, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  personYou: { backgroundColor: color.fill }, // Forest is for your own
  personWaiting: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: stoneAt(0.32) },
  personText: { fontFamily: font.headline, fontSize: 12, color: color.text },
  verified: { alignItems: 'center', justifyContent: 'center' },
  verifiedDisc: { position: 'absolute', backgroundColor: color.text },
  value: { maxWidth: '60%', fontFamily: font.text, fontSize: 14, color: color.secondary },
  strong: { color: color.text },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent }, // an element, so the accent is allowed
  note: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  hostHead: { height: 44, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  switcher: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.small },
  hostName: { flexShrink: 1, fontFamily: font.title, fontSize: 17, color: color.text },
  caret: { width: 14, height: 14, tintColor: color.secondary },
  chevron: { width: 14, height: 14, tintColor: color.secondary },
  card: { marginHorizontal: 20, padding: PAD, borderRadius: CARD, borderWidth: EDGE, borderColor: color.border, backgroundColor: color.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  poster: { width: POSTER, height: (POSTER * 4) / 3, borderRadius: radius.sm, backgroundColor: color.raised },
  lines: { flex: 1, minWidth: 0, gap: 3 },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.small },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  title: { fontFamily: font.title, fontSize: 17, lineHeight: 22, color: color.text },
  track: { marginTop: 4, height: 6, borderRadius: 3, backgroundColor: color.track, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: PAD / 2, backgroundColor: stoneAt(0.12) },
  firstLine: { marginTop: PAD }, // the head sits a full padding above the first hairline
});
