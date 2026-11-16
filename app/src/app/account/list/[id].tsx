// A saved list's screen, and All saved in full (Account › Saved's See all, id "all"): upcoming soonest first, then
// Past, folded. A list's ⋯ renames or deletes it; deleting keeps its events saved (Saved events and lists doc).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Note, Page, SignInNote } from '../../../account/kit';
import { PastFold, SavedRows } from '../../../account/saved';
import { split } from '../../../account/saves';
import { events, now } from '../../../mock';
import { MenuButton, NotFound } from '../../../rows';
import { deleteList, useSession } from '../../../session';
import { space } from '../../../theme';

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const [deleted, setDeleted] = useState<string | null>(null); // the name, while the page slides away after Delete
  const list = session?.lists.find((l) => l.id === id);

  if (!session) {
    return (
      <Page title="Saved">
        <SignInNote>Sign in to see the events you save.</SignInNote>
      </Page>
    );
  }
  if (deleted) return <Page title={deleted}>{null}</Page>;
  if (id !== 'all' && !list) return <NotFound what="list" />;

  const ids = list ? list.events : session.saved.map((x) => x.id);
  const { upcoming, past } = split(ids, events, now);
  const remove = (l: NonNullable<typeof list>) =>
    Alert.alert(`Delete ${l.name}?`, 'Its events stay saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete list',
        style: 'destructive',
        onPress: () => {
          setDeleted(l.name);
          deleteList(l.id);
          if (router.canGoBack()) router.back();
          else router.replace('/account/saved');
        },
      },
    ]);

  return (
    <Page
      title={list ? list.name : 'All saved'}
      bar={
        list && (
          <MenuButton
            label={`More for ${list.name}`}
            actions={[
              { label: 'Rename list', icon: 'rename', onPress: () => router.push(`/list-name?list=${list.id}`) },
              { label: 'Delete list', icon: 'trash', onPress: () => remove(list) },
            ]}
          />
        )
      }>
      {upcoming.length + past.length === 0 && <Note>{list ? 'Nothing in this list yet.' : 'Nothing saved yet.'}</Note>}
      <View style={{ marginTop: space.big }}>
        <SavedRows events={upcoming} list={list} />
      </View>
      <PastFold events={past} list={list} />
    </Page>
  );
}
