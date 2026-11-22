// Events, Orbit Launch's first tab (take 1, approved 22 Nov 2026: https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg;
// direction C, "events first", picked for the Orbit app's Console on 16 Nov). One host's events, each card holding its
// own work, so nothing waiting is listed apart from its event:
// - events whose check-in is open come first, under Tonight, Today or Tomorrow (the one starting soonest first; a card
//   not starting today shows its date), with their door line: how many are in, Scan and Find someone (Event day doc:
//   from 24 hours before the start until 3 hours after the end);
// - then what's coming (Next, or Upcoming for several), Drafts with Continue, and Past;
// - on each card its refund requests ("With Orbit" from 24 hours before the start), its invites not yet accepted and,
//   3 days after it ends, its payout with Request.
// The host switcher and New event head it; the host's own colour glows from the top, as on its page in the Orbit app.
// ponytail: the switcher, New event, Scan, Find someone, Continue, Request and the rows open nothing yet; each is a later
// take. Admins' view only, from the mock (src/launch/data.ts). Past lists every past event; add See all when it's long.
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { color, font, space } from '@orbit/mobile/theme';
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type LaunchEvent, drafts, endsAt, events, host, invites, now, salesOf } from '../../launch/data';
import { split, startsToday } from '../../launch/day';
import { available, hostDecidesRefunds, payoutOpens, rupees } from '../../launch/money';
import { CARET, EventCard, Glow, Monogram, Pill, Row, Section } from '../../launch/ui';

type Stage = 'open' | 'next' | 'past';
const date = (when: string) => when.split(' · ')[0]; // "Fri 20 Nov"
const time = (when: string) => when.split(' · ')[1] ?? when; // "8:00 PM", under Tonight's heading

export default function Events() {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const { groups, next, past } = split(events, endsAt, now);

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.head}>
          <Pressable style={styles.switcher} accessibilityRole="button" accessibilityLabel={`${host.name}. Switch host`}>
            <Monogram host={host} size={32} />
            <Text style={styles.hostName} numberOfLines={1}>
              {host.name}
            </Text>
            <Image source={CARET} style={styles.caret} />
          </Pressable>
          <Pill label="New event" dark />
        </View>
        {groups.map((g) => (
          <Cards key={g.word} title={g.word}>
            {g.events.map((e) => (
              <Card key={e.id} event={e} stage="open" />
            ))}
          </Cards>
        ))}
        {next.length > 0 && (
          <Cards title={next.length === 1 ? 'Next' : 'Upcoming'}>
            {next.map((e) => (
              <Card key={e.id} event={e} stage="next" />
            ))}
          </Cards>
        )}
        {drafts.length > 0 && (
          <Cards title="Drafts">
            {drafts.map((d) => (
              <EventCard key={d.id} title={d.name} right={<Pill label="Continue" />} />
            ))}
          </Cards>
        )}
        {past.length > 0 && (
          <Cards title="Past">
            {past.map((e) => (
              <Card key={e.id} event={e} stage="past" />
            ))}
          </Cards>
        )}
        {events.length === 0 && drafts.length === 0 && <Text style={styles.empty}>No events yet.</Text>}
      </ScrollView>
    </View>
  );
}

function Cards({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Section title={title} />
      <View style={styles.cards}>{children}</View>
    </>
  );
}

// One event and what's waiting on it.
function Card({ event: e, stage }: { event: LaunchEvent; stage: Stage }) {
  const s = salesOf(e.id);
  const sold = s && (stage === 'past' ? `${s.checkedIn} of ${s.booked} came` : s.seats ? `${s.booked} of ${s.seats} sold` : `${s.booked} sold`);
  const decides = hostDecidesRefunds(e.startsAt, now); // else the requests are Orbit's to decide
  const waiting = invites.filter((i) => i.eventId === e.id);
  const payout = stage === 'past' && s && payoutOpens(s) <= now ? available(s) : 0;
  return (
    <EventCard
      title={e.title}
      poster={e.poster}
      when={stage === 'open' && startsToday(e.startsAt, now) ? time(e.when) : stage === 'past' ? date(e.when) : e.when}
      tag={e.repeats}
      sold={s && sold ? `${sold} · ${rupees(s.salesPaise)}` : undefined}
      share={s?.seats && stage !== 'past' ? s.booked / s.seats : undefined}
    >
      {stage === 'open' && (
        <Row
          label={`In ${s?.checkedIn ?? 0} of ${s?.booked ?? 0}`}
          right={
            <>
              <Pill label="Scan" />
              <Pill label="Find someone" />
            </>
          }
        />
      )}
      {s && s.refundsWaiting > 0 && (
        <Row
          label={s.refundsWaiting === 1 ? 'Refund request' : `${s.refundsWaiting} refund requests`}
          value={decides ? rupees(s.openRefundsPaise) : 'With Orbit'}
          onPress={decides ? () => {} : undefined}
        />
      )}
      {waiting.length > 0 && (
        <Row
          label={waiting.length === 1 ? 'Invite not accepted' : `${waiting.length} invites not accepted`}
          value={waiting.length === 1 ? waiting[0].role : undefined}
          onPress={() => {}}
        />
      )}
      {payout > 0 && <Row label="Payout ready" value={rupees(payout)} right={<Pill label="Request" />} />}
    </EventCard>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  head: { height: 44, marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  switcher: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.small },
  hostName: { flexShrink: 1, fontFamily: font.title, fontSize: 17, color: color.text },
  caret: { width: 14, height: 14, tintColor: color.secondary },
  cards: { gap: space.big },
  empty: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.text, fontSize: 15, color: color.secondary },
});
