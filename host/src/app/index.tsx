import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { signOut, useSession } from '../session';
import { seats } from '../station/seats';
import { Pill } from '../station/ui';
import { isLaunch, isStation, variant as v } from '../variant';

// Every host app opens on Sign in. Then Orbit Station opens on Today (signed in only: a dev demo session is sent to Sign
// in), Orbit Launch on the no-host
// screen (Events in the dev demo), and Crew shows its name until its own screens come. Signed in to Station on no venue's
// team, it shows the invites screen (welcome) instead.
export default function Index() {
  const session = useSession();
  if (!session) return <Redirect href="/signin" />;
  if (isStation) return <Redirect href={!('me' in session) ? '/signin' : !seats(session.me).length ? '/welcome' : '/today'} />;
  if (isLaunch) return <Redirect href={'demo' in session ? '/events' : '/welcome'} />;
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
      <View style={s.out}>
        <Pill label="Sign out" onPress={signOut} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: role.ground, padding: 24 },
  word: { fontFamily: 'Sacramento_400Regular', fontSize: 88, color: role.text },
  name: { fontSize: 20, color: role.text, marginTop: 4 },
  line: { fontSize: 15, color: role.text2, marginTop: 8, textAlign: 'center' },
  out: { marginTop: 24 },
});
