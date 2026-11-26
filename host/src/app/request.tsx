// The Event Request's three steps, from welcome (take 1, approved 26 Nov 2026: docs/context/artifacts/
// event-request-take1.html): the host, its first event (a Venue or Performer may skip it), then check and send
// (POST /event-requests, or PATCH /me/event-request when Orbit asked for changes). `?mode=see` shows a sent request
// read-only; `?mode=edit` reopens it to change. The rules and words are in src/launch/request.ts.
// What's typed stays on this phone until it's sent, under one Keychain key (REQUEST_DRAFT), for the account that typed
// it (and, for an edit, that round of changes), gone on sign-out. A write that fails deletes the key, so an older draft
// never comes back. It's kept a moment after each change, and at once when the screen goes away.
import { allCities, categories, type EventRequest, HOST_KINDS, type RequestStatus, popularCities, searchCities } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color, font, space, stoneAt } from '@orbit/mobile/theme';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, BackHandler, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { istDate } from '../launch/money';
import {
  atIst,
  bodyOf,
  canSkip,
  type Draft,
  dayName,
  dayOpen,
  editDraft,
  errorText,
  fromRequest,
  monthDays,
  monthLabel,
  newDraft,
  partsOf,
  readDraft,
  shiftMonth,
  slots,
  stepOk,
  stepWhy,
  timeLabel,
  whenLabel,
} from '../launch/request';
import { Field, Note, Pill, Section, Wide, styles as ui } from '../launch/ui';
import { api, kept, REQUEST_DRAFT, useSession } from '../session';

const CHEVRON = require('../../assets/tabs/chevron.png');
const KINDS = Object.entries(HOST_KINDS);
const kindOf = (k: string | null) => (k ? (HOST_KINDS as Record<string, string>)[k] ?? k : '');
const categoryOf = (slug: string | null) => categories.find((c) => c.slug === slug)?.label ?? '';

export default function Request() {
  const mode = useLocalSearchParams<{ mode?: string }>().mode;
  const me = useSession()?.me;
  // Read once: the screen saves into the same key while it's open.
  const [saved] = useState(() => (me ? readDraft(kept.get(REQUEST_DRAFT), me.id) : null));
  const load = mode === 'see' || mode === 'edit';
  const sent = useLoad<EventRequest | null>(load && me ? `request|${me.id}` : null, () => api.authed('GET', '/me/event-request'));
  const gone = load && !sent.loading && !sent.error && !sent.data;
  useEffect(() => {
    if (gone) router.back(); // nothing to see or edit: welcome shows what's there
  }, [gone]);
  if (!me) return null;

  if (load) {
    if (!sent.data)
      return (
        <Frame step={null} onBack={() => router.back()}>
          {sent.error ? (
            <>
              <Note live>{sent.error.message}</Note>
              <View style={s.retry}>
                <Pill label="Try again" onPress={sent.reload} />
              </View>
            </>
          ) : (
            <ActivityIndicator style={s.spinner} color={color.secondary} accessibilityLabel="Loading your request" />
          )}
        </Frame>
      );
    if (mode === 'see') return <Steps initial={fromRequest(sent.data, false, me.id)} see={sent.data.status} />;
    if (sent.data.status !== 'changes')
      return (
        <Frame step={null} onBack={() => router.back()}>
          <Note live>{errorText({ error: 'notChanges', message: '' })}</Note>
        </Frame>
      );
    return <Steps initial={editDraft(saved, sent.data, me.id)} />;
  }
  const city = me.city && allCities.some((c) => c.name === me.city) ? me.city : null;
  return <Steps initial={newDraft(saved, me.id, city)} />;
}

// What a sent request's own screen says under its title, by where it stands.
const SEE_LINE: Record<RequestStatus, string> = {
  open: 'Orbit is checking it, usually within a day.',
  changes: 'Orbit asked for a change before your host goes live.',
  declined: 'Orbit didn’t approve this one.',
  approved: 'Approved.',
  withdrawn: 'You withdrew this request.',
};

// `see`: a sent request, read-only, with where it stands.
function Steps({ initial, see = null }: { initial: Draft; see?: RequestStatus | null }) {
  const [d, setD] = useState(initial);
  const [step, setStep] = useState<1 | 2 | 3>(see ? 3 : 1);
  const [sheet, setSheet] = useState<'city' | 'when' | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const sending = useRef(false); // a second tap before the first answer sends nothing
  const sentOk = useRef(false);
  const put = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const now = Date.now();
  const ok = stepOk(d, step, now);
  const why = step === 2 ? stepWhy(d, now) : null;

  // Kept a moment after each change, not on every keystroke; at once when the screen goes or loses focus.
  const latest = useRef(d);
  latest.current = d;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(() => {
    timer.current = null;
    if (!see && !sentOk.current) kept.set(REQUEST_DRAFT, JSON.stringify(latest.current), { orDrop: true });
  }, [see]);
  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    save();
  }, [save]);
  useEffect(() => {
    if (see) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 400);
  }, [d, see, save]);
  useEffect(() => flush, [flush]);

  // Android's back goes a step back, and leaves only from the first step (or a sent request's screen).
  const at = useRef(step);
  at.current = step;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (see || at.current === 1) return false;
        setStep(at.current === 3 ? 2 : 1);
        return true;
      });
      return () => {
        sub.remove();
        flush();
      };
    }, [see, flush]),
  );

  async function send() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const r = await api.authed<EventRequest>(d.edit ? 'PATCH' : 'POST', d.edit ? '/me/event-request' : '/event-requests', bodyOf(d));
    setBusy(false);
    sending.current = false;
    if (!r.ok) {
      const text = errorText(r.error);
      setSaid(text);
      if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
      return;
    }
    sentOk.current = true;
    if (timer.current) clearTimeout(timer.current);
    kept.set(REQUEST_DRAFT, null);
    router.back(); // welcome reads the request again, showing no card until it's in
  }

  const head = {
    1: ['Who’s hosting?', 'Your club, group, venue or you. People see this name on every event.'],
    2: ['Your first event', 'A rough plan is enough. You’ll finish it as a draft once you’re live.'],
    3: see ? ['Your request', SEE_LINE[see]] : ['Check and send', 'Orbit checks it, usually within a day. We’ll tell you by notification and email.'],
  }[step];

  const foot =
    step === 3 ? (
      see ? null : (
        <Wide label={busy ? 'Sending…' : 'Send request'} disabled={!ok || busy} onPress={() => void send()} />
      )
    ) : (
      <>
        <Wide
          label="Continue"
          disabled={!ok}
          onPress={() => {
            if (step === 2) put({ skip: false });
            setStep(step === 1 ? 2 : 3);
          }}
        />
        {step === 2 && canSkip(d) && (
          <Pressable
            onPress={() => {
              put({ skip: true });
              setStep(3);
            }}
            accessibilityRole="button"
            style={({ pressed }) => [s.link, pressed && ui.pressed]}
          >
            <Text style={s.linkText}>Skip, no event yet</Text>
          </Pressable>
        )}
      </>
    );

  return (
    <Frame step={see ? null : step} onBack={() => (see || step === 1 ? router.back() : setStep(step === 3 ? 2 : 1))} foot={foot}>
      <Text style={s.title} accessibilityRole="header">
        {head[0]}
      </Text>
      <Text style={s.line}>{head[1]}</Text>

      {step === 1 && (
        <View style={s.fields}>
          <Field label="Name" value={d.name} onChangeText={(name) => put({ name })} placeholder="Punchline Comedy" autoCapitalize="words" maxLength={100} />
          <Label text="Kind">
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Kind">
              {KINDS.map(([k, label]) => (
                <Chip key={k} label={label} on={d.kind === k} onPress={() => put({ kind: k })} />
              ))}
            </View>
          </Label>
          <Label text="City">
            <Opens label="City" value={d.city} placeholder="Pick your city" onPress={() => setSheet('city')} />
          </Label>
          <Label text="About" optional>
            <Glass style={s.area}>
              <TextInput
                accessibilityLabel="About"
                value={d.about}
                onChangeText={(about) => put({ about })}
                placeholder="What you run, who comes"
                placeholderTextColor={color.secondary}
                selectionColor={color.accent}
                style={s.areaText}
                multiline
                maxLength={2000}
              />
            </Glass>
          </Label>
        </View>
      )}

      {step === 2 && (
        <View style={s.fields}>
          <Field label="Title" value={d.title} onChangeText={(title) => put({ title })} placeholder="Open Mic Friday" autoCapitalize="words" maxLength={120} />
          <Label text="Category">
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Category">
              {categories.map((c) => (
                <Chip key={c.slug} label={c.label} on={d.category === c.slug} onPress={() => put({ category: c.slug })} />
              ))}
            </View>
          </Label>
          <Label text="When">
            <Opens label="When" value={d.startsAt && whenLabel(d.startsAt)} placeholder="Pick a day and time" onPress={() => setSheet('when')} />
          </Label>
          <Field label="Where · optional" value={d.venue} onChangeText={(venue) => put({ venue })} placeholder="Venue name or area" maxLength={120} />
          <Label text="Tickets">
            <Glass style={s.seg} accessibilityRole="radiogroup" accessibilityLabel="Tickets">
              {[false, true].map((paid) => (
                <Pressable
                  key={String(paid)}
                  onPress={() => put({ paid })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: d.paid === paid }}
                  style={[s.segPart, d.paid === paid && s.segOn]}
                >
                  <Text style={[s.segText, d.paid === paid && s.segTextOn]}>{paid ? 'Paid' : 'Free'}</Text>
                </Pressable>
              ))}
            </Glass>
          </Label>
          <View style={s.half}>
            <Field label="How many people? · optional" value={d.size} onChangeText={(size) => put({ size })} keyboardType="number-pad" maxLength={7} />
          </View>
        </View>
      )}
      {why && <Note live>{why}</Note>}

      {step === 3 && (
        <>
          <Section title="Host" />
          <View style={[ui.card, s.card]}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle} numberOfLines={1}>
                {d.name.trim()}
              </Text>
              {!see && <Pill label="Edit" onPress={() => setStep(1)} />}
            </View>
            <KV k="Kind" v={kindOf(d.kind)} />
            <KV k="City" v={d.city ?? ''} />
            {d.about.trim() ? <KV k="About" v={d.about.trim()} /> : null}
          </View>
          {!d.skip && (
            <>
              <Section title="First event" />
              <View style={[ui.card, s.card]}>
                <View style={s.cardHead}>
                  <Text style={s.cardTitle} numberOfLines={1}>
                    {d.title.trim()}
                  </Text>
                  {!see && <Pill label="Edit" onPress={() => setStep(2)} />}
                </View>
                <KV k="When" v={d.startsAt ? whenLabel(d.startsAt) : ''} />
                <KV k="Category" v={categoryOf(d.category)} />
                {d.venue.trim() ? <KV k="Where" v={d.venue.trim()} /> : null}
                <KV k="Tickets" v={`${d.paid ? 'Paid' : 'Free'}${d.size.trim() ? ` · about ${d.size.trim()}` : ''}`} />
              </View>
            </>
          )}
          {!d.skip && d.paid && <Note>Paid tickets go on sale once payments open on Orbit.</Note>}
          {said && <Note live>{said}</Note>}
        </>
      )}

      {sheet === 'city' && (
        <CitySheet
          chosen={d.city}
          onPick={(city) => {
            put({ city });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'when' && (
        <WhenSheet
          startsAt={d.startsAt}
          onDone={(startsAt) => {
            put({ startsAt });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </Frame>
  );
}

// The page: the back circle, the three-part progress and "1 of 3" (none when `step` is null), what scrolls, and the
// buttons pinned at the foot, above the keyboard.
function Frame({ step, onBack, foot, children }: { step: 1 | 2 | 3 | null; onBack: () => void; foot?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={ui.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.top, { marginTop: insets.top + 8 }]}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={4} style={({ pressed }) => pressed && ui.pressed}>
          <Glass style={s.circle}>
            <Image source={CHEVRON} style={[s.mark, s.back]} />
          </Glass>
        </Pressable>
        {step && (
          <>
            <View style={s.steps} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {[1, 2, 3].map((n) => (
                <View key={n} style={[s.seg3, n <= step && s.seg3On]} />
              ))}
            </View>
            <Text style={s.stepWord}>{`${step} of 3`}</Text>
          </>
        )}
      </View>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        {children}
      </ScrollView>
      {foot && <View style={[s.foot, { paddingBottom: insets.bottom + 12 }]}>{foot}</View>}
    </KeyboardAvoidingView>
  );
}

function Label({ text, optional = false, children }: { text: string; optional?: boolean; children: ReactNode }) {
  return (
    <View style={ui.field}>
      <Text style={ui.fieldLabel}>{optional ? `${text} · optional` : text}</Text>
      {children}
    </View>
  );
}

// A text-only choice: a Sage outline and dot when picked (the accent on the element, never the words).
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[s.chip, on && s.chipOn]}>
      {on && <View style={s.dot} />}
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// A field that opens a sheet (City, When): its value, or grey words, and a >.
function Opens({ label, value, placeholder, onPress }: { label: string; value: string | null; placeholder: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${(value || placeholder).replace(' · ', ', ')}`} style={({ pressed }) => pressed && ui.pressed}>
      <Glass style={[ui.input, s.opens]}>
        <Text style={[s.opensText, !value && s.muted]}>{value || placeholder}</Text>
        <Image source={CHEVRON} style={s.mark} />
      </Glass>
    </Pressable>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv} accessible>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

// The city list sign-up's city uses in the Orbit app (app/src/citySheet.tsx), from the same list in @orbit/contract:
// search, then Popular cities and every city A to Z.
function CitySheet({ chosen, onPick, onClose }: { chosen: string | null; onPick: (city: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ui.page, s.sheetPage]}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle} accessibilityRole="header">
            City
          </Text>
          <Pill label="Close" onPress={onClose} />
        </View>
        <View style={s.search}>
          <Field label="Search" value={query} onChangeText={setQuery} placeholder="Search for your city" autoCapitalize="words" maxLength={60} />
        </View>
        <FlatList
          data={searching ? searchCities(query).slice(0, 50) : allCities}
          keyExtractor={(c) => `${c.name}|${c.state}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            searching ? undefined : (
              <>
                <Text style={s.sheetSection}>Popular cities</Text>
                <View style={[s.chips, s.sheetChips]} accessibilityRole="radiogroup" accessibilityLabel="Popular cities">
                  {popularCities.map((c) => (
                    <Chip key={c.name} label={c.name} on={chosen === c.name} onPress={() => onPick(c.name)} />
                  ))}
                </View>
                <Text style={s.sheetSection}>All cities</Text>
              </>
            )
          }
          ListEmptyComponent={<Note>{`No city matches “${query.trim()}”.`}</Note>}
          renderItem={({ item: c }) => (
            <Pressable
              onPress={() => onPick(c.name)}
              style={({ pressed }) => [s.cityRow, pressed && s.cityPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${c.state}`}
              accessibilityState={{ selected: chosen === c.name }}
            >
              <Text style={s.cityName}>{c.name}</Text>
              <Text style={s.cityState} numberOfLines={1}>
                {c.state}
              </Text>
              {chosen === c.name && <View style={s.dot} />}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

// When: the month, past days faded and not pickable, then start times every half hour that are still ahead, India time.
function WhenSheet({ startsAt, onDone, onClose }: { startsAt: string | null; onDone: (iso: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const now = Date.now();
  const thisMonth = istDate(now).slice(0, 7);
  const was = startsAt && Date.parse(startsAt) > now ? partsOf(startsAt) : null;
  const [month, setMonth] = useState(was?.day.slice(0, 7) ?? thisMonth);
  const [day, setDay] = useState<string | null>(was?.day ?? null);
  const [min, setMin] = useState<number | null>(was?.min ?? null);
  const times = day ? slots(day, now) : [];
  const ready = day !== null && min !== null && times.includes(min);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.dim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[s.when, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.grab} />
        <View style={s.calHead}>
          <Round label="Last month" flip disabled={month <= thisMonth} onPress={() => setMonth(shiftMonth(month, -1))} />
          <Text style={s.calTitle}>{monthLabel(month)}</Text>
          <Round label="Next month" onPress={() => setMonth(shiftMonth(month, 1))} />
        </View>
        <View style={s.cal}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
            <Text key={i} style={[s.cell, s.weekday]}>
              {w}
            </Text>
          ))}
          {monthDays(month).map((x, i) => {
            if (!x) return <View key={i} style={s.cell} />;
            const open = dayOpen(x, now);
            const on = x === day;
            return (
              <Pressable
                key={x}
                disabled={!open}
                onPress={() => setDay(x)}
                accessibilityRole="button"
                accessibilityLabel={dayName(x)}
                accessibilityState={{ selected: on, disabled: !open }}
                style={s.cell}
              >
                <View style={[s.dayDisc, on && s.dayOn]}>
                  <Text style={[s.dayText, !open && s.dayPast, on && s.dayTextOn]}>{Number(x.slice(8))}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={s.sheetSection}>Starts at</Text>
        {day ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.times} accessibilityRole="radiogroup" accessibilityLabel="Starts at">
            {times.map((t) => (
              <Chip key={t} label={timeLabel(t)} on={t === min} onPress={() => setMin(t)} />
            ))}
          </ScrollView>
        ) : (
          <Text style={s.pickDay}>Pick a day first.</Text>
        )}
        <View style={s.done}>
          <Wide label="Done" disabled={!ready} onPress={() => onDone(atIst(day!, min!))} />
        </View>
      </View>
    </Modal>
  );
}

function Round({ label, flip = false, disabled = false, onPress }: { label: string; flip?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [disabled && ui.off, pressed && ui.pressed]}>
      <Glass style={[s.circle, s.small]}>
        <Image source={CHEVRON} style={[s.mark, flip && s.back]} />
      </Glass>
    </Pressable>
  );
}

const s = StyleSheet.create({
  top: { height: 44, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  small: { width: 32, height: 32, borderRadius: 16 },
  mark: { width: 14, height: 14, tintColor: color.secondary },
  back: { tintColor: color.text, transform: [{ scaleX: -1 }] }, // the > turned to face back
  steps: { flex: 1, flexDirection: 'row', gap: 6 },
  seg3: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.track },
  seg3On: { backgroundColor: color.accent }, // progress is an element, so the accent is allowed
  stepWord: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  scroll: { paddingBottom: space.big },
  spinner: { marginTop: 48 },
  retry: { marginTop: 16, marginHorizontal: 20, flexDirection: 'row' },
  title: { marginTop: 20, marginHorizontal: 20, fontFamily: font.headline, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.text },
  line: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  fields: { marginTop: 20, marginHorizontal: 20, gap: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: color.border, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipOn: { borderColor: color.accent },
  chipText: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  chipTextOn: { color: color.text },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  opens: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.small },
  opensText: { flexShrink: 1, fontFamily: font.text, fontSize: 15, color: color.text },
  muted: { color: color.secondary },
  area: { minHeight: 88, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, overflow: 'hidden' },
  areaText: { minHeight: 66, fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.text, textAlignVertical: 'top' },
  seg: { height: 44, borderRadius: 22, padding: 3, flexDirection: 'row', overflow: 'hidden' },
  segPart: { flex: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: color.fill },
  segText: { fontFamily: font.title, fontSize: 13, color: color.secondary },
  segTextOn: { color: color.text },
  half: { width: '50%' },
  link: { alignSelf: 'center', padding: 6 },
  linkText: { fontFamily: font.title, fontSize: 13, color: color.secondary },
  foot: { paddingTop: 12, paddingHorizontal: 20, gap: 10 },
  card: { gap: 16 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitle: { flexShrink: 1, fontFamily: font.title, fontSize: 15, color: color.text },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  k: { fontFamily: font.text, fontSize: 14, color: color.secondary },
  v: { flexShrink: 1, fontFamily: font.text, fontSize: 14, color: color.text, textAlign: 'right' },
  sheetPage: { paddingTop: space.big },
  sheetHead: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontFamily: font.headline, fontSize: 20, color: color.text },
  search: { marginTop: 16, marginHorizontal: 20 },
  sheetSection: { marginTop: space.big, marginBottom: space.small, marginHorizontal: 20, fontFamily: font.title, fontSize: 13, color: color.secondary },
  sheetChips: { marginHorizontal: 20 },
  cityRow: { minHeight: 44, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  cityPressed: { backgroundColor: stoneAt(0.08) },
  cityName: { fontFamily: font.medium, fontSize: 15, color: color.text },
  cityState: { flex: 1, fontFamily: font.text, fontSize: 13, color: color.secondary },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  when: { paddingTop: 10, backgroundColor: color.ground, borderTopLeftRadius: 23, borderTopRightRadius: 23, borderTopWidth: 1, borderColor: color.border },
  grab: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: color.track, marginBottom: 16 },
  calHead: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calTitle: { fontFamily: font.title, fontSize: 15, color: color.text },
  cal: { marginTop: 14, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center' },
  weekday: { height: 20, fontFamily: font.medium, fontSize: 11, color: color.secondary, textAlign: 'center' },
  dayDisc: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: color.accent }, // the picked day: a Sage disc, its number in Charcoal
  dayText: { fontFamily: font.text, fontSize: 14, color: color.text },
  dayPast: { color: stoneAt(0.3) },
  dayTextOn: { fontFamily: font.price, color: color.onAccent },
  times: { paddingHorizontal: 20, gap: space.small },
  pickDay: { marginHorizontal: 20, fontFamily: font.text, fontSize: 13, color: color.secondary },
  done: { marginTop: 22, marginHorizontal: 20 },
});
