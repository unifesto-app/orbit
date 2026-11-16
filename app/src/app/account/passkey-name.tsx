// Rename a passkey (User doc: named after the device that made it; Rename is new). A modal with the field at the top,
// like naming a list (src/app/list-name.tsx). Only a name, so no "Confirm it's you".
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Field, Pill } from '../../account/kit';
import { Sheet } from '../../rows';
import { api } from '../../session';
import { color, font, space } from '../../theme';

export default function PasskeyName() {
  const { id, name: old } = useLocalSearchParams<{ id: string; name?: string }>();
  const [name, setName] = useState(old ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);
  const open = useRef(true); // closed while saving: the rename still counts, but there's nothing to go back from
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );
  const done = async () => {
    if (busy.current || !name.trim()) return;
    busy.current = true;
    const r = await api.authed('PATCH', `/me/passkeys/${id}`, { name: name.trim() });
    busy.current = false;
    if (r.ok) {
      if (open.current) router.back();
    } else setProblem(r.error.message);
  };

  return (
    <Sheet title="Rename passkey" full>
      <View style={styles.body}>
        <Field
          label="Name"
          value={name}
          onChangeText={(t) => {
            setName(t);
            setProblem(null);
          }}
          maxLength={50}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void done()}
        />
        {problem && (
          <Text style={styles.problem} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        )}
      </View>
      {/* A wide pill brings its own page margins; the sheet already has them. */}
      <View style={styles.bleed}>
        <Pill label="Save" size="wide" disabled={!name.trim()} onPress={() => void done()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.small },
  bleed: { marginHorizontal: -20 },
  problem: { fontFamily: font.medium, fontSize: 14, color: color.secondary },
});
