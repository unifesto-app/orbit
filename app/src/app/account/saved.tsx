// Account › Saved, the one home of saved events (Saved events and lists doc, settled 16 Nov 2026): the lists first,
// each with how many upcoming events it holds and the next one's date, and New list; then All saved, the next five
// upcoming with See all, then Past, folded. Signed out, a line and Sign in.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Group, Note, Page, Pill, Row, SignInNote, TONE } from '../../account/kit';
import { PastFold, SavedRows } from '../../account/saved';
import { MAX_LISTS, MAX_SAVED, TOO_MANY, byTouched, split } from '../../account/saves';
import { drawn } from '../../account/savesApi';
import { showNote } from '../../note';
import { Failed, Section, Waiting } from '../../rows';
import { canOpen, reloadSaves, useSavesOnFocus, useSavesStatus, useSession } from '../../session';
import { space } from '../../theme';

const FIRST = 5; // All saved shows the next five upcoming, then See all
const count = new Intl.NumberFormat('en-IN');
// The lists' icons, a colour each in turn (Account's rule: no two alike within a card, as far as ten go).
const TONES = Object.values(TONE);

export default function Saved() {
  const session = useSession();
  const status = useSavesStatus();
  useSavesOnFocus();
  if (!session) {
    return (
      <Page title="Saved">
        <SignInNote>Sign in to see the events you save.</SignInNote>
      </Page>
    );
  }
  // Until the saves are read there's nothing to count: a wait, not "Nothing saved yet" (or Failed, with Try again).
  if (status !== 'ready') {
    return (
      <Page title="Saved">
        {status === 'failed' ? <Failed message="Can’t load your saved events. Check your connection and try again." retry={reloadSaves} /> : <Waiting />}
      </Page>
    );
  }
  const events = drawn(session.saved.map((x) => x.id));
  const now = Date.now();
  const { upcoming, past } = split(session.saved.map((x) => x.id), events, now);
  const counted = session.saved.filter((x) => canOpen(x.id)).length; // hidden saves don't count
  const lists = byTouched(session.lists);
  const newList = () => (lists.length >= MAX_LISTS ? showNote({ text: TOO_MANY }) : router.push('/list-name'));

  return (
    <Page title="Saved">
      {counted >= MAX_SAVED && <Note>{`${count.format(counted)} of ${count.format(MAX_SAVED)}`}</Note>}

      <Group title="Lists">
        {lists.map((l, i) => {
          const next = split(l.events, events, now).upcoming;
          return (
            <Row
              key={l.id}
              icon="list"
              tone={TONES[i % TONES.length]}
              label={l.name}
              note={next[0]?.when.split(' · ')[0]} // the next one's date, "Sat 21 Nov"
              value={`${next.length} upcoming`}
              onPress={() => router.push(`/account/list/${l.id}`)}
            />
          );
        })}
        <Row icon="listPlus" label="New list" onPress={newList} />
      </Group>

      <Section title="All saved" />
      {upcoming.length + past.length === 0 && <Note>Nothing saved yet.</Note>}
      <SavedRows events={upcoming.slice(0, FIRST)} />
      {upcoming.length > FIRST && (
        <View style={{ marginTop: space.small }}>
          <Pill label="See all" size="wide" onPress={() => router.push('/account/list/all')} />
        </View>
      )}
      <PastFold events={past} />
    </Page>
  );
}
