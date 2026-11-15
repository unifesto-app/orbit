// Console's first tab: one host's day. The host switcher heads it (someone can be on several hosts). Then, on an event's
// day, its door card: how many are in, with Scan and Find someone (Event day doc: one tap to the scanner, from 24 hours
// before until check-in closes). Then what's waiting on the viewer, and the events they work on: upcoming, drafts, past.
// What shows follows the viewer's role on this host (src/modes.ts): money only for Admins and Curators, drafts and
// New event for Admins.
// ponytail: Scan, Find someone, New event and the event rows do nothing yet; the scanner, New event and an event's
// manage page are the next slices.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Group, Pill, Row } from '../../../account/kit';
import { day } from '../../../account/rules';
import { DoorCard } from '../../../console/DoorCard';
import { drafts, salesOf, teams, useHost } from '../../../console/data';
import { available, payoutOpens, rupees } from '../../../console/money';
import { Icon } from '../../../icons';
import { Empty, TabPage } from '../../../modeKit';
import { eventsOn, onEventDay, seesEventMoney, startsEvents } from '../../../modes';
import { now } from '../../../mock';
import { Monogram } from '../../../rows';
import { color, font, space } from '../../../theme';

const date = (when: string) => when.split(' · ')[0]; // "Fri 20 Nov"

export default function ConsoleHome() {
  const { team, host, events } = useHost();
  const mine = eventsOn(team, events);
  const endOf = (id: string, startsAt: string) => Date.parse(salesOf(id)?.endsAt ?? startsAt);
  const today = mine.filter((e) => {
    const s = salesOf(e.id);
    return s && onEventDay(e.startsAt, s.endsAt, now);
  });
  const upcoming = mine.filter((e) => !today.includes(e) && endOf(e.id, e.startsAt) >= now);
  const past = mine.filter((e) => !today.includes(e) && endOf(e.id, e.startsAt) < now);
  const myDrafts = team.admin ? drafts.filter((d) => d.hostId === team.hostId) : [];

  // Waiting on the viewer: refund requests and payouts on events whose money they see, invites for Admins.
  const money = mine.filter((e) => seesEventMoney(team, e.id)).flatMap((e) => salesOf(e.id) ?? []);
  const refunds = money.reduce((n, s) => n + s.refundsWaiting, 0);
  const payout = money.filter((s) => payoutOpens(s) <= now).reduce((p, s) => p + Math.max(0, available(s)), 0);
  const invites = team.admin ? (teams[team.hostId] ?? []).filter((m) => m.waiting).length : 0;

  return (
    <TabPage
      head={
        <Pressable
          onPress={() => router.push('/console/hosts')}
          style={styles.switcher}
          accessibilityRole="button"
          accessibilityLabel={`${host.name}. Switch host`}>
          <Monogram mark={host} size={32} />
          <Text style={styles.hostName} numberOfLines={1}>
            {host.name}
          </Text>
          <Icon name="caretDown" size={14} color={color.secondary} />
        </Pressable>
      }
      right={startsEvents(team) ? <Pill label="New event" size="small" /> : undefined}>
      {today.map((e) => {
        const s = salesOf(e.id)!;
        return <DoorCard key={e.id} heading="Event day" title={e.title} when={e.when} checkedIn={s.checkedIn} booked={s.booked} />;
      })}

      {(refunds > 0 || payout > 0 || invites > 0) && (
        <Group title="Waiting">
          {refunds > 0 && <Row label="Refund requests" value={String(refunds)} />}
          {payout > 0 && <Row label="Payout ready" value={rupees(payout)} />}
          {invites > 0 && <Row label="Invites not accepted" value={String(invites)} />}
        </Group>
      )}

      {upcoming.length > 0 && (
        <Group title="Upcoming">
          {upcoming.map((e) => (
            <Row key={e.id} label={e.title} value={date(e.when)} />
          ))}
        </Group>
      )}
      {myDrafts.length > 0 && (
        <Group title="Drafts">
          {myDrafts.map((d) => (
            <Row key={d.id} label={d.name} />
          ))}
        </Group>
      )}
      {past.length > 0 && (
        <Group title="Past">
          {past.map((e) => (
            <Row key={e.id} label={e.title} value={day(e.startsAt)} />
          ))}
        </Group>
      )}
      {mine.length === 0 && myDrafts.length === 0 && <Empty>No events yet.</Empty>}
    </TabPage>
  );
}

const styles = StyleSheet.create({
  switcher: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.small },
  hostName: { flexShrink: 1, fontFamily: font.title, fontSize: 17, color: color.text },
});
