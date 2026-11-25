// The ticket scanner (Station take 2, approved 22 Nov 2026: https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 2).
// From the Event day doc (slots, decision 16) and the Play doc:
// - Scan opens the camera straight away, full screen: the X, the venue it scans for and the sound switch on top, Find
//   at the foot.
// - One result at a time slides up over the camera, its colour a dot and a glow, never the words: In and How many are
//   here? in Sage, Already in and Too early in amber, the rest in the app's red.
// - One station, or a pitch or court booked whole, is in on the scan. Several ask how many are here and let nobody in
//   until the tap (Event day decision 2); the rest come in on a second scan.
// - Each code is ignored for 2.5 seconds after it was last seen, so two tickets held up together don't take turns; a new
//   ticket replaces the result, but not while the desk is counting (How many). A haptic on every result:
//   success, warning (Already in, Too early) or error.
// - Find: name, phone, email or the 8-character code, from 2 letters. Without the camera it says how to allow it.
// - Find, then a booking, is the same as scanning its ticket.
// Not in 1.0 (ONE_0). Letting in is the API's Admit, as Check in on Today; a refusal shows on Today.
// ponytail: no sound yet (the switch is kept; the sounds come with expo-audio). The day has no ticket codes, so a scan
// finds nothing until the API looks tickets up; Find by name works on today's day. No Undo (the API has no un-admit),
// no log of Let in again, no offline saved list, no phone or email search.
import { DARK_TINT as DARK, Glass, useAccessibility } from '@orbit/mobile/glass';
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color, font, groundAt, space, stoneAt } from '@orbit/mobile/theme';
import { functional } from '@orbit/tokens';
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { admitTo, byCode, type Claim, door, MIN, type Scan as Result, scan, seenRecently, timeLabel } from '../station/day';
import { useStation } from '../station/state';
import { close, Pill, Round } from '../station/ui';
import { first, range, spaced, what } from '../station/words';

// ponytail: the iPhone's dark-mode orange, new with take 2 for Already in and Too early; a token if it spreads.
const AMBER = '#FF9F0A';
const toneOf = (k: Result['kind']) => (k === 'in' || k === 'ask' ? color.accent : k === 'already' || k === 'early' ? AMBER : functional.love);
const SAME_MS = 2500; // the same code, held up again within this, is ignored
const ICON = {
  close: require('../../assets/tabs/close.png'),
  find: require('../../assets/tabs/find.png'),
  sound: require('../../assets/tabs/sound.png'),
  mute: require('../../assets/tabs/mute.png'),
};

type Shown = { scan: Result; claim?: Claim; again?: boolean };

const feel = (k: Result['kind']) =>
  void Haptics.notificationAsync(
    k === 'in' || k === 'ask' ? Haptics.NotificationFeedbackType.Success : k === 'already' || k === 'early' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
  );

export default function Scanner() {
  const { venue: v, lookup, letIn } = useStation();
  const insets = useSafeAreaInsets();
  // Asked on the first open, so Scan goes straight to the camera; read again on coming back from Settings.
  const [perm, ask, get] = useCameraPermissions({ request: true });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void get());
    return () => sub.remove();
  }, [get]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [n, setN] = useState(1);
  const [finding, setFinding] = useState(false);
  const [sound, setSound] = useState(true);
  const seen = useRef(new Map<string, number>());

  // Have `total` of the booking in, from the booking as it was shown: a second tap asks for the same total, so it
  // counts once.
  const admitNow = (claim: Claim, total: number) => {
    letIn(claim.id, total);
    setShown({ scan: { kind: 'in', n: total - (claim.in ?? 0) }, claim: admitTo(claim, total, Date.now(), 'you') });
  };
  const show = (found: ReturnType<typeof lookup>) => {
    const r = scan(found, v, Date.now());
    feel(r.kind);
    setFinding(false);
    if (r.kind === 'in' && found) return admitNow(found.claim, (found.claim.in ?? 0) + r.n);
    if (r.kind === 'ask') setN(r.left);
    setShown({ scan: r, claim: found?.claim });
  };
  const onCode = ({ data }: BarcodeScanningResult) => {
    if (seenRecently(seen.current, data, Date.now(), SAME_MS)) return;
    if (shown?.claim && byCode([shown.claim], data)) return; // the ticket on the card, seen again
    show(lookup(data));
  };
  // Not while the desk counts heads: a ticket seen then would take the card from under their thumb.
  const listening = !finding && shown?.scan.kind !== 'ask';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {perm?.granted && (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={listening ? onCode : undefined} />
      )}
      <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
        <Circle label="Close" onPress={close}>
          <Image source={ICON.close} style={styles.close} />
        </Circle>
        <View style={styles.mid}>
          <Text style={styles.title}>Scan a ticket</Text>
          <Text style={styles.sub}>{v.name}</Text>
        </View>
        <Circle label="Sound" selected={sound} onPress={() => setSound(!sound)}>
          <Image source={sound ? ICON.sound : ICON.mute} style={[styles.mark, !sound && styles.dim]} />
        </Circle>
      </View>

      {perm && !perm.granted ? (
        <View style={styles.ask}>
          <OrbitSays
            title="The camera’s off"
            text="The scanner needs the camera to read tickets. You can still find people by name or code."
            answers={[perm.canAskAgain ? { label: 'Allow camera', onPress: () => void ask() } : { label: 'Open Settings', onPress: () => void Linking.openSettings() }]}
          />
        </View>
      ) : (
        <>
          <View style={styles.finder} pointerEvents="none">
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.br]} />
            <View style={[styles.corner, styles.bl]} />
          </View>
          <Text style={styles.hint}>Point at the QR on their ticket</Text>
        </>
      )}

      {!shown && !finding && (
        <Pressable onPress={() => setFinding(true)} accessibilityRole="button" style={({ pressed }) => [styles.findAt, { bottom: insets.bottom + 12 }, pressed && styles.pressed]}>
          <Glass tint={DARK} style={styles.findPill}>
            <Image source={ICON.find} style={styles.findMark} />
            <Text style={styles.findText}>Find by name or code</Text>
          </Glass>
        </Pressable>
      )}

      {finding ? (
        <Find top={insets.top + 64} onPick={(claim) => show({ claim, ours: true })} onClose={() => setFinding(false)} />
      ) : (
        shown && (
          <Card
            key={`${shown.claim?.id}:${shown.scan.kind}:${shown.claim?.in ?? 0}:${shown.again ? 1 : 0}`}
            shown={shown}
            n={n}
            onN={setN}
            onLetIn={() => shown.claim && admitNow(shown.claim, (shown.claim.in ?? 0) + n)}
            onAgain={() => setShown({ ...shown, again: true })}
            onNext={() => setShown(null)}
            onFind={() => {
              setShown(null);
              setFinding(true);
            }}
          />
        )
      )}
    </View>
  );
}

function Circle({ label, selected, onPress, children }: { label: string; selected?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} hitSlop={4}>
      <Glass tint={DARK} style={styles.circle}>
        {children}
      </Glass>
    </Pressable>
  );
}

// One result, sliding up over the camera with its colour as a dot and a glow.
function Card(p: {
  shown: Shown;
  n: number;
  onN: (n: number) => void;
  onLetIn: () => void;
  onAgain: () => void;
  onNext: () => void;
  onFind: () => void;
}) {
  const { venue: v } = useStation();
  const insets = useSafeAreaInsets();
  const still = useAccessibility('reduceMotionChanged');
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (still) rise.setValue(1);
    else Animated.timing(rise, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [rise, still]);
  // A card's buttons wait a moment, so the second half of a double tap on the last card's button lands on nothing.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 350);
    return () => clearTimeout(t);
  }, []);
  const tap = (f: () => void) => () => armed && f();
  const { scan: r, claim: c } = p.shown;
  const t = c && v.types.find((x) => x.id === c.type);
  const several = !!t && !!c && !t.whole && c.count > 1;
  const tone = toneOf(r.kind);
  let word = '';
  let line = '';
  if (r.kind === 'in' && c) {
    word = 'In';
    const inNow = c.in ?? 0;
    line = several ? `${first(c.who)}${inNow > 1 ? ` + ${inNow - 1}` : ''} · ${inNow} of ${c.count} in` : c.start < Date.now() ? `${first(c.who)} is in · ends at ${timeLabel(c.end)}, as booked` : `${first(c.who)} is in till ${timeLabel(c.end)}`;
  } else if (r.kind === 'ask' && c && t) {
    word = 'How many are here?';
    line = `${c.who} booked ${c.count} × ${t.name}${c.in ? ` · ${c.in} already in` : ''}`;
  } else if (r.kind === 'already') {
    word = 'Already in';
    line = `${several ? `All ${c?.count} in` : 'In'} · first at ${timeLabel(r.first)} by ${r.by ?? 'the desk'}${p.shown.again ? ' · let in again' : ''}`;
  } else if (r.kind === 'early') {
    word = 'Too early';
    line = `Starts ${timeLabel(r.starts)} · check-in opens at ${timeLabel(r.starts - 15 * MIN)}`;
  } else if (r.kind === 'ended' && c) {
    word = 'Ended';
    line = `It ended at ${timeLabel(c.end)}.`;
  } else if (r.kind === 'released') {
    word = 'Released';
    line = `Released as a no-show at ${timeLabel(r.at)}.`;
  } else if (r.kind === 'elsewhere') {
    word = 'Not for this venue';
    line = 'It’s a booking at another venue.';
  } else if (r.kind === 'refunded' && c) {
    word = 'Refunded';
    line = `${first(c.who)}’s booking was refunded.`;
  } else {
    word = 'Not an Orbit ticket';
    line = 'Find them by name or code instead.';
  }
  useEffect(() => AccessibilityInfo.announceForAccessibility(`${word}. ${line}`), [word, line]); // VoiceOver; TalkBack has the live region
  const button = (label: string, onPress: () => void) => (
    <View key={label} style={styles.grow}>
      <Pill wide label={label} onPress={tap(onPress)} />
    </View>
  );
  const next = button('Scan next', p.onNext);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.card, { bottom: 8, paddingBottom: Math.max(insets.bottom, space.big) }, { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}
    >
      <Glass style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.cardShade]} />
      <View pointerEvents="none" style={[styles.glow, { backgroundImage: `radial-gradient(closest-side, ${tone}, transparent)` }]} />
      <View style={styles.wordRow}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.word} accessibilityRole="header">
          {word}
        </Text>
      </View>
      <Text style={styles.line}>{line}</Text>
      {c && t && r.kind !== 'elsewhere' && (
        <Text style={styles.who}>
          <Text style={styles.whoName}>{c.who}</Text> · {what(v, c)} · {range(c.start, c.end)}
        </Text>
      )}
      {c?.code && r.kind !== 'unknown' && <Text style={styles.code}>{spaced(c.code)}</Text>}
      {r.kind === 'ask' && (
        <View style={styles.askRow}>
          <Text style={styles.askLabel}>Here now</Text>
          <View style={styles.stepper}>
            <Round glyph="−" label="Fewer here" disabled={p.n <= 1} onPress={tap(() => p.onN(p.n - 1))} />
            <Text style={styles.count}>{p.n}</Text>
            <Round glyph="+" label="More here" disabled={p.n >= r.left} onPress={tap(() => p.onN(p.n + 1))} />
          </View>
        </View>
      )}
      <View style={styles.actions}>
        {r.kind === 'ask' ? (
          button(`Let ${p.n} in`, p.onLetIn)
        ) : r.kind === 'already' ? (
          <>
            {button('Let in again', p.onAgain)}
            {next}
          </>
        ) : r.kind === 'unknown' ? (
          <>
            {button('Find', p.onFind)}
            {next}
          </>
        ) : (
          next
        )}
      </View>
    </Animated.View>
  );
}

// Find by name or the 8-character code, from 2 letters, among this venue's bookings.
function Find({ top, onPick, onClose }: { top: number; onPick: (c: Claim) => void; onClose: () => void }) {
  const { venue: v, claims, now } = useStation();
  const [q, setQ] = useState('');
  const k = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rows = k.length < 2 ? [] : claims.filter((c) => c.kind === 'booking' && (c.who?.toLowerCase().replace(/[^a-z0-9]/g, '').includes(k) || c.code?.toLowerCase().includes(k)));
  return (
    <View style={[styles.find, { top }]}>
      <Glass style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.cardShade]} />
      <View style={styles.findHead}>
        <View style={styles.grow}>
          <Text style={styles.findTitle} accessibilityRole="header">
            Find
          </Text>
          <Text style={styles.findNote}>Name or ticket code</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
          <Glass style={styles.x}>
            <Image source={ICON.close} style={styles.xMark} />
          </Glass>
        </Pressable>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        autoFocus
        autoCorrect={false}
        autoCapitalize="words"
        placeholder="Meera, or RZ7Q 2M9X"
        placeholderTextColor={color.secondary}
        accessibilityLabel="Find a booking"
        style={styles.search}
      />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.list}>
        {k.length < 2 ? (
          <OrbitSays top={0} text="Type 2 letters or more." />
        ) : rows.length === 0 ? (
          <OrbitSays top={0} text="No booking today by that name or code." />
        ) : (
          rows.map((c, i) => {
            const d = door(c, now);
            const where = { soon: 'Due later', open: 'Check-in open', late: 'Late', noShow: 'Late · can be released', here: (c.in ?? 0) < c.count ? `${c.in ?? 0} of ${c.count} in` : 'In', ended: 'Played', missed: 'Never came', released: 'Released' }[d];
            return (
              <Pressable key={c.id} onPress={() => onPick(c)} accessibilityRole="button" style={({ pressed }) => [styles.row, i > 0 && styles.rule, pressed && styles.pressed]}>
                <Text style={styles.rowName}>{c.who}</Text>
                <Text style={styles.rowMeta}>
                  {what(v, c)} · {range(c.start, c.end)}
                </Text>
                <Text style={styles.rowMeta}>{where}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const CORNER = 48;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  top: { position: 'absolute', top: 0, left: 20, right: 20, zIndex: 2, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mid: { flex: 1, alignItems: 'center', gap: 2 },
  title: { fontFamily: font.title, fontSize: 16, color: color.text },
  sub: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  close: { width: 14, height: 14, tintColor: color.text },
  mark: { width: 20, height: 20, tintColor: color.text },
  dim: { tintColor: color.secondary },
  ask: { position: 'absolute', top: '32%', left: 0, right: 0 },
  finder: { position: 'absolute', alignSelf: 'center', top: '30%', width: 240, height: 240 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: color.text },
  tl: { top: 0, left: 0, borderTopWidth: 3.5, borderLeftWidth: 3.5, borderTopLeftRadius: 26 },
  tr: { top: 0, right: 0, borderTopWidth: 3.5, borderRightWidth: 3.5, borderTopRightRadius: 26 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3.5, borderRightWidth: 3.5, borderBottomRightRadius: 26 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3.5, borderLeftWidth: 3.5, borderBottomLeftRadius: 26 },
  hint: { position: 'absolute', top: '30%', marginTop: 264, left: 0, right: 0, textAlign: 'center', fontFamily: font.medium, fontSize: 14, color: color.secondary },
  findAt: { position: 'absolute', alignSelf: 'center' },
  findPill: { height: 52, paddingLeft: 18, paddingRight: 24, borderRadius: 26, flexDirection: 'row', alignItems: 'center', gap: space.small, overflow: 'hidden' },
  findMark: { width: 18, height: 18, tintColor: color.text },
  findText: { fontFamily: font.price, fontSize: 14, color: color.text },
  card: { position: 'absolute', left: 8, right: 8, zIndex: 3, borderRadius: 38, overflow: 'hidden', paddingTop: 26, paddingHorizontal: 20, gap: space.small, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24) },
  cardShade: { backgroundColor: groundAt(0.74) },
  glow: { position: 'absolute', left: '-10%', right: '-10%', top: -150, height: 260, opacity: 0.42 },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  word: { flexShrink: 1, fontFamily: font.headline, fontSize: 26, lineHeight: 32, letterSpacing: -0.26, color: color.text },
  line: { fontFamily: font.medium, fontSize: 15, lineHeight: 21, color: color.text },
  who: { fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  whoName: { fontFamily: font.title, color: color.text },
  code: { fontFamily: font.price, fontSize: 14, letterSpacing: 2.5, color: color.secondary, fontVariant: ['tabular-nums'] },
  askRow: { marginTop: 6, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  askLabel: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  count: { minWidth: 18, textAlign: 'center', fontFamily: font.title, fontSize: 15, color: color.text, fontVariant: ['tabular-nums'] },
  actions: { marginTop: 10, flexDirection: 'row', gap: space.small },
  find: { position: 'absolute', left: 8, right: 8, bottom: 0, zIndex: 3, borderTopLeftRadius: 38, borderTopRightRadius: 38, overflow: 'hidden', paddingTop: 22, paddingHorizontal: 20, gap: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24) },
  findHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  findTitle: { fontFamily: font.headline, fontSize: 20, lineHeight: 26, color: color.text },
  findNote: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  x: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  xMark: { width: 12, height: 12, tintColor: color.text },
  search: { height: 44, borderRadius: 22, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.24), backgroundColor: stoneAt(0.08), color: color.text, fontFamily: font.text, fontSize: 15 },
  list: { paddingBottom: 40, marginHorizontal: -20 },
  row: { paddingVertical: 12, paddingHorizontal: 20, gap: 2 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.12) },
  rowName: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  rowMeta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
