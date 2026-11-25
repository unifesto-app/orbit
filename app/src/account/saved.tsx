// What Account › Saved and a list's screen are made of (Saved events and lists doc): saved event rows, each with its
// heart and a ⋯ (Add to a list, Take out of this list, Remove from saved), and Past, folded.
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Icon } from '../icons';
import { type Event, toHost } from '../events';
import { EventRow, type MenuAction } from '../rows';
import { addToList, removeSaves, tickList } from '../session';
import { color, font, space } from '../theme';
import { Pill } from './kit';
import type { List } from './saves';
import { cardOf } from './seen';

// The host of a saved event, from the card the API sent with it (only events with a card are drawn).
const hostOf = (e: Event) => toHost(cardOf(e.id)!.host);

// A saved row's ⋯. On a list's screen it can also take the event out of that list, leaving it saved.
function menuFor(e: Event, list?: List): MenuAction[] {
  const actions: MenuAction[] = [{ label: 'Add to a list', icon: 'listPlus', onPress: () => addToList(e.id) }];
  if (list) actions.push({ label: 'Take out of this list', icon: 'takeOut', onPress: () => void tickList(list.id, e.id, false) });
  actions.push({ label: 'Remove from saved', icon: 'trash', onPress: () => removeSaves([e.id]) });
  return actions;
}


export function SavedRows({ events, list }: { events: readonly Event[]; list?: List }) {
  return (
    <>
      {events.map((e) => (
        // Its tag is the event's status where that's news (doc: Sold out, Cancelled…; src/status.ts), else the series.
        <EventRow key={e.id} event={e} host={hostOf(e)} now={Date.now()} menu={menuFor(e, list)} />
      ))}
    </>
  );
}

// Past saves stay, folded, until removed (doc, decision 10): each row's ⋯ removes it, and in All saved Remove all past
// clears them all, with Undo.
export function PastFold({ events, list }: { events: readonly Event[]; list?: List }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={`Past, ${events.length}`}
        accessibilityState={{ expanded: open }}
        style={styles.fold}>
        <Text style={styles.h2}>Past</Text>
        <Text style={styles.count}>{events.length}</Text>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={14} color={color.secondary} />
      </Pressable>
      {open && events.map((e) => <EventRow key={e.id} event={e} host={hostOf(e)} now={Date.now()} past menu={menuFor(e, list)} />)}
      {open && !list && <Pill label="Remove all past" size="wide" muted onPress={() => removeSaves(events.map((e) => e.id))} />}
    </>
  );
}

const styles = StyleSheet.create({
  // Section's heading (src/rows.tsx), pressable, with its count and a caret.
  fold: { marginTop: space.big, marginBottom: 16, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: space.small },
  h2: { fontFamily: font.headline, fontSize: 18, color: color.text },
  count: { flex: 1, fontFamily: font.medium, fontSize: 15, color: color.secondary },
});
