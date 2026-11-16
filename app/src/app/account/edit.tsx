// Edit profile (User doc, Profile): name, photo, date of birth, gender, phone, email and the city for new events nearby.
// No username, bio or links (decision 6 dropped them). The date of birth is shown, never edited: only support changes
// it. Phone and email change with codes, on their own screen (src/app/account/contact.tsx). The photo is a circle, as on
// Account (owner, 17 Nov 2026: "instead of squared profile use rounded one").
// Save sends the name and gender that changed to the API (PATCH /me) and goes back with the account it answers.
// ponytail: no photo uploads or city on the API yet, so Add photo says so and the city shows Not set. Each needs its API
// part first (uploads; a city on the account), and the photo picker a native module and a rebuild.
import type { Me as Account } from '@orbit/contract';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Chips, Field, Group, Note, Page, Pill, Row, SignInNote } from '../../account/kit';
import { Photo } from '../../account/profile';
import { maskEmail, maskPhone, profileChanges } from '../../account/rules';
import { Section } from '../../rows';
import { api, setAccount, useSession } from '../../session';
import { space } from '../../theme';

const PHOTO = 72;
// Optional; a host's form that asks for it fills it in here next time.
const GENDERS = ['Woman', 'Man', 'Non-binary', 'Rather not say'] as const;
const birthday = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function EditProfile() {
  const me = useSession()?.me;
  return me ? (
    <Form key={me.id} me={me} />
  ) : (
    <Page title="Edit profile">
      <SignInNote>Sign in to edit your profile.</SignInNote>
    </Page>
  );
}

function Form({ me }: { me: Account }) {
  const [name, setName] = useState(me.name ?? '');
  const [gender, setGender] = useState<string | null>(me.gender);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false); // the same, read at once: a double tap saves once
  const open = useRef(true); // left (back) while saving: the save still counts, but there's nothing to go back from
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const changes = profileChanges(me, { name, gender });

  async function save() {
    if (!changes || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const r = await api.authed<Account>('PATCH', '/me', changes);
    working.current = false;
    setBusy(false);
    if (!r.ok) return setError(r.error.message); // what was typed stays, to try again
    setAccount(r.data);
    if (open.current) router.back();
  }
  const change = (way: 'phone' | 'email') => router.push({ pathname: '/account/contact', params: { way } });

  return (
    <Page title="Edit profile">
      <View style={styles.photo}>
        <Photo me={me} size={PHOTO} />
        <Pill label={me.photo ? 'Change photo' : 'Add photo'} size="small" onPress={() => Alert.alert('Adding a photo isn’t ready yet')} />
      </View>

      <View style={styles.fields}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={100} />
      </View>

      <Group>
        {/* Fixed after sign-up: only support changes it, so it shows and never edits. */}
        <Row label="Date of birth" value={me.dob ? birthday.format(new Date(me.dob)) : 'Not set'} />
        <Row label="Phone" note={me.phone ? maskPhone(me.phone) : 'Not added'} right={<Pill label="Change" size="small" onPress={() => change('phone')} />} />
        <Row
          label="Email"
          note={me.email ? maskEmail(me.email) : 'Not added'}
          right={<Pill label={me.email ? 'Change' : 'Add'} size="small" onPress={() => change('email')} />}
        />
        <Row label="City for new events" value="Not set" />
      </Group>

      <Section title="Gender" />
      <View style={styles.chips}>
        <Chips options={GENDERS} value={gender} onChange={(g) => setGender(g === gender ? null : g)} />
      </View>

      <View style={styles.save}>
        <Pill label="Save" size="wide" disabled={!changes || busy} onPress={() => void save()} />
        {error && <Note>{error}</Note>}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  photo: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  fields: { marginTop: space.big, marginHorizontal: 20 },
  chips: { marginHorizontal: 20 },
  save: { marginTop: space.big },
});
