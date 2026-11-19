// The head of Account's glass panel and of the profile's, grown (owner, 16 Nov 2026: "the profile should be a seperate
// screen"). On Account, View profile opens the profile screen (src/app/account/profile.tsx), which fades in with the
// head grown.
import type { Me as Account } from '@orbit/contract';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { past } from './data';
import { EDGE, Pill } from './kit';
import { year } from './rules';
import { Glass } from '../glass';
import { type Followed, hostsApi, markOf } from '../hosts';
import { useLoad } from '../load';
import { hosts } from '../mock';
import { Monogram } from '../rows';
import { api, useMe, useSession, useViewer } from '../session';
import { around, color, font, space } from '../theme';

const PHOTO = 72; // the photo at rest on Account
const GROWN = 96; // the photo grown
const SLOT = 44; // View profile's place, which the counts take

// Your photo, a circle in Account's 1px frosted rim (owner, 17 Nov 2026: "instead of squared profile use rounded one"),
// or your initials until there's one.
export function Photo({ me, size }: { me: Pick<Account, 'id' | 'name' | 'photo'>; size: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Glass style={{ padding: EDGE, borderRadius: around(size / 2, EDGE) }}>
      {me.photo ? (
        <Image source={{ uri: me.photo }} style={[round, styles.photo]} accessibilityIgnoresInvertColors />
      ) : (
        <Monogram mark={{ initials: markOf({ id: me.id, name: me.name ?? '' }).initials, bg: color.fill, fg: color.text }} size={size} round />
      )}
    </Glass>
  );
}

// The last good answer, so a screen opening over another (Profile over Account) counts the same while its own read is
// out, and a failed read keeps the count it had. Kept for the account it was read for only.
// ponytail: one list in memory; TanStack Query's shared cache replaces it (src/load.ts).
let lastGood: { key: string; data: Followed[] } | null = null;

// The hosts you follow: the API's (GET /me/follows), read again each time the screen comes back into view so a follow
// changed on a host page counts, and the mock's, followed on this phone until events reach the API (src/session.ts).
// `data` is the API's list, or the last good one while this screen's read is out.
export function useFollows() {
  const viewer = useViewer();
  const me = useMe();
  const key = viewer.signedIn ? `follows|${me.id}` : null;
  const real = useLoad(key, () => hostsApi(api).follows());
  useEffect(() => {
    if (key && real.data) lastGood = { key, data: real.data };
  }, [key, real.data]);
  const data = real.data ?? (lastGood?.key === key ? lastGood.data : null);
  const first = useRef(true);
  const { reload } = real;
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false; // the first view's read is already under way
      else reload();
    }, [reload]),
  );
  const mock = hosts.filter((h) => viewer.follows.includes(h.id));
  return { real, data, mock, count: (data?.length ?? 0) + mock.length };
}

// Account's head shows View profile, the way in (owner, 19 Nov 2026: "replace swipe down, and change to button"; it was
// a pull with two chevrons); `grown` (the profile) shows the photo grown from 72 to 96, up into the panel's extra
// room, and Going, Been and Following in the button's place. `following` is useFollows' count, which the screen reads
// anyway for its own rows.
export function ProfileHead({ grown = false, onOpen, following }: { grown?: boolean; onOpen?: () => void; following: number }) {
  const me = useSession()?.me;
  const viewer = useViewer();
  if (!me) return null; // signed out: Account draws its own head, and the profile says to sign in
  return (
    <View style={styles.head}>
      {/* Grown from its bottom edge, so it never covers the name. */}
      <View style={grown && styles.grown}>
        <Photo me={me} size={PHOTO} />
      </View>
      <Text style={styles.name} accessibilityRole="header">
        {me.name}
      </Text>
      {/* No phone number, and "Since", not "On Orbit since" (owner, 15 Nov 2026: "remove mobile number", "remove on
          Orbit just since 2025"). */}
      <Text style={styles.meta}>Since {year(me.since)}</Text>
      <View style={styles.slot}>
        {grown ? (
          <View style={styles.counts}>
            <Count n={viewer.tickets?.length ?? 0} label="Going" />
            <Count n={past.filter((x) => x.status === 'Went').length} label="Been" />
            <Count n={following} label="Following" />
          </View>
        ) : (
          onOpen && <Pill label="View profile" size="small" onPress={onOpen} />
        )}
      </View>
    </View>
  );
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countN}>{n}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { marginHorizontal: 20, alignItems: 'center' },
  grown: { transformOrigin: 'bottom', transform: [{ scale: GROWN / PHOTO }] },
  photo: { backgroundColor: color.raised }, // while it loads
  name: { marginTop: space.small + 4, fontFamily: font.headline, fontSize: 22, lineHeight: 28, color: color.text },
  meta: { marginTop: 2, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary, textAlign: 'center' },
  slot: { marginTop: 16, height: SLOT, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  counts: { flexDirection: 'row', gap: 40 },
  count: { alignItems: 'center' },
  countN: { fontFamily: font.headline, fontSize: 20, lineHeight: 24, color: color.text },
});
