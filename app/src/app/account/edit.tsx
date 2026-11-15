// Edit profile (User doc, Profile): name, photo, date of birth, gender, phone, email and the city for new events nearby.
// No username, bio or links (decision 6 dropped them). The date of birth is shown, never edited: only support changes
// it. Phone and email change with a code sent to the new one (Sign-in and security), so here
// they only show. The photo is a 1:1 rounded square, not a circle.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { profile } from '../../account/data';
import { Chips, EDGE, Field, Group, Page, Pill, Row } from '../../account/kit';
import { maskEmail, maskPhone } from '../../account/rules';
import { Glass } from '../../glass';
import { Monogram, Section } from '../../rows';
import { around, color, radius, space } from '../../theme';

// Optional; a host's form that asks for it fills it in here next time.
const GENDERS = ['Woman', 'Man', 'Non-binary', 'Rather not say'] as const;
const birthday = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function EditProfile() {
  const [name, setName] = useState(profile.name);
  const [gender, setGender] = useState(profile.gender as (typeof GENDERS)[number] | null);
  const changed = name.trim() !== profile.name || gender !== profile.gender;
  return (
    <Page title="Edit profile">
      <View style={styles.photo}>
        <Glass style={styles.photoRim}>
          <Monogram mark={{ initials: profile.initials, bg: color.raised, fg: color.text }} size={72} />
        </Glass>
        <Pill label="Add photo" size="small" />
      </View>

      <View style={styles.fields}>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" maxLength={60} />
      </View>

      <Group>
        {/* Fixed after sign-up: only support changes it, so it shows and never edits. */}
        <Row label="Date of birth" value={birthday.format(new Date(profile.dob))} />
        <Row label="Phone" note={maskPhone(profile.phone)} right={<Pill label="Change" size="small" />} />
        <Row label="Email" note={profile.email ? maskEmail(profile.email) : 'Not added'} right={<Pill label={profile.email ? 'Change' : 'Add'} size="small" />} />
        <Row label="City for new events" value={profile.city ?? 'Not set'} />
      </Group>

      <Section title="Gender" />
      <View style={styles.chips}>
        <Chips options={GENDERS} value={gender} onChange={(g) => setGender(g === gender ? null : g)} />
      </View>

      <View style={styles.save}>
        {/* ponytail: saves nowhere until the API exists. */}
        <Pill label="Save" size="wide" disabled={!changed || !name.trim()} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  photo: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoRim: { padding: EDGE, borderRadius: around(radius.md, EDGE) },
  fields: { marginTop: space.big, marginHorizontal: 20 },
  chips: { marginHorizontal: 20 },
  save: { marginTop: space.big },
});
