// Event Request (owner, 16 Nov 2026: "Redesign the Host an Event screen. It should be Event Request in it add Host
// Details too", then "Orbit staff approve first"). Opened from the switcher's Host an event card, and by Console for
// someone on no team. One form in two parts, the host and the event, then Send request; Orbit staff review it in
// Galaxy (src/requests.ts). Once sent, the screen shows the request and where it stands instead of the form.
// Titles and values only, as everywhere in Account. Signed out, the form still fills in (ask late), and Send request
// opens the sign-in sheet over it.
// ponytail: When is typed, not picked; the app has no date picker (a native module) and staff read it anyway.
import { categories, popularCities } from '@orbit/contract';
import { type ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { profile } from '../../account/data';
import { Chips, Field, Group, Page, Pill, Row, styles as kit } from '../../account/kit';
import { day } from '../../account/rules';
import { sendRequest, useMyRequest } from '../../requests';
import { Section } from '../../rows';
import { needsAccount, useSignedIn } from '../../session';
import { space } from '../../theme';

// The Hosts doc's kinds of host.
const KINDS = ['College club', 'Comedy group', 'Jam circle', 'Café meetup', 'Startup community', 'Company', 'Housing society', 'Other'] as const;
const CITIES = popularCities.slice(0, 6).map((c) => c.name);
const CATEGORIES = categories.map((c) => c.label);
const TICKETS = ['Free', 'Paid'] as const;
const SIZES = ['Up to 50', '50 to 200', '200 to 500', 'Over 500'] as const;

export default function EventRequest() {
  const signedIn = useSignedIn();
  const sent = useMyRequest();
  const [host, setHost] = useState('');
  const [about, setAbout] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(profile.city);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  const [venue, setVenue] = useState('');
  const [tickets, setTickets] = useState<(typeof TICKETS)[number] | null>(null);
  const [size, setSize] = useState<string | null>(null);

  if (signedIn && sent)
    return (
      <Page title="Event Request">
        <Group>
          <Row label="Status" value={sent.status} />
          <Row label="Event" value={sent.event.title} />
          <Row label="Host" value={sent.host.name} />
          <Row label="Sent" value={day(sent.sent)} />
        </Group>
      </Page>
    );

  const ready = [host, kind, city, title, category, when, venue, tickets, size].every((x) => typeof x === 'string' && x.trim());
  const send = () =>
    signedIn
      ? sendRequest({
          host: { name: host.trim(), kind: kind!, city: city!, about: about.trim() },
          event: { title: title.trim(), category: category!, when: when.trim(), venue: venue.trim(), tickets: tickets!, size: size! },
        })
      : needsAccount();

  return (
    <Page title="Event Request">
      <Section title="Host details" />
      <View style={styles.part}>
        <Field label="Host name" value={host} onChangeText={setHost} placeholder="Jam Circle Hyderabad" autoCapitalize="words" maxLength={60} />
        <Field label="About" value={about} onChangeText={setAbout} placeholder="Open jams every Sunday in KBR Park" maxLength={100} />
        <Pick label="What kind">
          <Chips options={KINDS} value={kind} onChange={setKind} />
        </Pick>
        <Pick label="City">
          <Chips options={CITIES} value={city} onChange={setCity} />
        </Pick>
      </View>

      <Section title="Event" />
      <View style={styles.part}>
        <Field label="Event name" value={title} onChangeText={setTitle} placeholder="Sunday Jam" autoCapitalize="words" maxLength={80} />
        <Pick label="Category">
          <Chips options={CATEGORIES} value={category} onChange={setCategory} />
        </Pick>
        <Field label="When" value={when} onChangeText={setWhen} placeholder="Sun 6 Dec, 5 PM" maxLength={60} />
        <Field label="Venue" value={venue} onChangeText={setVenue} placeholder="KBR Park, main gate" autoCapitalize="words" maxLength={100} />
        <Pick label="Tickets">
          <Chips options={TICKETS} value={tickets} onChange={setTickets} />
        </Pick>
        <Pick label="Expected people">
          <Chips options={SIZES} value={size} onChange={setSize} />
        </Pick>
      </View>

      <View style={styles.send}>
        <Pill label="Send request" size="wide" disabled={!ready} onPress={send} />
      </View>
    </Page>
  );
}

// A pick among chips, under a label like a field's.
function Pick({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={kit.field}>
      <Text style={kit.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  part: { marginHorizontal: 20, gap: space.big },
  send: { marginTop: 40 },
});
