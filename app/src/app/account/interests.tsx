// Account › Interests (owner, 19 Nov 2026: "add interest cards for events", all four): the kinds of event you like, as
// Explore's boxes (src/categories.tsx). A tap picks or unpicks at once; Home's near-you list then puts those kinds first
// (src/home/layout.ts). Kept by the API (src/session.ts); the kinds offered are staff's (Galaxy App content, orbit-pm X13).
import { View } from 'react-native';

import { Page, SignInNote } from '../../account/kit';
import { CategoryGrid } from '../../categories';
import { useOffered } from '../../content';
import { setInterest, useSession } from '../../session';
import { space } from '../../theme';

export default function Interests() {
  const s = useSession();
  const offered = useOffered();
  if (!s)
    return (
      <Page title="Interests">
        <SignInNote>Sign in to pick what you like.</SignInNote>
      </Page>
    );
  const picked = s.interests ?? [];
  return (
    <Page title="Interests">
      <View style={{ marginTop: space.big }}>
        <CategoryGrid only={offered} picked={picked} onPress={(slug) => setInterest(slug, !picked.includes(slug))} />
      </View>
    </Page>
  );
}
