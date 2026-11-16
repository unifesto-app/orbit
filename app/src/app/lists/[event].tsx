// The list picker (Saved events and lists doc): a short glass sheet over whatever opened it, from the note after a save
// or an event's menu. New list at the top, then every list with a tick where the event already is. Each tap saves at
// once; taking an event out of a list leaves it saved.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { MAX_LISTS, TOO_MANY, byTouched } from '../../account/saves';
import { Icon } from '../../icons';
import { events } from '../../mock';
import { Sheet } from '../../rows';
import { tickList, useSession } from '../../session';
import { color, font, radius } from '../../theme';

export default function ListPicker() {
  const { event } = useLocalSearchParams<{ event: string }>();
  const lists = byTouched(useSession()?.lists ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const { height } = useWindowDimensions();
  const title = events.find((e) => e.id === event)?.title;
  const fail = (p: string | null) => {
    setProblem(p);
    if (p) AccessibilityInfo.announceForAccessibility(p);
  };
  const newList = () => (lists.length >= MAX_LISTS ? fail(TOO_MANY) : router.push(`/list-name?event=${event}`));
  // Only events that can be opened are saved (doc): a stale or made-up link adds nothing.
  if (!title) return <Sheet title="Add to a list" note="This event isn’t on Orbit">{null}</Sheet>;

  return (
    <Sheet title="Add to a list" note={title}>
      {/* Up to 50 lists, so it scrolls once they pass about half the screen. */}
      <ScrollView style={{ maxHeight: height * 0.5 }} bounces={false}>
        <Choice label="New list" onPress={newList} />
        {lists.map((l) => {
          const on = l.events.includes(event);
          return <Choice key={l.id} label={l.name} ticked={on} onPress={() => fail(tickList(l.id, event, !on))} />;
        })}
      </ScrollView>
      {problem && <Text style={styles.problem}>{problem}</Text>}
    </Sheet>
  );
}

// One line on the sheet's glass (not a card): the list's name, and a tick when the event is in it.
function Choice({ label, ticked, onPress }: { label: string; ticked?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={ticked === undefined ? 'button' : 'checkbox'}
      accessibilityState={ticked === undefined ? undefined : { checked: ticked }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {ticked && <Icon name="check" size={20} color={color.accent} />}
      {ticked === undefined && <Icon name="listPlus" size={20} color={color.text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { height: 48, paddingHorizontal: 4, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pressed: { opacity: 0.7 },
  label: { flex: 1, fontFamily: font.title, fontSize: 15, color: color.text },
  problem: { fontFamily: font.medium, fontSize: 14, color: color.secondary },
});
