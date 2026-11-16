// Naming a list: New list (from the picker, with the event to put in it, or from Account › Saved) and Rename list
// (from a list's menu). A full modal with the field at the top, as the sign-in sheet, so the keyboard never covers it.
// A name is 1 to 40 letters, trimmed, and no two lists share one, ignoring case (src/account/saves.ts).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Field, Pill } from '../account/kit';
import { GONE } from '../account/saves';
import { Sheet } from '../rows';
import { newList, renameList, useSession } from '../session';
import { color, font, space } from '../theme';

export default function ListName() {
  const { event, list } = useLocalSearchParams<{ event?: string; list?: string }>();
  const old = useSession()?.lists.find((l) => l.id === list);
  const [name, setName] = useState(old?.name ?? '');
  const [problem, setProblem] = useState<string | null>(list && !old ? GONE : null);
  const done = () => {
    const p = list ? renameList(list, name) : newList(name, event);
    if (p) setProblem(p);
    else router.back();
  };

  return (
    <Sheet title={list ? 'Rename list' : 'New list'} full>
      <View style={styles.body}>
        <Field
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setProblem(null);
          }}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={done}
        />
        {problem && <Text style={styles.problem}>{problem}</Text>}
      </View>
      {/* A wide pill brings its own page margins; the sheet already has them. */}
      <View style={styles.bleed}>
        <Pill label={list ? 'Save' : 'Make list'} size="wide" disabled={!name.trim()} onPress={done} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.small },
  bleed: { marginHorizontal: -20 },
  problem: { fontFamily: font.medium, fontSize: 14, color: color.secondary },
});
