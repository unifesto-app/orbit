// Orbit Launch's parts, drawn as the Orbit app draws its own (Events take 1, approved 22 Nov 2026:
// https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg): outlined Charcoal cards holding text, a poster and frosted pills,
// never icons (a > on a row that opens is the one mark), section titles, text-only tags, and the host's own colour
// glowing from the top of a tab.
// ponytail: Station has its own parts (host/src/station/ui.tsx); pull the shared ones into one host kit once both land.
import { DARK_TINT, Glass } from '@orbit/mobile/glass';
import { color, font, radius, space, stoneAt } from '@orbit/mobile/theme';
import { Children, Fragment, type ReactNode } from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Host } from './data';

const PAD = 16; // a text card's padding (owner, 19 Nov 2026: "remember for cards add proper padding")
const EDGE = 1; // its outline
const CARD = radius.sm + PAD + EDGE; // corners nest outward from the poster's 6
const POSTER = 72; // 3:4, so 96 tall
export const CHEVRON = require('../../assets/tabs/chevron.png');
export const CARET = require('../../assets/tabs/caret.png');
const GLOW = require('../../assets/tabs/glow.png');

/** The host's colour from the top of the screen, fading into the page by 320pt: a wash behind the page, never text. */
export function Glow({ tint }: { tint: string }) {
  return <Image source={GLOW} resizeMode="stretch" tintColor={tint} style={styles.glow} accessible={false} />;
}

/** A host's 1:1 logo: its monogram on its colour, a rounded square. */
export function Monogram({ host, size }: { host: Host; size: number }) {
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

/** One line in a card: a label, a grey value, a control, and a > when the whole row opens something. */
export function Row({ label, value, right, onPress }: { label: string; value?: string; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.label}>{label}</Text>
      {value !== undefined && (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {right}
      {onPress && <Image source={CHEVRON} style={styles.chevron} />}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={{ top: PAD / 2, bottom: PAD / 2 }} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}

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
  sold?: string; // "31 of 40 sold · ₹9,269"
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
  row: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: space.small },
  label: { flex: 1, fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  value: { maxWidth: '50%', fontFamily: font.text, fontSize: 14, color: color.secondary },
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
