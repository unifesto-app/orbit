// Account › Interests (owner, 19 Nov 2026: "add interest cards for events", all four): the kinds of event you like, as
// Explore's boxes (src/categories.tsx). A tap picks or unpicks at once; Home's near-you list then puts those kinds first
// (src/home/layout.ts). Kept on this phone for now (src/session.ts).
import { View } from 'react-native';

import { Page, SignInNote } from '../../account/kit';
import { CategoryGrid } from '../../categories';
import { setInterest, useSession } from '../../session';
import { space } from '../../theme';

export default function Interests() {
  const s = useSession();
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
        <CategoryGrid picked={picked} onPress={(slug) => setInterest(slug, !picked.includes(slug))} />
      </View>
    </Page>
  );
}
