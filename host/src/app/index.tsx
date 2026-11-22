import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '../session';
import { isLaunch, isStation, variant as v } from '../variant';

// Orbit Station opens on Today. Orbit Launch opens on Sign in, then the no-host screen (Events in the dev demo). Crew
// shows its name until its own screens come.
export default function Index() {
  const session = useSession();
  if (isStation) return <Redirect href="/today" />;
  if (isLaunch) return <Redirect href={!session ? '/signin' : 'demo' in session ? '/events' : '/welcome'} />;
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
