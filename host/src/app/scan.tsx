// Event Partner's ticket scanner (X6), Station take 2's look (approved 22 Nov 2026:
// https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP, Take 2) on the X5 check-in API (api/src/checkin.ts). Opened from an
// open event's Scan or Find someone on Events, with the host and the event.
// - The camera full screen: the X, the event and how many are in of how many booked, and the sound switch on top; Find
//   at the foot.
// - One result at a time slides up over the camera, its colour a dot and a glow: In and How many are here? in Sage,
//   Already in and Too early in amber, the rest in the app's red. A haptic on every result.
// - A ticket for one is in on the scan, with Undo for 5 seconds. A group asks how many are here and lets nobody in until
//   the tap. If another door moved the count meanwhile (409 `changed`), the card shows the fresh count and asks again.
// - The same code, seen again within 2.5 seconds, is ignored (station/day.ts seenRecently); no new ticket replaces the
//   card while it's counting heads, Undo is up or a request is out.
// - Find: name, or a whole phone number, email or the code, from 2 characters; a row lets them in (a group asks how
//   many) or undoes one.
// ponytail: no sound yet (the switch is kept; the sounds come with expo-audio), and no offline list: the door needs the
// API. Admins only, as Event Partner is; Crew scans in the Crew app.
import type { DoorGuest, DoorGuests, ScanResult } from '@orbit/contract';
import type { Result } from '@orbit/mobile/api';
import { DARK_TINT as DARK, Glass, useAccessibility } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color, font, groundAt, space, stoneAt } from '@orbit/mobile/theme';
import { functional } from '@orbit/tokens';
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bump, fresh, fromScan, inLine, left, nameOf, refused, type Shown, stateLine } from '../launch/door';
import { api } from '../session';
import { seenRecently, timeLabel } from '../station/day';
import { Pill, Round } from '../station/ui';

// ponytail: the iPhone's dark-mode orange, new with take 2 for Already in and Too early; a token if it spreads.
const AMBER = '#FF9F0A';
const toneOf = (s: Shown) => (s.kind === 'in' || s.kind === 'ask' ? color.accent : s.kind === 'already' || (s.kind === 'no' && s.amber) ? AMBER : functional.love);
const SAME_MS = 2500;
const UNDO_S = 5;
const ICON = {
  close: require('../../assets/tabs/close.png'),
  find: require('../../assets/tabs/find.png'),
  sound: require('../../assets/tabs/sound.png'),
  mute: require('../../assets/tabs/mute.png'),
};
type Counts = { booked: number; in: number };
type Failed = { ok: false; error: { error: string; message: string; guest?: DoorGuest } };

const feel = (s: Shown) =>
  void Haptics.notificationAsync(
    s.kind === 'in' || s.kind === 'ask' ? Haptics.NotificationFeedbackType.Success : toneOf(s) === AMBER ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
  );
const close = () => (router.canGoBack() ? router.back() : router.replace('/events'));

export default function Scanner() {
  const p = useLocalSearchParams<{ hostId: string; eventId: string; title?: string; find?: string }>();
  const base = `/hosts/${p.hostId}`;
  const insets = useSafeAreaInsets();
  // Asked on the first open, so Scan goes straight to the camera; read again on coming back from Settings.
  const [perm, ask, get] = useCameraPermissions({ request: true });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void get());
    return () => sub.remove();
  }, [get]);
  const [shown, setShown] = useState<(Shown & { text?: string; seq: number }) | null>(null);
  const [n, setN] = useState(1);
  const [undo, setUndo] = useState<number | null>(null);
  const [finding, setFinding] = useState(p.find === '1');
  const [sound, setSound] = useState(true);
  const seen = useRef(new Map<string, number>());
  const busy = useRef(false);
  const seq = useRef(0);

  // The counts: read on open and with every Find, moved by each admit and undo here in between.
  const load = useLoad<DoorGuests>(p.eventId ? `door|${p.eventId}` : null, () => api.authed<DoorGuests>('GET', `${base}/events/${p.eventId}/guests`));
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    if (load.data) setCounts({ booked: load.data.booked, in: load.data.in });
  }, [load.data]);
  const moved = (from: number, to: number) => setCounts((c) => c && bump(c, from, to));

  useEffect(() => {
    if (undo === null) return;
    const tick = setTimeout(() => setUndo((u) => (u !== null && u > 1 ? u - 1 : null)), 1000);
    return () => clearTimeout(tick);
  }, [undo]);

  // One request at a time: a second scan or tap while one is out is dropped.
  const once = async <T,>(f: () => Promise<Result<T>>) => {
    if (busy.current) return null;
    busy.current = true;
    try {
      return await f();
    } finally {
      busy.current = false;
    }
  };
  const present = (s: Shown, text?: string) => {
    feel(s);
    setFinding(false);
    setUndo(s.kind === 'in' ? UNDO_S : null);
    if (s.kind === 'ask') setN(left(s.guest));
    setShown({ ...s, text, seq: ++seq.current });
  };
  // A 409 `changed` carries the guest as it is now: ask again. Anything else is a refusal with the API's words.
  const failed = (r: Failed) => {
    if (r.error.error === 'changed' && r.error.guest) {
      load.reload();
      return present(fresh(r.error.guest, true));
    }
    present(refused(r.error.error, r.error.message));
  };

  const onCode = async ({ data }: BarcodeScanningResult) => {
    if (seenRecently(seen.current, data, Date.now(), SAME_MS)) return;
    if (shown?.text === data) return; // the ticket on the card, seen again
    const r = await once(() => api.authed<ScanResult>('POST', `${base}/check-in/scan`, { eventId: p.eventId, text: data }));
    if (!r) return;
    if (!r.ok) return failed(r);
    const s = fromScan(r.data);
    if (s.kind === 'in') moved(s.before, s.guest.admitted);
    present(s, data);
  };
  // Have `count` more of a ticket in, from the count the door last saw.
  const admit = async (g: DoorGuest, count: number) => {
    const r = await once(() => api.authed<DoorGuest>('POST', `${base}/check-in/${g.id}/admit`, { from: g.admitted, total: g.admitted + count }));
    if (!r) return;
    if (!r.ok) return failed(r);
    moved(g.admitted, r.data.admitted);
    present({ kind: 'in', guest: r.data, before: g.admitted });
  };
  const undoIn = async (s: Extract<Shown, { kind: 'in' }>) => {
    const r = await once(() => api.authed<DoorGuest>('POST', `${base}/check-in/${s.guest.id}/undo`, { from: s.guest.admitted, total: s.before }));
    if (!r) return;
    if (!r.ok) return failed(r);
    moved(s.guest.admitted, r.data.admitted);
    setUndo(null);
    setShown(null);
  };
  // Find, then a ticket: the one for one is let in, a group asked how many, a full one Already in.
  const pick = (g: DoorGuest) => (g.quantity === 1 && g.admitted === 0 ? void admit(g, 1) : present(fresh(g)));
  const next = () => {
    setUndo(null);
    setShown(null);
  };

  const listening = !finding && shown?.kind !== 'ask' && undo === null;

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
          {!!p.title && (
            <Text style={styles.sub} numberOfLines={1}>
              {p.title}
            </Text>
          )}
          {counts && <Text style={styles.sub}>{`${counts.in} of ${counts.booked} in`}</Text>}
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
            <Text style={styles.findText}>Find someone</Text>
          </Glass>
        </Pressable>
      )}

      {finding ? (
        <Find
          top={insets.top + 80}
          path={`${base}/events/${p.eventId}/guests`}
          undoPath={(id) => `${base}/check-in/${id}/undo`}
          onCounts={setCounts}
          onPick={pick}
          onClose={() => setFinding(false)}
        />
      ) : (
        shown && (
          <Card
            key={shown.seq}
            shown={shown}
            n={n}
            onN={setN}
            undo={undo ?? undefined}
            onUndo={() => shown.kind === 'in' && void undoIn(shown)}
            onLetIn={() => shown.kind === 'ask' && void admit(shown.guest, n)}
            onNext={next}
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
function Card(p: { shown: Shown; n: number; onN: (n: number) => void; undo?: number; onUndo: () => void; onLetIn: () => void; onNext: () => void; onFind: () => void }) {
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
  const s = p.shown;
  const tone = toneOf(s);
  let word: string;
  let line: string;
  if (s.kind === 'in') {
    word = 'In';
    line = inLine(s.guest);
  } else if (s.kind === 'ask') {
    word = 'How many are here?';
    line = `${nameOf(s.guest)} booked ${s.guest.quantity}${s.guest.admitted ? ` · ${s.guest.admitted} already in` : ''}${s.again ? ' · changed at another door' : ''}`;
  } else if (s.kind === 'already') {
    const at = s.guest.checkedInAt ? ` · first at ${timeLabel(Date.parse(s.guest.checkedInAt))}` : '';
    word = 'Already in';
    line = `${nameOf(s.guest)} · ${s.guest.quantity > 1 ? `All ${s.guest.quantity} in` : 'In'}${at}${s.by ? ` by ${s.by}` : ''}`;
  } else {
    word = s.word;
    line = s.message;
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
      {s.kind === 'ask' && (
        <View style={styles.askRow}>
          <Text style={styles.askLabel}>Here now</Text>
          <View style={styles.stepper}>
            <Round glyph="−" label="Fewer here" disabled={p.n <= 1} onPress={tap(() => p.onN(p.n - 1))} />
            <Text style={styles.count}>{p.n}</Text>
            <Round glyph="+" label="More here" disabled={p.n >= left(s.guest)} onPress={tap(() => p.onN(p.n + 1))} />
          </View>
        </View>
      )}
      <View style={styles.actions}>
        {s.kind === 'ask' ? (
          <>
            {button(`Let ${p.n} in`, p.onLetIn)}
            {next}
          </>
        ) : s.kind === 'in' ? (
          <>
            {next}
            {p.undo !== undefined && button(`Undo · ${p.undo}`, p.onUndo)}
          </>
        ) : s.kind === 'no' && s.find ? (
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

// Find by part of a name, or a whole phone number, email or code, from 2 characters, among the event's bookings. A row
// opens as a scan of it would; Undo takes one back out.
function Find(p: {
  top: number;
  path: string;
  undoPath: (id: string) => string;
  onCounts: (c: Counts) => void;
  onPick: (g: DoorGuest) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const load = useLoad<DoorGuests>(term.length >= 2 ? `find|${p.path}|${term}` : null, () => api.authed<DoorGuests>('GET', `${p.path}?q=${encodeURIComponent(term)}`), { keep: true });
  const { onCounts } = p;
  useEffect(() => {
    if (load.data) onCounts({ booked: load.data.booked, in: load.data.in });
  }, [load.data, onCounts]);
  // A row undone here shows its new count until the next search.
  const [patch, setPatch] = useState<Record<string, DoorGuest>>({});
  const [error, setError] = useState<string | null>(null);
  const undoOne = async (g: DoorGuest) => {
    setError(null);
    const r = await api.authed<DoorGuest>('POST', p.undoPath(g.id), { from: g.admitted, total: g.admitted - 1 });
    const now = r.ok ? r.data : (r.error as Failed['error']).guest;
    if (now) setPatch((x) => ({ ...x, [g.id]: now }));
    if (!r.ok) setError(r.error.message);
    else load.reload(); // the counts
  };
  const rows = term.length < 2 ? [] : (load.data?.guests ?? []).map((g) => patch[g.id] ?? g);
  return (
    <View style={[styles.find, { top: p.top }]}>
      <Glass style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.cardShade]} />
      <View style={styles.findHead}>
        <View style={styles.grow}>
          <Text style={styles.findTitle} accessibilityRole="header">
            Find someone
          </Text>
          <Text style={styles.findNote}>Name, phone, email or ticket code</Text>
        </View>
        <Pressable onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
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
      {(error ?? (term.length >= 2 && load.error?.message)) && <Text style={styles.err}>{error ?? load.error?.message}</Text>}
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.list}>
        {q.trim().length < 2 ? (
          <OrbitSays top={0} text="Type 2 letters or more." />
        ) : load.data && rows.length === 0 && term === q.trim() ? (
          <OrbitSays top={0} text="No booking by that name, number or code." />
        ) : (
          rows.map((g, i) => (
            <View key={g.id} style={[styles.row, i > 0 && styles.rule]}>
              <View style={styles.grow}>
                <Text style={styles.rowName}>{nameOf(g)}</Text>
                <Text style={styles.rowMeta}>
                  {g.quantity > 1 ? `${g.quantity} tickets · ` : ''}
                  {stateLine(g)}
                </Text>
              </View>
              {g.admitted > 0 && <Pill label="Undo" spoken={`Undo one for ${nameOf(g)}`} onPress={() => void undoOne(g)} />}
              {left(g) > 0 && <Pill label="Admit" spoken={`Admit ${nameOf(g)}`} onPress={() => p.onPick(g)} />}
            </View>
          ))
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
  err: { fontFamily: font.medium, fontSize: 14, color: functional.love },
  list: { paddingBottom: 40, marginHorizontal: -20 },
  row: { paddingVertical: 12, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.12) },
  rowName: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  rowMeta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
