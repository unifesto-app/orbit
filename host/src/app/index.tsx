import { role } from '@orbit/tokens';
import * as Application from 'expo-application';
import { color, font, space } from '@orbit/mobile/theme';
import { Redirect } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOut, useSession } from '../session';
import { seats } from '../station/seats';
import { Pill } from '../station/ui';
import { isLaunch, isStation, variant as v } from '../variant';

// Every host app opens on Sign in. Then Orbit Station opens on Today (also its dev demo), Orbit Launch on the no-host
// screen (Events in the dev demo), and Crew shows its name until its own screens come. Signed in to Station on no venue's
// team, it shows the no-seat screen instead.
export default function Index() {
  const session = useSession();
  if (!session) return <Redirect href="/signin" />;
  if (isStation) return 'me' in session && !seats(session.me).length ? <NoSeat /> : <Redirect href="/today" />;
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

// Orbit Play Partner, signed in but on no venue's team (as Admin or at the desk), modelled on Launch's welcome.tsx.
// ponytail: a plain placeholder until the owner's design take.
function NoSeat() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[n.page, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + space.big }]}>
      <View style={n.brand}>
        <Image source={require('../../assets/icons/station.png')} style={n.icon} accessible={false} />
        <Text style={n.brandName}>{v?.name}</Text>
      </View>
      <Text style={n.title} accessibilityRole="header">
        You’re not on a venue’s team yet
      </Text>
      <Text style={n.line}>Ask the venue’s Admin to add you on Orbit.</Text>
      <View style={n.foot}>
        <Pill label="Sign out" onPress={signOut} />
      </View>
    </View>
  );
}

const n = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  brand: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 10 },
  brandName: { fontFamily: font.title, fontSize: 17, color: color.text },
  title: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.headline, fontSize: 28, lineHeight: 34, letterSpacing: -0.3, color: color.text },
  line: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  foot: { marginTop: 'auto', paddingTop: space.big, marginHorizontal: 20, flexDirection: 'row' },
});

const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: role.ground, padding: 24 },
  word: { fontFamily: 'Sacramento_400Regular', fontSize: 88, color: role.text },
  name: { fontSize: 20, color: role.text, marginTop: 4 },
  line: { fontSize: 15, color: role.text2, marginTop: 8, textAlign: 'center' },
  out: { marginTop: 24 },
});
