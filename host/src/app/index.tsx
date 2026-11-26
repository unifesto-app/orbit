import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { Redirect, router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { InboxButton } from '../inboxButton';
import { adminHosts, mustPick } from '../launch/host';
import { PushAsk } from '../push';
import { signOut, useSession } from '../session';
import { seats } from '../station/seats';
import { Pill } from '../station/ui';
import { isLaunch, isStation, variant as v } from '../variant';

// Every host app opens on Sign in. Then Orbit Station opens on Today, Event Partner on Events (the picker first with
// several hosts and none picked), and Crew shows its name until its own screens come, with the push ask, its Inbox and
// Account (account.tsx: Delete account, App Store 5.1.1(v)). Signed in on no venue's team, or
// as an Admin of no host, it shows the invites screen (welcome) instead.
export default function Index() {
  const session = useSession();
  if (!session) return <Redirect href="/signin" />;
  if (isStation) return <Redirect href={!seats(session.me).length ? '/welcome' : '/today'} />;
  if (isLaunch) return <Redirect href={!adminHosts(session.me).length ? '/welcome' : mustPick(session.me) ? '/pick' : '/events'} />;
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
      <PushAsk />
      <View style={s.out}>
        <InboxButton />
        <Pill label="Account" onPress={() => router.push('/account')} />
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
  out: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
