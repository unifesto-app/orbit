// The event page's own sections for each kind of event (owner, 19 Nov 2026: detail screens for Standup Comedy, Musical
// Jams, Hackathons, Meetups and Fests; the data and the flow-doc decisions behind it are in src/kinds.ts). Each is a
// heading and an outlined text card of facts: text only, no icons in cards. Loved it, after the show, is for every kind
// (owner, same day: "Loved it for all"), so nothing here gates it.
import { router } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Fact, FactCard } from './fact';
import { acts, festDays, festItems, fests, hackathonOf, hackathons, jams, meetups, runtime, shows, withActs } from './kinds';
import type { Event } from './events';
import { hosts } from './mock';
import { SECTION, Section } from './rows';
import { color, font } from './theme';

// "with [act]" under "by [host]" (Discover 23): up to three names, each opening the act's page, then "+N". A real
// event's acts come with its read; a mock event's from src/kinds.ts.
export function WithActs({ event: e }: { event: Pick<Event, 'id' | 'acts'> }) {
  const list = e.acts ?? (acts[e.id] ?? []).map((id) => hosts.find((h) => h.id === id)).filter((h) => !!h);
  if (list.length === 0) return null;
  const { names, more } = withActs(list);
  return (
    <Text style={styles.with}>
      with{' '}
      {names.map((h, i) => (
        <Fragment key={h.id}>
          {i > 0 && ', '}
          <Text style={styles.act} onPress={() => router.push(`/host/${h.slug}`)} accessibilityRole="link">
            {h.name}
          </Text>
        </Fragment>
      ))}
      {more > 0 && ` +${more}`}
    </Text>
  );
}

// Each a heading SECTION (40) below what's above, as the page's own sections. A real event's data is its `details`
// (each kind's own keys); a mock event's is in src/kinds.ts. A real event's age, outside comedy's card, gets its own.
export function KindSections({ event: e, past }: { event: Event; past: boolean }) {
  return (
    <>
      <KindFacts event={e} past={past} />
      {!!e.minAge && e.category !== 'comedy' && (
        <>
          <Section top={SECTION} title="Good to know" />
          <FactCard>
            <AgeFact age={`${e.minAge}+`} />
          </FactCard>
        </>
      )}
    </>
  );
}

function KindFacts({ event: e, past }: { event: Event; past: boolean }) {
  switch (e.category) {
    case 'comedy':
      return <ShowFacts event={e} />;
    case 'jams':
      return <JamFacts event={e} />;
    case 'hackathons':
      return <HackathonFacts event={e} past={past} />;
    case 'meetups':
      return <MeetupFacts event={e} />;
    case 'fests':
      return <FestFacts event={e} />;
    default:
      return null;
  }
}

const AgeFact = ({ age }: { age: string }) => <Fact label="Age" value={`${age} only`} note="Bring a photo ID" />;

function ShowFacts({ event: e }: { event: Event }) {
  const d = e.details;
  const s = d
    ? { runtime: runtime(e.startsAt, e.endsAt!), language: d.language, seating: d.seating, age: e.minAge ? `${e.minAge}+` : undefined }
    : shows[e.id];
  if (!s) return null;
  return (
    <>
      <Section top={SECTION} title="The show" />
      <FactCard>
        <Fact label="Runs" value={s.runtime} />
        {s.language && <Fact label="In" value={s.language} />}
        {s.age && <AgeFact age={s.age} />}
        {s.seating && <Fact label="Seats" value={s.seating} />}
      </FactCard>
    </>
  );
}

function JamFacts({ event: e }: { event: Event }) {
  const d = e.details;
  const j = d ? { style: d.style, bring: d.bring, onSite: d.onSite, runtime: runtime(e.startsAt, e.endsAt!) } : jams[e.id];
  if (!j) return null;
  return (
    <>
      <Section top={SECTION} title="The jam" />
      <FactCard>
        {j.style && <Fact label="Playing" value={j.style} />}
        {j.bring && <Fact label="Bring" value={j.bring} />}
        {j.onSite && <Fact label="There already" value={j.onSite} />}
        <Fact label="Runs" value={j.runtime} />
      </FactCard>
    </>
  );
}

// Before it: how teams and rounds work, the tracks, the prizes and how it's judged, with how many teams are in but never
// who. Once results are out, the winners lead (Running hackathons 4, 5, 13). The event's judges and mentors show in its
// people list (owner, 19 Nov 2026: "Keep them shown", over Running hackathons 11, which named judges to the host only).
// A real one shows only the cards it has something for, and no winners yet (not built).
function HackathonFacts({ event: e, past }: { event: Event; past: boolean }) {
  const h: ReturnType<typeof hackathonOf> | undefined = e.details ? hackathonOf(e.details, e.teams ?? null) : hackathons[e.id];
  if (!h) return null;
  const count = h.teams === null ? undefined : past ? `${h.teams} teams took part` : `${h.teams} teams in so far`;
  const size = h.team && (h.team[0] === h.team[1] ? `${h.team[0]} people` : `${h.team[0]} to ${h.team[1]} people`);
  return (
    <>
      {past && h.winners && (
        <>
          <Section top={SECTION} title="Winners" />
          <FactCard>
            {h.winners.map((w) => (
              <Fact key={w.place} label={w.place} value={`${w.project} by ${w.team}`} note={`${w.line} · ${w.members}`} />
            ))}
          </FactCard>
        </>
      )}
      {(size || count || h.rounds.length > 0) && (
        <>
          <Section top={SECTION} title="How it works" />
          <FactCard>
            {(size || count) && <Fact label="Teams" value={size ?? count!} note={size ? count : undefined} />}
            {h.rounds.map((r, i) => (
              <Fact key={`${i}-${r.name}`} label={`Round ${i + 1}`} value={r.name} note={r.when} />
            ))}
          </FactCard>
        </>
      )}
      {h.tracks.length > 0 && (
        <>
          <Section top={SECTION} title="Tracks" />
          <FactCard>
            {h.tracks.map((t, i) => (
              <Fact key={`${i}-${t.name}`} value={t.name} note={t.brief} />
            ))}
          </FactCard>
        </>
      )}
      {h.prizes.length > 0 && (
        <>
          <Section top={SECTION} title="Prizes" />
          <FactCard>
            {h.prizes.map((p, i) => (
              <Fact key={`${i}-${p.place}`} label={p.place} value={p.prize} />
            ))}
          </FactCard>
        </>
      )}
      {h.criteria.length > 0 && (
        <>
          <Section top={SECTION} title="Judged on" />
          <FactCard>
            {h.criteria.map((c, i) => (
              <Fact key={`${i}-${c.name}`} label={`${c.weight}%`} value={c.name} />
            ))}
          </FactCard>
        </>
      )}
    </>
  );
}

// One line about the room (inRoom 15): no names or counts here. Once you were let in, the room opens from Orbit's Thanks
// for coming, on Home and on the event page (inRoom 3: you tap to join; nobody's in it till they do); its Open the room
// pill here moved into that bubble with the event page's Take 1 (19 Nov 2026).
function MeetupFacts({ event: e }: { event: Event }) {
  if (!(e.inRoom ?? meetups[e.id]?.inRoom)) return null;
  return (
    <>
      <Section top={SECTION} title="Meet people here" />
      <FactCard>
        <Fact
          label="inRoom"
          value="See who’s here once you’re checked in"
          note="Join the room once you’re in and swap ways to reach each other. It stays open for a week after."
        />
      </FactCard>
    </>
  );
}

// A fest is one event on Home and Search: its kind, its days, what's on, one tap to book for the whole group (Booking
// 13), then everything inside it by time, each opening its own sheet (src/app/fest/[fest]/[item].tsx).
// A real fest's kind and highlights are its details, its days from its start and end; its insides draw on the event page
// (X14), and one-tap group booking isn't built for it yet.
function FestFacts({ event: e }: { event: Event }) {
  const d = e.details;
  const f = d ? { type: d.festType, days: festDays(e.startsAt, e.endsAt!), highlights: d.highlights ?? [], oneClick: false } : fests[e.id];
  if (!f) return null;
  const eventId = e.id;
  const items = festItems[eventId] ?? [];
  return (
    <>
      <Section top={SECTION} title="The fest" />
      <FactCard>
        {f.type && <Fact label="Kind of fest" value={f.type} />}
        <Fact label="When" value={f.days} />
        {f.highlights.length > 0 && <Fact label="What’s on" value={f.highlights.join('\n')} />}
        {f.oneClick && <Fact label="Booking" value="One tap books it" note="Bring up to 9 friends by name, 10 in all. One QR lets you all in." />}
      </FactCard>
      {items.length > 0 && (
        <>
          <Section top={SECTION} title="Inside the fest" />
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
  // Under the title, left like the page's head since its Take 1 (19 Nov 2026).
  with: { marginTop: 4, fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.secondary },
  act: { color: color.text },
});
