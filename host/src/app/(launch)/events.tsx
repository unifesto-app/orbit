// Events, Orbit Launch's first tab (take 1, approved 22 Nov 2026: https://claude.ai/artifact/BwnBQDW2N2hpihmrSSTnsg;
// direction C, "events first", picked for the Orbit app's Console on 16 Nov). One host's events, each card holding its
// own work, so nothing waiting is listed apart from its event:
// - events whose check-in is open come first, under Tonight, Today or Tomorrow (the one starting soonest first; a card
//   not starting today shows its date), with their door line: how many are in, Scan and Find someone (Event day doc:
//   from 24 hours before the start until 3 hours after the end);
// - then what's coming (Next, or Upcoming for several), Drafts with Continue, and Past;
// - on a published event still to come, Messages: its announcements and automatic messages (src/app/event/[id].tsx);
// - on each card its refund requests ("With Orbit" from 24 hours before the start), its invites not yet accepted and,
//   3 days after it ends, its payout with Request.
// The host switcher and New event head it; the host's own colour glows from the top, as on its page in the Orbit app.
// From GET /hosts/:id/events (plan F31, L4): its drafts, and its upcoming and past events, sorted here by check-in.
// ponytail: New event, Scan, Find someone, Continue and the rows open nothing yet; each is a later take. Refund
// requests, payouts and event roles wait for their APIs. Admins'
// view only. Past lists every past event; add See all when it's long.
import type { EventRow, HostEvents } from '@orbit/contract';
import { useLoad } from '@orbit/mobile/load';
import { useTabBarScroll } from '@orbit/mobile/tabBar';
import { router } from 'expo-router';
import { color, font, space } from '@orbit/mobile/theme';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { split, startsToday } from '../../launch/day';
import { useHost } from '../../launch/host';
import { timeLabel } from '../../launch/inbox';
import { dayLabel, istDate } from '../../launch/money';
import { EventCard, Glow, HostHead, Note, Pill, Row, Section } from '../../launch/ui';
import { api, refreshMe } from '../../session';

type Stage = 'open' | 'next' | 'past';
// A row with its counts, once the API sends them (PR A); absent, nothing shows for them.
type Listed = EventRow & { startsAt: string };
const endsAt = (e: Listed) => e.endsAt ?? e.startsAt;
const date = (at: string) => dayLabel(istDate(Date.parse(at))); // "Fri 20 Nov"
const when = (at: string) => `${date(at)} · ${timeLabel(at)}`; // "Fri 20 Nov · 8:00 PM"

export default function Events() {
  const insets = useSafeAreaInsets();
  const onScroll = useTabBarScroll();
  const host = useHost();
  const load = useLoad<HostEvents>(host && `events|${host.id}`, () => api.authed<HostEvents>('GET', `/hosts/${host!.id}/events`));
  if (!host) return null;
  const now = Date.now();
  const drafts = load.data?.drafts ?? [];
  const dated = [...(load.data?.upcoming ?? []), ...(load.data?.past ?? [])].filter((e): e is Listed => !!e.startsAt);
  const { groups, next, past } = split(dated, endsAt, now);

  return (
    <View style={styles.page}>
      <Glow tint={host.bg} />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + space.big }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={load.loading && !!load.data} onRefresh={() => {
              load.reload();
              void refreshMe();
            }} tintColor={color.secondary} />}
      >
        <HostHead host={host} right={<Pill label="New event" dark />} />
        {load.error && <Note>{load.error.message}</Note>}
        {groups.map((g) => (
          <Cards key={g.word} title={g.word}>
            {g.events.map((e) => (
              <Card key={e.id} event={e} stage="open" now={now} />
            ))}
          </Cards>
        ))}
        {next.length > 0 && (
          <Cards title={next.length === 1 ? 'Next' : 'Upcoming'}>
            {next.map((e) => (
              <Card key={e.id} event={e} stage="next" now={now} />
            ))}
          </Cards>
        )}
        {drafts.length > 0 && (
          <Cards title="Drafts">
            {drafts.map((d) => (
              <EventCard key={d.id} title={d.title} right={<Pill label="Continue" />} />
            ))}
          </Cards>
        )}
        {past.length > 0 && (
          <Cards title="Past">
            {past.map((e) => (
              <Card key={e.id} event={e} stage="past" now={now} />
            ))}
          </Cards>
        )}
        {load.data && dated.length === 0 && drafts.length === 0 && <Text style={styles.empty}>No events yet.</Text>}
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
function Card({ event: e, stage, now }: { event: Listed; stage: Stage; now: number }) {
  // ponytail: `checkedIn` stays hidden while it's always 0 (nothing records check-in yet). Once the door does, past
  // cards read "35 of 38 came" and the open card's row "In 3 of 31", as take 1 draws them.
  const sold = `${e.sold} sold`;
  return (
    <EventCard
      title={e.title}
      when={stage === 'open' && startsToday(e.startsAt, now) ? timeLabel(e.startsAt) : stage === 'past' ? date(e.startsAt) : when(e.startsAt)}
      tag={e.status === 'cancelled' ? 'Cancelled' : undefined}
      sold={sold}
    >
      {stage === 'open' && e.status !== 'cancelled' && (
        <Row
          label="Check-in open"
          right={
            <>
              <Pill label="Scan" />
              <Pill label="Find someone" />
            </>
          }
        />
      )}
      {stage !== 'past' && e.status === 'published' && (
        <Row label="Messages" onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id, title: e.title } })} />
      )}
    </EventCard>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.ground },
  cards: { gap: space.big },
  empty: { marginTop: space.big, marginHorizontal: 20, fontFamily: font.text, fontSize: 15, color: color.secondary },
});
