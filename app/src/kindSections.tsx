// The event page's own sections for each kind of event (owner, 19 Nov 2026: detail screens for Standup Comedy, Musical
// Jams, Hackathons, Meetups and Fests; the data and the flow-doc decisions behind it are in src/kinds.ts). Each is a
// heading and an outlined text card of facts: text only, no icons in cards. Loved it, after the show, is for every kind
// (owner, same day: "Loved it for all"), so nothing here gates it.
import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Fact, FactCard } from './fact';
import { acts, festItems, fests, hackathons, jams, meetups, shows, withActs } from './kinds';
import type { Event } from './mock';
import { hosts, now } from './mock';
import { Pill } from './account/kit';
import { Section } from './rows';
import { color, font } from './theme';

// "with [act]" under "by [host]" (Discover 23): up to three names, each opening the act's page, then "+N".
export function WithActs({ eventId }: { eventId: string }) {
  const list = (acts[eventId] ?? []).map((id) => hosts.find((h) => h.id === id)).filter((h) => !!h);
  if (list.length === 0) return null;
  const { names, more } = withActs(list);
  return (
    <Text style={styles.with}>
      with{' '}
      {names.map((h, i) => (
        <Fragment key={h.id}>
          {i > 0 && ', '}
          <Text style={styles.act} onPress={() => router.push(`/host/${h.id}`)} accessibilityRole="link">
            {h.name}
          </Text>
        </Fragment>
      ))}
      {more > 0 && ` +${more}`}
    </Text>
  );
}

// `went`: you were let in, which opens a meetup's room to you.
export function KindSections({ event: e, past, went = false }: { event: Event; past: boolean; went?: boolean }) {
  switch (e.category) {
    case 'comedy':
      return <ShowFacts eventId={e.id} />;
    case 'music':
      return <JamFacts eventId={e.id} />;
    case 'hackathons':
      return <HackathonFacts eventId={e.id} past={past} />;
    case 'meetups':
      return <MeetupFacts eventId={e.id} canJoin={past && went && isRoomOpen(e.startsAt)} />;
    case 'fests':
      return <FestFacts eventId={e.id} />;
    default:
      return null;
  }
}

function ShowFacts({ eventId }: { eventId: string }) {
  const s = shows[eventId];
  if (!s) return null;
  return (
    <>
      <Section title="The show" />
      <FactCard>
        <Fact label="Runs" value={s.runtime} />
        <Fact label="In" value={s.language} />
        {s.age && <Fact label="Age" value={`${s.age} only`} note="Bring a photo ID" />}
        {s.seating && <Fact label="Seats" value={s.seating} />}
      </FactCard>
    </>
  );
}

function JamFacts({ eventId }: { eventId: string }) {
  const j = jams[eventId];
  if (!j) return null;
  return (
    <>
      <Section title="The jam" />
      <FactCard>
        <Fact label="Playing" value={j.style} />
        <Fact label="Bring" value={j.bring} />
        {j.onSite && <Fact label="There already" value={j.onSite} />}
        <Fact label="Runs" value={j.runtime} />
      </FactCard>
    </>
  );
}

// Before it: how teams and rounds work, the tracks, the prizes and how it's judged, with how many teams are in but never
// who. Once results are out, the winners lead (Running hackathons 4, 5, 13). The event's judges and mentors show in its
// people list (owner, 19 Nov 2026: "Keep them shown", over Running hackathons 11, which named judges to the host only).
function HackathonFacts({ eventId, past }: { eventId: string; past: boolean }) {
  const h = hackathons[eventId];
  if (!h) return null;
  const [min, max] = h.team;
  return (
    <>
      {past && h.winners && (
        <>
          <Section title="Winners" />
          <FactCard>
            {h.winners.map((w) => (
              <Fact key={w.place} label={w.place} value={`${w.project} by ${w.team}`} note={`${w.line} · ${w.members}`} />
            ))}
          </FactCard>
        </>
      )}
      <Section title="How it works" />
      <FactCard>
        <Fact label="Teams" value={`${min} to ${max} people`} note={past ? `${h.teams} teams took part` : `${h.teams} teams in so far`} />
        {h.rounds.map((r, i) => (
          <Fact key={r.name} label={`Round ${i + 1}`} value={r.name} note={r.when} />
        ))}
      </FactCard>
      <Section title="Tracks" />
      <FactCard>
        {h.tracks.map((t) => (
          <Fact key={t.name} value={t.name} note={t.brief} />
        ))}
      </FactCard>
      <Section title="Prizes" />
      <FactCard>
        {h.prizes.map((p) => (
          <Fact key={p.place} label={p.place} value={p.prize} />
        ))}
      </FactCard>
      <Section title="Judged on" />
      <FactCard>
        {h.criteria.map((c) => (
          <Fact key={c.name} label={`${c.weight}%`} value={c.name} />
        ))}
      </FactCard>
    </>
  );
}

// The room's open from the start until a week after (about three hours for the meetup, then 7 days; inRoom 7).
const isRoomOpen = (startsAt: string) => now < Date.parse(startsAt) + 3 * 3_600_000 + 7 * 86_400_000;

// One line about the room (inRoom 15): no names or counts here. Once you were let in, the room opens from here and from
// Home's Thanks for coming (inRoom 3: you tap to join; nobody's in it till they do).
function MeetupFacts({ eventId, canJoin }: { eventId: string; canJoin: boolean }) {
  if (!meetups[eventId]?.inRoom) return null;
  return (
    <>
      <Section title="Meet people here" />
      <FactCard>
        <Fact
          label="inRoom"
          value="See who’s here once you’re checked in"
          note="Join the room once you’re in and swap ways to reach each other. It stays open for a week after."
        />
        {canJoin && (
          <View style={styles.join}>
            <Pill label="Open the room" size="small" onPress={() => router.push(`/room/${eventId}`)} />
          </View>
        )}
      </FactCard>
    </>
  );
}

// A fest is one event on Home and Search: its kind, its days, what's on, one tap to book for the whole group (Booking
// 13), then everything inside it by time, each opening its own sheet (src/app/fest/[fest]/[item].tsx).
function FestFacts({ eventId }: { eventId: string }) {
  const f = fests[eventId];
  if (!f) return null;
  const items = festItems[eventId] ?? [];
  return (
    <>
      <Section title="The fest" />
      <FactCard>
        <Fact label="Kind of fest" value={f.type} />
        <Fact label="When" value={f.days} />
        <Fact label="What’s on" value={f.highlights.join('\n')} />
        {f.oneClick && <Fact label="Booking" value="One tap books it" note="Add up to 10 friends by name. One QR lets you all in." />}
      </FactCard>
      {items.length > 0 && (
        <>
          <Section title="Inside the fest" />
          <FactCard>
            {items.map((it) => (
              <Fact
                key={it.id}
                label={`${it.when} · ${it.kind}`}
                value={it.title}
                note={it.where}
                onPress={() => router.push(`/fest/${eventId}/${it.id}`)}
              />
            ))}
          </FactCard>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  with: { marginTop: 2, fontFamily: font.medium, fontSize: 15, color: color.secondary, textAlign: 'center' },
  act: { color: color.text },
  join: { alignItems: 'flex-start' },
});
