// One event on Console's first tab, holding its own work (owner, 16 Nov 2026, picked direction C, "events first"): the
// poster and how it's selling at the head, then a line per thing to do on it, between hairlines: the door on its day,
// refund requests, invites, a payout. Nothing waiting is listed apart from its event. Card corners nest outward from the
// poster's (radius.sm + 16 padding = 22, + the 2px frosted rim = 24), like the event page's info cards. A draft has no
// poster yet, so a blank stands in.
import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PAD, styles as kit } from '../account/kit';
import { Glass } from '../glass';
import type { MediaItem } from '../media';
import { Poster, Tag } from '../rows';
import { around, color, font, radius, rim, space } from '../theme';

const POSTER = 72; // 3:4, so 96 tall
const FACE = around(radius.sm, PAD);

export function EventCard({
  title,
  poster,
  when,
  tag,
  sold,
  share,
  right,
  children,
}: {
  title: string;
  poster?: MediaItem;
  when?: string;
  tag?: string; // the repeat tag, or the viewer's role on the event
  sold?: string; // "31 of 40 sold · ₹9,269"
  share?: number; // 0 to 1, drawn as a bar under `sold`
  right?: ReactNode; // a control beside the head (a draft's Continue)
  children?: ReactNode; // rows under the head
}) {
  const rows = Children.toArray(children); // drops the false and null of rows shown only sometimes
  return (
    <Glass style={styles.rim}>
      <View style={styles.face}>
        <View style={styles.head}>
          {poster ? <Poster media={poster} width={POSTER} label={title} /> : <View style={styles.blank} />}
          <View style={styles.lines}>
            {(when || tag) && (
              <View style={styles.whenRow}>
                {when && <Text style={styles.meta}>{when}</Text>}
                {tag && <Tag text={tag} />}
              </View>
            )}
            <Text style={styles.title}>{title}</Text>
            {sold && <Text style={styles.meta}>{sold}</Text>}
            {share !== undefined && (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(1, share) * 100}%` }]} />
              </View>
            )}
          </View>
          {right}
        </View>
        {rows.map((row, i) => (
          <Fragment key={i}>
            <View style={[kit.hairline, i === 0 && styles.firstLine]} />
            {row}
          </Fragment>
        ))}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  rim: { marginHorizontal: 20, padding: rim, borderRadius: around(FACE, rim) },
  face: { borderRadius: FACE, backgroundColor: color.card, padding: PAD },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blank: { width: POSTER, height: (POSTER * 4) / 3, borderRadius: radius.sm, backgroundColor: color.raised },
  lines: { flex: 1, minWidth: 0, gap: 3 },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.small },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  title: { fontFamily: font.title, fontSize: 17, lineHeight: 22, color: color.text },
  // How much is sold, in the accent: an element, never text.
  track: { marginTop: 4, height: 6, borderRadius: 3, backgroundColor: color.raised, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: color.accent },
  firstLine: { marginTop: PAD }, // the head sits a full padding above the first hairline
});
