// The list modal (Saved events and lists doc), opened by the Save star (owner, 16 Nov 2026: "instead of toast use
// modal, when clicked on love"; a heart until 19 Nov): an empty star saves the event, then this opens over the page; a
// saved star opens it too.
// Saved and the event, New list, then every list with a tick where the event is: each tap saves at once, and taking an
// event out of a list leaves it saved. Remove from saved, at the bottom, unsaves it everywhere (with Undo), so unsaving
// is deliberate and nobody loses their lists by accident. An event's menu opens it the same way (Add to a list).
// A full glass modal like the location's ("fix that modal"): the short sheet it was cut its lists off, and New list
// opened a second modal over it, so a new list's name is typed right here.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field, Group, Pill, Row, TONE } from '../../account/kit';
import { MAX_LISTS, TOO_MANY, byTouched } from '../../account/saves';
import { Icon } from '../../icons';
import { events } from '../../mock';
import { CloseButton, GlassFill } from '../../rows';
import { newList, removeSaves, tickList, useSaved, useSession } from '../../session';
import { color, font, space } from '../../theme';

const TONES = Object.values(TONE); // each list's icon a colour in turn, as in Account › Saved

export default function ListModal() {
  const { event } = useLocalSearchParams<{ event: string }>();
  const insets = useSafeAreaInsets();
  const all = useSession()?.lists ?? [];
  // The lists in the order they had when it opened, so a tick doesn't move a row (or its colour) under the finger;
  // lists made here go first.
  const [order] = useState(() => byTouched(all).map((l) => l.id));
  const lists = byTouched(all).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const [leaving, setLeaving] = useState(false); // after Remove from saved, so it doesn't change as it slides away
  const saved = useSaved(event) || leaving;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const e = events.find((x) => x.id === event); // only events that can be opened are saved: a made-up link adds nothing

  const fail = (p: string | null) => {
    setProblem(p);
    if (p) AccessibilityInfo.announceForAccessibility(p);
  };
  const startNaming = () => {
    if (lists.length >= MAX_LISTS) return fail(TOO_MANY);
    setNaming(true);
    setProblem(null);
  };
  const make = () => {
    if (!name.trim()) return setNaming(false); // Done on an empty name backs out
    const p = newList(name, event); // made with this event in it
    if (p) return fail(p);
    setNaming(false);
    setName('');
    setProblem(null);
  };
  const remove = () => {
    setLeaving(true);
    router.back();
    removeSaves([event]); // its Undo note shows once the modal has gone
  };

  return (
    // A sheet on iOS, so a small gap at its top; full screen on Android, so clear of the status bar (as the location's).
    <View style={[styles.screen, { paddingTop: Platform.OS === 'ios' ? space.big : insets.top + space.small, paddingBottom: insets.bottom + space.big }]}>
      <GlassFill />
      <View style={styles.head}>
        <View style={styles.grow}>
          <Text style={styles.title} accessibilityRole="header">
            {saved ? 'Saved' : 'Add to a list'}
          </Text>
          <Text style={styles.event} numberOfLines={1}>
            {e?.title ?? 'This event isn’t on Orbit'}
          </Text>
        </View>
        <CloseButton />
      </View>

      {e && (
        <ScrollView
          style={styles.grow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}>
          {naming && (
            <View style={styles.naming}>
              <View style={styles.inset}>
                <Field
                  label="New list"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    setProblem(null);
                  }}
                  autoFocus
                  autoCapitalize="sentences"
                  returnKeyType="done"
                  onSubmitEditing={make}
                />
              </View>
              <Pill label="Make list" size="wide" disabled={!name.trim()} onPress={make} />
            </View>
          )}
          {problem && <Text style={styles.problem}>{problem}</Text>}
          <Group title="Lists">
            {!naming && <Row icon="listPlus" label="New list" onPress={startNaming} />}
            {lists.map((l, i) => {
              const on = l.events.includes(event);
              return (
                <Row
                  key={l.id}
                  icon="list"
                  tone={TONES[i % TONES.length]}
                  label={l.name}
                  right={on ? <Icon name="check" size={20} color={color.accent} /> : undefined}
                  checked={on}
                  onPress={() => fail(tickList(l.id, event, !on))}
                />
              );
            })}
          </Group>
        </ScrollView>
      )}

      {saved && (
        <View style={styles.foot}>
          <Pill label="Remove from saved" size="wide" muted onPress={remove} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, // on the glass (GlassFill), owner: "Glass for all"
  grow: { flex: 1, minWidth: 0 },
  head: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  title: { fontFamily: font.headline, fontSize: 20, color: color.text },
  event: { marginTop: 2, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  naming: { marginTop: space.big, gap: space.small },
  inset: { marginHorizontal: 20 },
  problem: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.medium, fontSize: 14, color: color.secondary },
  foot: { paddingTop: space.small },
});
