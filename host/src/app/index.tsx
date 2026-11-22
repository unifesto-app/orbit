import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { isLaunch, isStation, variant as v } from '../variant';

// Orbit Station opens on Today and Orbit Launch on Events; Crew shows its name until its own screens come.
export default function Index() {
  if (isStation) return <Redirect href="/today" />;
  if (isLaunch) return <Redirect href="/events" />;
  return (
    <View style={s.root}>
      {v ? (
        <>
          <Text style={s.word}>{v.word}</Text>
          <Text style={s.name}>{v.name}</Text>
          <Text style={s.line}>{v.line}</Text>
        </>
      ) : (
        <Text style={s.name}>{Application.applicationId}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: role.ground, padding: 24 },
  word: { fontFamily: 'Sacramento_400Regular', fontSize: 88, color: role.text },
  name: { fontSize: 20, color: role.text, marginTop: 4 },
  line: { fontSize: 15, color: role.text2, marginTop: 8, textAlign: 'center' },
});
