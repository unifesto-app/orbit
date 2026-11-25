// Your profile, its own screen (owner, 16 Nov 2026: "the profile should be a seperate screen"; User doc, decision 6:
// kept). Only you see it. Take 1, "Account's card, grown" (owner, 19 Nov 2026: "Build Take 1"; mock
// https://claude.ai/artifact/6ydYrdp36Qy2qcL6sXtnHV): its top is Account's glass panel, REVEAL taller with the photo
// grown and Edit profile where Account has View profile, fading in over Account (src/app/_layout.tsx). Under it, three
// cards: Going, Been and Following, each opening its screen; the hosts you follow; and your interests. The back circle
// returns to Account, as on every Account screen.
// The account is the API's (/me, src/session.ts); the hosts you follow are the Following screen's (useFollows). Going
// and Been still count the mock's tickets and past bookings until bookings reach the API; interests are kept on this
// phone (src/session.ts).
import { categories } from '@orbit/contract';
import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { past } from '../../account/data';
import { Group, Note, Page, Panel, Pill, REVEAL, Row, SignInNote, styles as kit } from '../../account/kit';
import { ProfileHead, useFollows } from '../../account/profile';
import { Glass } from '../../glass';
import { markOf } from '../../hosts';
import { Monogram, Section, Tag } from '../../rows';
import { useSignedIn, useViewer } from '../../session';
import { color, font, space, stoneAt } from '../../theme';

const LOGO = 32; // a host's logo in its row
const LOGO_GAP = 12; // from the logo to the name, as from an Account row's icon to its label

export default function Profile() {
  const signedIn = useSignedIn();
  const viewer = useViewer();
  const { real, data, count } = useFollows();
  const following = [
    ...(data ?? []).map((h) => ({ id: h.id, to: `/host/${h.slug}` as Href, mark: markOf(h), name: h.name, verified: h.verified })),
  ];
  // Signed out while here (on another device, or the session ended): nothing of the account stays on screen.
  if (!signedIn)
    return (
      <Page title="Profile">
        <SignInNote>Sign in to see your profile.</SignInNote>
      </Page>
    );
  const counts: { n: number; label: string; to: Href }[] = [
    { n: viewer.tickets?.length ?? 0, label: 'Going', to: '/account/tickets' },
    { n: past.filter((x) => x.status === 'Went').length, label: 'Been', to: '/account/history' },
    { n: count, label: 'Following', to: '/account/following' },
  ];
  const picked = viewer.interests ?? [];
  const liked = categories.filter((c) => picked.includes(c.slug)); // in Explore's order
  return (
    <Page>
      <Panel extra={REVEAL}>
        {/* Edit profile moved here from Account's head (owner, 15 Nov 2026: "move edit to profile screen"). */}
        <ProfileHead grown pill="Edit profile" onPress={() => router.push('/account/edit')} />
      </Panel>

      <Glass style={[kit.rim, kit.spaced]}>
        <View style={[kit.face, styles.counts]}>
          {counts.map((c, i) => (
            <Pressable
              key={c.label}
              onPress={() => router.push(c.to)}
              accessibilityRole="button"
              accessibilityLabel={`${c.n} ${c.label}`}
              style={({ pressed }) => [styles.count, i > 0 && styles.split, pressed && kit.pressed]}>
              <Text style={styles.countN}>{c.n}</Text>
              <Text style={styles.countLabel}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      </Glass>

      {following.length > 0 ? (
        <Group title="Hosts you follow" indent={LOGO + LOGO_GAP}>
          {following.map((h) => (
            <Row
              key={h.id}
              lead={
                <View style={styles.logo}>
                  <Monogram mark={h.mark} size={LOGO} />
                </View>
              }
              label={h.name}
              verified={h.verified}
              chevron
              onPress={() => router.push(h.to)}
            />
          ))}
        </Group>
      ) : (
        real.error && <Section title="Hosts you follow" />
      )}
      {real.error && (
        <View style={[styles.failed, following.length > 0 && styles.afterCard]}>
          <Note>{real.error.message}</Note>
          <View style={styles.retry}>
            <Pill label="Try again" size="small" onPress={real.reload} />
          </View>
        </View>
      )}

      {/* The kinds of event you picked (Account › Interests, or Home's one ask), as tags; Change opens the picker. */}
      <Section title="Interests" />
      <Glass style={kit.rim}>
        <View style={kit.face}>
          {liked.length > 0 ? (
            <View style={styles.tags}>
              {liked.map((c) => (
                <Tag key={c.slug} text={c.label} />
              ))}
            </View>
          ) : (
            <Text style={kit.note}>None picked yet</Text>
          )}
          <View style={styles.ask}>
            <Pill label={liked.length > 0 ? 'Change' : 'Pick'} size="small" onPress={() => router.push('/account/interests')} />
          </View>
        </View>
      </Glass>
    </Page>
  );
}

const styles = StyleSheet.create({
  // Three across, edge to edge in the face, split by hairlines like the rows'.
  counts: { flexDirection: 'row', paddingHorizontal: 0 },
  count: { flex: 1, alignItems: 'center' },
  split: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: stoneAt(0.12) },
  countN: { fontFamily: font.headline, fontSize: 20, lineHeight: 24, color: color.text },
  countLabel: { marginTop: 2, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  logo: { marginRight: LOGO_GAP - space.small }, // the row's own gap makes up the rest
  failed: { gap: space.small },
  afterCard: { marginTop: space.small }, // under the card; under the heading alone, the heading's 16 is enough
  retry: { marginHorizontal: 20, flexDirection: 'row' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  ask: { marginTop: 16, flexDirection: 'row' }, // 16 from the words to the button (text cards)
});
