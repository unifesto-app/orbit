// Host on Orbit (Hosts doc, Becoming a host: "from the web's host band, the app's Profile, or an empty /console"):
// start a host with three things, its name, what kind it is and its city from the city list. It goes live at once,
// Unverified, with the starter as Admin and owner, and New event opens next.
// ponytail: nothing to create it in until the API exists, and New event isn't built, so Start host goes nowhere yet.
// Signed out, the form still fills in (ask late), and Start host opens the sign-in sheet over it.
import { popularCities } from '@orbit/contract';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { profile } from '../../account/data';
import { Chips, Field, Page, Pill } from '../../account/kit';
import { Section } from '../../rows';
import { needsAccount, useSignedIn } from '../../session';
import { space } from '../../theme';

const KINDS = ['College club', 'Comedy group', 'Jam circle', 'Café meetup', 'Startup community', 'Company', 'Housing society', 'Other'] as const;
const CITIES = popularCities.slice(0, 6).map((c) => c.name);

export default function HostOnOrbit() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number] | null>(null);
  const [city, setCity] = useState<string | null>(profile.city);
  const signedIn = useSignedIn();
  return (
    <Page title="Host on Orbit">
      <View style={[styles.block, styles.field]}>
        <Field label="Host name" value={name} onChangeText={setName} placeholder="Jam Circle Hyderabad" autoCapitalize="words" maxLength={60} />
      </View>
      <Section title="What kind" />
      <View style={styles.chips}>
        <Chips options={KINDS} value={kind} onChange={setKind} />
      </View>
      <Section title="City" />
      <View style={styles.chips}>
        <Chips options={CITIES} value={city} onChange={setCity} />
      </View>
      <View style={styles.block}>
        <Pill label="Start host" size="wide" disabled={!name.trim() || !kind || !city} onPress={signedIn ? undefined : () => needsAccount()} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space.big },
  field: { marginHorizontal: 20 },
  chips: { marginHorizontal: 20 },
});
