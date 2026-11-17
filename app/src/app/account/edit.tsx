// Edit profile (User doc, Profile): name, photo, date of birth, gender, phone, email and the city for new events nearby.
// No username, bio or links (decision 6 dropped them). The date of birth is shown, never edited: only support changes
// it. Phone and email change with codes, on their own screen (src/app/account/contact.tsx). The photo is a circle, as on
// Account (owner, 17 Nov 2026: "instead of squared profile use rounded one").
// Save sends the name and gender that changed to the API (PATCH /me) and goes back with the account it answers. The city
// is picked and saved on its own sheet (src/app/account/city.tsx), like phone and email.
// The photo is picked from the library and cropped square there (decision 7), then sent to PUT /me/photo, which checks it
// and keeps its own copy (api/src/media.ts); Remove asks first. Either one shows at once, here and on Account.
import { type Me as Account, PHOTO_MAX_BYTES } from '@orbit/contract';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Chips, Field, Group, Note, Page, Pill, Row, SignInNote } from '../../account/kit';
import { Photo } from '../../account/profile';
import { maskEmail, maskPhone, profileChanges } from '../../account/rules';
import type { Result } from '../../api';
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
  const [photoError, setPhotoError] = useState<string | null>(null);
  // What's being sent. One at a time, so a save's answer can't put back the photo an upload just changed.
  const [busy, setBusy] = useState<'save' | 'photo' | null>(null);
  const working = useRef(false); // the same, read at once: a double tap sends once
  const picking = useRef(false); // the library is open: a second tap doesn't open it again
  const open = useRef(true); // left (back) while saving: the save still counts, but there's nothing to go back from
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const changes = profileChanges(me, { name, gender });

  // The answer is the account as it is now. False when the API said no (its message shows), or something else was out.
  async function send(what: 'save' | 'photo', request: () => Promise<Result<Account>>, show: (m: string | null) => void) {
    if (working.current) return false;
    working.current = true;
    setBusy(what);
    show(null);
    const r = await request();
    working.current = false;
    setBusy(null);
    if (!r.ok) show(r.error.message);
    else setAccount(r.data);
    return r.ok;
  }

  async function save() {
    // What was typed stays when it fails, to try again.
    if (changes && (await send('save', () => api.authed<Account>('PATCH', '/me', changes), setError)) && open.current) router.back();
  }

  // iOS always crops square; `aspect` is Android's, and its crop shows the circle the photo is drawn in.
  async function choose() {
    if (working.current || picking.current) return;
    picking.current = true;
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'oval', quality: 0.8 });
    } catch {
      return setPhotoError('Couldn’t open your photos. Try again.');
    } finally {
      picking.current = false;
    }
    const a = picked.canceled ? null : picked.assets[0];
    if (!a) return;
    if (a.fileSize && a.fileSize > PHOTO_MAX_BYTES) return setPhotoError('That photo is over 5 MB. Choose a smaller one.');
    const form = new FormData();
    // As a File: SDK 58's fetch (expo/fetch) sends a part with bytes(), not React Native's { uri, name, type }.
    form.append('photo', new File(a.uri));
    await send('photo', () => api.authed<Account>('PUT', '/me/photo', form), setPhotoError);
  }
  const remove = () =>
    Alert.alert('Remove your photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void send('photo', () => api.authed<Account>('DELETE', '/me/photo'), setPhotoError) },
    ]);
  const change = (way: 'phone' | 'email') => router.push({ pathname: '/account/contact', params: { way } });

  return (
    <Page title="Edit profile">
      <View style={styles.photo}>
        <Photo me={me} size={PHOTO} />
        <View style={styles.photoPills}>
          <Pill
            label={busy === 'photo' ? 'Saving…' : me.photo ? 'Change photo' : 'Add photo'}
            size="small"
            disabled={!!busy}
            onPress={() => void choose()}
          />
          {me.photo && <Pill label="Remove" size="small" disabled={!!busy} onPress={remove} />}
        </View>
      </View>
      {photoError && <Note>{photoError}</Note>}

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
        <Row
          label="City for new events"
          note={me.city ?? 'Not set'}
          right={<Pill label={me.city ? 'Change' : 'Add'} size="small" onPress={() => router.push('/account/city')} />}
        />
      </Group>

      <Section title="Gender" />
      <View style={styles.chips}>
        <Chips options={GENDERS} value={gender} onChange={(g) => setGender(g === gender ? null : g)} />
      </View>

      <View style={styles.save}>
        <Pill label="Save" size="wide" disabled={!changes || !!busy} onPress={() => void save()} />
        {error && <Note>{error}</Note>}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  photo: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoPills: { flexDirection: 'row', gap: space.small },
  fields: { marginTop: space.big, marginHorizontal: 20 },
  chips: { marginHorizontal: 20 },
  save: { marginTop: space.big },
});
