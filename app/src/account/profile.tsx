// The head of Account's glass panel, which grows into the profile's (owner, 15 Nov 2026: "make drag to view profile
// V V", "drag transition is needed", then picked "Panel grows into profile"; 16 Nov: "the profile should be a seperate
// screen"). `p` is how far it has grown: 0 at rest on Account, with two chevrons; 1 grown, the photo up from 72 to 96
// and Going, Been and Following where the chevrons were. Account drives `p` with the pull; the profile screen
// (src/app/account/profile.tsx) shows it grown, so the screen fades in over a panel that already looks like its top.
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { past, profile } from './data';
import { EDGE } from './kit';
import { year } from './rules';
import { Glass, useAccessibility } from '../glass';
import { Icon } from '../icons';
import { Monogram } from '../rows';
import { useViewer } from '../session';
import { around, color, font, radius, space } from '../theme';

const PHOTO = 72; // the photo at rest on Account
const GROWN = 96; // the photo grown
const SLOT = 44; // the chevrons' place, which the counts take

// `onChevrons` shows the chevrons (Account) and is their tap, Android's way in; without it (the profile) only the
// counts show.
export function ProfileHead({ p, onChevrons }: { p: Animated.AnimatedInterpolation<number>; onChevrons?: () => void }) {
  const chevrons = !!onChevrons;
  const viewer = useViewer(); // follows made on this phone count (src/session.ts)
  const reduceMotion = useAccessibility('reduceMotionChanged');
  const [bob] = useState(() => new Animated.Value(0));
  // The chevrons bob gently while nothing is pulled; not under Reduce Motion.
  useEffect(() => {
    if (!chevrons || reduceMotion) return;
    const half = (toValue: number) => Animated.timing(bob, { toValue, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([half(1), half(0)]));
    loop.start();
    return () => loop.stop();
  }, [bob, chevrons, reduceMotion]);
  const [a] = useState(() => ({
    grow: p.interpolate({ inputRange: [0, 1], outputRange: [1, GROWN / PHOTO] }),
    chevrons: p.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }),
    counts: p.interpolate({ inputRange: [0.4, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    rise: p.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
    bob: bob.interpolate({ inputRange: [0, 1], outputRange: [0, 4] }),
  }));
  return (
    <View style={styles.head}>
      {/* Grows from its bottom edge, up into the room the stretch makes, so it never covers the name. */}
      <Animated.View style={[styles.grows, { transform: [{ scale: a.grow }] }]}>
        <Glass style={styles.photoRim}>
          <Monogram mark={{ initials: profile.initials, bg: color.raised, fg: color.text }} size={PHOTO} />
        </Glass>
      </Animated.View>
      <Text style={styles.name} accessibilityRole="header">
        {profile.name}
      </Text>
      {/* No phone number, and "Since", not "On Orbit since" (owner, 15 Nov 2026: "remove mobile number", "remove on
          Orbit just since 2025"). */}
      <Text style={styles.meta}>Since {year(profile.since)}</Text>
      <View style={styles.slot}>
        {onChevrons && (
          <Animated.View style={[styles.fill, { opacity: a.chevrons }]}>
            <Pressable onPress={onChevrons} accessibilityRole="button" accessibilityLabel="View profile" hitSlop={12}>
              <Animated.View style={{ transform: [{ translateY: a.bob }] }}>
                <Icon name="chevronDown" size={18} color={color.secondary} />
                <View style={styles.next}>
                  <Icon name="chevronDown" size={18} color="rgba(255, 255, 255, 0.32)" />
                </View>
              </Animated.View>
            </Pressable>
          </Animated.View>
        )}
        <Animated.View
          style={[styles.fill, styles.counts, { opacity: a.counts, transform: [{ translateY: a.rise }] }]}
          pointerEvents="none"
          accessibilityElementsHidden={chevrons}
          importantForAccessibility={chevrons ? 'no-hide-descendants' : 'auto'}>
          <Count n={viewer.tickets?.length ?? 0} label="Going" />
          <Count n={past.filter((x) => x.status === 'Went').length} label="Been" />
          <Count n={viewer.follows.length} label="Following" />
        </Animated.View>
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
  grows: { transformOrigin: 'bottom' },
  photoRim: { padding: EDGE, borderRadius: around(radius.md, EDGE) },
  name: { marginTop: space.small + 4, fontFamily: font.headline, fontSize: 22, lineHeight: 28, color: color.text },
  meta: { marginTop: 2, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary, textAlign: 'center' },
  slot: { marginTop: 16, height: SLOT, alignSelf: 'stretch' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  next: { marginTop: -8 }, // the second chevron tucked under the first
  counts: { flexDirection: 'row', gap: 40 },
  count: { alignItems: 'center' },
  countN: { fontFamily: font.headline, fontSize: 20, lineHeight: 24, color: color.text },
});
