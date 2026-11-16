// Console's first tab: one host's events, each card holding its own work (owner, 16 Nov 2026, picked direction C,
// "events first", on the Orbit Console and Galaxy canvas). The host switcher heads it (someone can be on several hosts).
// Events whose check-in is open come first, under Tonight, Today or Tomorrow, with their door line: how many are in,
// Scan and Find someone (Event day doc: from 24 hours before the start until check-in closes). Then what's coming,
// drafts and what's past. On each card sit its refund requests, its waiting invites and, once open, its payout.
// What shows follows the viewer's role on this host (src/modes.ts): money for Admins and Curators, invites for Admins and
// the event's Curator, drafts and New event for Admins; anyone else's card is tagged with their role there. The host's
// own colour glows from the top, as on its host page.
// ponytail: Scan, Find someone, New event, Continue, Request and the rows open nothing yet; the scanner, New event, an
// event's Console page and payouts are the next slices. Past lists every past event; add See all when a host has many.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Pill, Row } from '../../../account/kit';
import { EventCard } from '../../../console/EventCard';
import { WORDS, dayWord } from '../../../console/day';
import { drafts, endsAt, salesOf, teams, useHost } from '../../../console/data';
import { available, hostDecidesRefunds, payoutOpens, rupees } from '../../../console/money';
import { Icon } from '../../../icons';
import { Empty, TabPage } from '../../../modeKit';
import { type Team, eventsOn, onEventDay, roleOn, seesEventMoney, startsEvents } from '../../../modes';
import { type Event, now } from '../../../mock';
import { Monogram, Section } from '../../../rows';
import { color, font, space } from '../../../theme';

type Stage = 'open' | 'next' | 'past';
const date = (when: string) => when.split(' · ')[0]; // "Fri 20 Nov"
const time = (when: string) => when.split(' · ')[1] ?? when; // "8:00 PM", under Tonight's heading
const opens = <Icon name="chevron" size={16} color={color.secondary} />;

export default function ConsoleHome() {
  const { team, host, events } = useHost();
  const mine = [...eventsOn(team, events)].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const open = mine.filter((e) => onEventDay(e.startsAt, endsAt(e), now));
  const next = mine.filter((e) => !open.includes(e) && Date.parse(endsAt(e)) >= now);
  const past = mine.filter((e) => !open.includes(e) && !next.includes(e)).reverse(); // newest first
  const words = WORDS.filter((w) => open.some((e) => dayWord(e.startsAt, now) === w));
  const myDrafts = team.admin ? drafts.filter((d) => d.hostId === team.hostId) : [];

  return (
    <TabPage
      tint={host.bg}
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
      {words.map((word) => (
        <Cards key={word} title={word}>
          {open
            .filter((e) => dayWord(e.startsAt, now) === word)
            .map((e) => (
              <Card key={e.id} team={team} event={e} stage="open" />
            ))}
        </Cards>
      ))}
      {next.length > 0 && (
        <Cards title={next.length === 1 ? 'Next' : 'Upcoming'}>
          {next.map((e) => (
            <Card key={e.id} team={team} event={e} stage="next" />
          ))}
        </Cards>
      )}
      {myDrafts.length > 0 && (
        <Cards title="Drafts">
          {myDrafts.map((d) => (
            <EventCard key={d.id} title={d.name} right={<Pill label="Continue" size="small" />} />
          ))}
        </Cards>
      )}
      {past.length > 0 && (
        <Cards title="Past">
          {past.map((e) => (
            <Card key={e.id} team={team} event={e} stage="past" />
          ))}
        </Cards>
      )}
      {mine.length === 0 && myDrafts.length === 0 && <Empty>No events yet.</Empty>}
    </TabPage>
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

// One event and what's waiting on it, as far as the viewer's role reaches.
function Card({ team, event: e, stage }: { team: Team; event: Event; stage: Stage }) {
  const s = salesOf(e.id);
  const role = roleOn(team, e.id);
  const money = seesEventMoney(team, e.id);
  const priced = (line: string, paise: number) => (money ? `${line} · ${rupees(paise)}` : line);
  const sold = s && (stage === 'past' ? `${s.checkedIn} of ${s.booked} came` : s.seats ? `${s.booked} of ${s.seats} sold` : `${s.booked} sold`);
  const refunds = money ? (s?.refundsWaiting ?? 0) : 0;
  const decides = hostDecidesRefunds(e.startsAt, now); // else the requests are Orbit's to decide
  const invites = team.admin || role === 'Curator' ? (teams[team.hostId] ?? []).filter((m) => m.waiting && m.eventId === e.id) : [];
  const payout = stage === 'past' && money && s && payoutOpens(s) <= now ? available(s) : 0;
  return (
    <EventCard
      title={e.title}
      poster={e.poster}
      when={stage === 'open' ? time(e.when) : stage === 'next' ? e.when : date(e.when)}
      tag={team.admin ? e.repeats : (role ?? undefined)}
      sold={s && sold ? priced(sold, s.salesPaise) : undefined}
      share={s?.seats && stage !== 'past' ? s.booked / s.seats : undefined}>
      {stage === 'open' && (
        <Row
          label={`In ${s?.checkedIn ?? 0} of ${s?.booked ?? 0}`}
          right={
            <>
              <Pill label="Scan" size="small" />
              <Pill label="Find someone" size="small" />
            </>
          }
        />
      )}
      {s && refunds > 0 && (
        <Row
          label={refunds === 1 ? 'Refund request' : `${refunds} refund requests`}
          value={decides ? rupees(s.openRefundsPaise) : 'With Orbit'}
          right={decides ? opens : undefined}
        />
      )}
      {invites.length > 0 && (
        <Row
          label={invites.length === 1 ? 'Invite not accepted' : `${invites.length} invites not accepted`}
          value={invites.length === 1 ? invites[0].role.split(' · ')[0] : undefined}
          right={opens}
        />
      )}
      {payout > 0 && <Row label="Payout ready" value={rupees(payout)} right={<Pill label="Request" size="small" />} />}
    </EventCard>
  );
}

const styles = StyleSheet.create({
  switcher: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.small },
  hostName: { flexShrink: 1, fontFamily: font.title, fontSize: 17, color: color.text },
  cards: { gap: space.big },
});
