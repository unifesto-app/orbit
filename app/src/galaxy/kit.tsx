// What Galaxy's pushed screens share: the feature check, a staff page's head, two choices side by side, the grey lines
// that say an action is logged, and the reason sheet every risky action goes through.
import { Redirect, router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pill } from '../account/kit';
import { type Me, type StaffFeature, hasFeature } from '../modes';
import { Monogram, Tag } from '../rows';
import { useMe } from '../session';
import { color, font, space } from '../theme';
import { FEATURE_NAMES } from './data';
import { type Held, hold, release } from './held';

// A pushed Galaxy screen shows only with one of its features, as the tabs do (Roles doc); anyone else goes back to the
// dashboard, and anyone with no feature at all on to Home (src/app/galaxy/_layout.tsx). The API is the real gate.
export function NeedsFeature({ feature, children }: { feature: StaffFeature | StaffFeature[]; children: ReactNode }) {
  const me = useMe();
  return [feature].flat().some((f) => hasFeature(me, f)) ? children : <Redirect href="/galaxy" />;
}
// A whole screen behind NeedsFeature, checked before the screen looks anything up, so a bad link tells someone without
// the feature nothing about what exists.
export const gated = (feature: StaffFeature | StaffFeature[], Screen: () => ReactNode) =>
  function Gated() {
    return (
      <NeedsFeature feature={feature}>
        <Screen />
      </NeedsFeature>
    );
  };

// A row's way into another Galaxy screen, only for someone holding that screen's feature; anyone else gets a plain
// row rather than a tap that bounces them back to the dashboard.
export const opener = (me: Me, feature: StaffFeature, path: string) => (hasFeature(me, feature) ? () => router.push(path) : undefined);

// A grey line under an action or a field: "Logged, and everyone with Money is emailed", "Each Show is logged". These
// break Account's "titles only" rule; the Galaxy canvas proposes them (16 Nov 2026) and the owner hasn't ruled yet.
// To take them all away, return null here.
// `flush` drops the page margins, inside a sheet that has its own.
export function StaffNote({ children, flush = false }: { children: string; flush?: boolean }) {
  return <Text style={[styles.staffNote, flush && styles.flush]}>{children}</Text>;
}

export const emailed = (feature: StaffFeature) => `Logged, and everyone with ${FEATURE_NAMES[feature]} is emailed.`;

// A staff page's head: the 1:1 logo or photo (a monogram until real ones), the name, a grey line and any marks.
export function Head({ mark, name, note, tags = [] }: { mark: { initials: string; bg: string; fg?: string }; name: string; note: string; tags?: string[] }) {
  return (
    <View style={styles.head}>
      <View style={styles.who}>
        <Monogram mark={{ initials: mark.initials, bg: mark.bg, fg: mark.fg ?? color.text }} size={64} />
        <View style={styles.names}>
          <Text style={styles.name} accessibilityRole="header">
            {name}
          </Text>
          <Text style={styles.note}>{note}</Text>
        </View>
      </View>
      {tags.length > 0 && (
        <View style={styles.tags}>
          {tags.map((t) => (
            <Tag key={t} text={t} />
          ))}
        </View>
      )}
    </View>
  );
}

// Two buttons sharing a row: a decision and its other way.
export function Choices({ choices }: { choices: { label: string; onPress?: () => void; disabled?: boolean; muted?: boolean }[] }) {
  return (
    <View style={styles.choices}>
      {choices.map((c) => (
        <View key={c.label} style={styles.choice}>
          <Pill label={c.label} onPress={c.onPress} disabled={c.disabled} muted={c.muted} />
        </View>
      ))}
    </View>
  );
}

// A risky action (Roles doc): a written reason the other side sees, an audit row written with the change, and an email
// to everyone holding the feature. It opens the reason sheet, src/app/galaxy/reason.tsx. No passcode again: Galaxy asks
// for it on entering (Roles decision 11).
export type Risky = { title: string; line: string; action: string; who: string; feature: StaffFeature };
// With `run` (an action the API has), the sheet runs it with the reason; its words and the call are held in memory
// (src/galaxy/held.ts), never in the link. Without one, the sheet only closes.
export function askReason(r: Risky, run?: Held['run']) {
  if (!run) {
    release();
    return router.push({ pathname: '/galaxy/reason', params: r });
  }
  router.push({ pathname: '/galaxy/reason', params: { ticket: hold({ ...r, run }) } });
}

const styles = StyleSheet.create({
  staffNote: { marginHorizontal: 20, marginTop: space.small, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  flush: { marginHorizontal: 0, marginTop: 0 },
  head: { marginHorizontal: 20, gap: 16 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  names: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: font.headline, fontSize: 24, lineHeight: 30, color: color.text },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  choices: { marginHorizontal: 20, marginTop: space.small, flexDirection: 'row', gap: space.small },
  choice: { flex: 1 },
});
