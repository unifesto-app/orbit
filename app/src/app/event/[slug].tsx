// The event page (Discover flow doc, Event page; defaults accepted 15 Nov 2026), from any event row or card and the
// Home carousel. One column: the poster; the host, title and status; when and where; Orbit asking if you're going;
// About; what it's like; its kind's own sections; the people, a group per role; FAQ and terms; and last the host with
// Follow. Tickets are a pill floating at the bottom. No icons in its cards.
// Redrawn 19 Nov 2026 to match Home and Search's "Both" (owner approved Take 1 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): the floating controls and the ticket pill on the tab bar's dark
// glass with nothing behind the back bar, a left-aligned head like Home's rows, Orbit's bubbles for Thinking of going?
// and Thanks for coming, every text card outlined, Hosted by as a host row, sections 40 apart.
// The poster runs full width like Home's carousel (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster full", "same like home
// page carousel"), from the very top of the screen ("remove the poster top blur, instead start poster from top"): the
// 4:3 poster when the event has one, else the 3:4.
import { categories, formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { past as history } from '../../account/data';
import { API_URL } from '../../api';
import { BookBar } from '../../bookBar';
import { barPrice, cast, followersLine, liveCast } from '../../detail';
import { Fact, FactCard } from '../../fact';
import { DARK_TINT } from '../../glass';
import { Carousel } from '../../home/Carousel';
import { KindSections, WithActs } from '../../kindSections';
import { meetups } from '../../kinds';
import type { Event, Host, Person } from '../../events';
import { markOf } from '../../hosts';
import { interestedBase, people, vibes } from '../../mock';
import { OrbitSays } from '../../orbitSays';
import {
  BackBar,
  copyLink,
  FaceWash,
  FollowRow,
  LoveButton,
  loveIt,
  MenuButton,
  Monogram,
  reportIt,
  SaveButton,
  SECTION,
  Section,
  shareLink,
  StatusDot,
  Tag,
  Verified,
} from '../../rows';
import { addToList, needsAccount, setInterested, useInterested, useLetIn, useLoved, useSaved, useInterestsStatus, useTicketsOnFocus, useViewer } from '../../session';
import { bookAction, eventStatus, seatsLine } from '../../status';
import { useEvent } from '../../useEvent';
import { around, color, font, radius, space } from '../../theme';

// When and where glows very faintly from the bottom centre in the poster's own colour (owner, 15 Nov 2026: "add very
// less tint too", then "radial gradiant tint, should be based on event banner"), inside the outline every text card
// has (16 inside, corner 6 + 16 = 22; the glow's corner sits inside its 1pt line).
const GLOW = 0.2; // the glow's strength at its centre; Explore's is 0.75
const WASH = around(radius.sm, 16) - 1;
const LOGO = 24; // the host's logo in the head, as Home's feed rows seat it on a poster
const PHOTO = 44; // a person's photo and the host's logo in their rows, as Home's host rows
// Thanks for coming shows for a week after, as on Home; a meetup's room is open as long (inRoom 7).
const WEEK = 3 * 3_600_000 + 7 * 86_400_000;

export default function EventPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const found = useEvent(slug);
  // An old link: the answer carries the event's current slug, so the page moves there.
  useEffect(() => {
    if (found.live && found.slug !== slug) router.replace(`/event/${found.slug}`);
  }, [found.live, found.slug, slug]);
  return found.e ? <EventView e={found.e} host={found.host} now={found.now} live={found.live} /> : found.screen;
}

// `live`: an event from the API. Its page has no fake counts or mock-only sections. A free one registers (P10.1), a
// paid one books through checkout (X3). Interested is the API's (orbit-pm X13); Loved keeps today's on-phone behaviour.
function EventView({ e, host, now, live }: { e: Event; host: Host; now: number; live: boolean }) {
  const insets = useSafeAreaInsets();
  const [bar, setBar] = useState(insets.bottom + 108); // room under the page for the ticket bar, a guess until measured
  const viewer = useViewer(); // signed out, no tickets and no follows (src/session.ts)
  useTicketsOnFocus(); // back from booking, the bar says View ticket
  const saved = useSaved(e.id);

  // Over once it ends (the API's end time); a mock event, with none, once it starts.
  const past = e.endsAt ? now >= Date.parse(e.endsAt) : Date.parse(e.startsAt) < now;
  const status = eventStatus(e, now); // the line under the title (src/status.ts)
  const seats = seatsLine(e, status);
  const mine = viewer.signedIn ? (viewer.tickets ?? []).filter((t) => t.eventId === e.id) : [];
  const booked = mine.length > 0;
  const atDoor = useLetIn(e.id);
  const kind = categories.find((c) => c.slug === e.category)?.label ?? e.category; // a vibe that repeats it isn't drawn
  const went = viewer.signedIn && (live ? atDoor : history.some((h) => h.eventId === e.id && h.status === 'Went'));
  const thanks = past && went && now < (e.endsAt ? Date.parse(e.endsAt) + 7 * 86_400_000 : Date.parse(e.startsAt) + WEEK); // a week after its end
  const book = bookAction(status, !e.pricePaise);
  // The ticket bar: a ticket holder keeps View ticket until the event has ended, while it's on and if it's cancelled;
  // anyone else sees it until the start, never on a cancelled event.
  const showBar = booked ? status.kind !== 'ended' : !past && status.kind !== 'cancelled';
  const openHost = () => router.push(`/host/${host.slug}`);
  const price = barPrice(e);

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: showBar ? bar : insets.bottom + space.big }}>
        {/* From the top of the screen, under the status bar and the back button. */}
        <Carousel
          top={0}
          extend={false}
          ratio={e.wide ? '4:3' : '3:4'}
          slides={[{ key: e.id, image: (e.wide ?? e.poster).source, edge: e.wide?.edge ?? host.bg, label: `Poster for ${e.title}` }]}
        />
        {/* Left, like Home's rows: who's hosting (the tick beside the name), the title, the acts, then the status as a
            dot and words with the seats left (no grey tags; labels like Promoted stay on Home and Search). */}
        <View style={styles.head}>
          <Pressable
            onPress={openHost}
            accessibilityRole="button"
            accessibilityLabel={`by ${host.name}${host.verified ? ', verified' : ''}`}
            hitSlop={8}
            style={({ pressed }) => [styles.hostLine, pressed && styles.pressed]}>
            <Monogram mark={host} size={LOGO} />
            <Text style={styles.hostName} numberOfLines={1}>
              {host.name}
            </Text>
            {host.verified && <Verified size={14} />}
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {e.title}
          </Text>
          <WithActs eventId={e.id} />
          <View style={styles.status}>
            <StatusDot tone={status.tone} />
            <Text style={styles.statusText}>{[status.label, seats].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>

        {/* When and where: a card, so text only. Times are India time (the event's own zone). When opens its agenda, if
            it has one; Where the venue sheet with Copy, Share and Get directions (owner, 15 Nov 2026). */}
        <View style={styles.first}>
          <FactCard>
            <FaceWash tint={e.tone} opacity={GLOW} corner={WASH} />
            <Fact
              label="When"
              value={`${e.when} IST`}
              note={e.repeats && `${e.repeats} · ${host.name} runs this again and again`}
              onPress={e.agenda ? () => router.push(`/agenda/${e.slug}`) : undefined}
            />
            <Fact label="Where" value={e.venue.name} note={e.venue.address} onPress={e.venue.address ? () => router.push(`/venue/${e.slug}`) : undefined} />
          </FactCard>
        </View>

        {thanks && <Thanks event={e} host={host} />}
        {!past && status.kind !== 'cancelled' && <Interested key={e.interested} event={e} live={live} />}

        <Section top={SECTION} title="About" />
        <Text style={styles.prose}>{e.about}</Text>

        {/* What it's like, as small cards: its kind, then the vibe (owner, 19 Nov 2026: interest cards, all four). */}
        <Section top={SECTION} title="What it’s like" />
        <View style={styles.tags}>
          {[kind, ...(live ? (e.vibes ?? []) : (vibes[e.id] ?? [])).filter((t) => t.toLowerCase() !== kind.toLowerCase())].map((t) => (
            <Tag key={t} text={t} />
          ))}
        </View>

        {/* Its kind's own sections: the show, the jam, how a hackathon works, the room, the fest (src/kindSections.tsx). */}
        {!live && <KindSections event={e} past={past} />}

        {/* A real fest's insides (X14), as a mock fest's in KindSections, each opening its sheet by the event's slug. */}
        {live && e.festItems && (
          <>
            <Section top={SECTION} title="Inside the fest" />
            <FactCard>
              {e.festItems.map((it) => (
                <Fact
                  key={it.id}
                  label={`${it.when} · ${it.kind}`}
                  value={it.title}
                  note={it.where}
                  onPress={() => router.push(`/fest/${e.slug}/${it.id}`)}
                />
              ))}
            </FactCard>
          </>
        )}

        {live
          ? liveCast(e.lineup).map((g) => (
              <View key={g.key}>
                <Section top={SECTION} title={g.title} />
                <View style={styles.people}>
                  {g.people.map((p) => (
                    <PersonRow key={p.id} person={{ ...p, ...markOf(p) }} />
                  ))}
                </View>
              </View>
            ))
          : cast(e.people).map((g) => (
              <View key={g.title}>
                <Section top={SECTION} title={g.title} />
                <View style={styles.people}>
                  {g.ids.map((id) => {
                    const p = people.find((x) => x.id === id);
                    return p && <PersonRow key={id} person={p} />;
                  })}
                </View>
              </View>
            ))}

        {/* The event's FAQ, if it has one, and its terms, each in a full modal (owner, 15 Nov 2026: "add Event FAQ &
            Terms & Conditions Modals"). */}
        <View style={styles.section}>
          <FactCard>
            {e.faq && (
              <Fact
                label="FAQ"
                value={`${e.faq.length} ${e.faq.length === 1 ? 'question' : 'questions'}`}
                onPress={() => router.push(`/faq/${e.slug}`)}
              />
            )}
            <Fact label="Terms & Conditions" value="Tickets, refunds and entry" onPress={() => router.push(`/terms/${e.slug}`)} />
          </FactCard>
        </View>

        {/* Last, the host to come back to (Discover doc: "every event page ends on the host and Follow"), a host row with
            its button as on Home and Search. */}
        <Section top={SECTION} title="Hosted by" />
        <View style={styles.hostedBy}>
          <FollowRow host={host} line={[host.kind, followersLine(host.followers)].filter(Boolean).join(' · ')} onPress={openHost} />
        </View>
      </ScrollView>

      {showBar && (
        <BookBar
          dark
          price={formatPrice(price.paise)}
          from={price.from}
          note={booked ? undefined : seats}
          action={booked ? 'View ticket' : book.label}
          // A booking opens its ticket (src/app/ticket/[id].tsx, keyed by booking id). Signed out, Book and Register open
          // the sign-in sheet over this page and come back to it (Booking doc, step 2).
          onAction={
            booked
              ? // Two ticket types booked on one event: both are in Account › Tickets.
                () => (mine.length > 1 ? router.push('/account/tickets') : mine[0]?.id && router.push(`/ticket/${mine[0].id}`))
              : !book.can
                ? undefined
                : () => needsAccount(() => router.push(`/book/${e.slug}`)) // signed out, sign in first, then on to it
          }
          onHeight={setBar}
        />
      )}
      {/* Save and the menu (owner, 15 Nov 2026: "add top right, love and menu"), on the dark glass with nothing behind
          them. Once it's over, Save goes (only a saved one keeps its filled star, to manage or remove it); an event you
          went to has Loved it's heart there instead (owner, 19 Nov 2026). Signed out, Save asks to sign in first, then
          saves; so does Add to a list, which saves first if it isn't (Saved events and lists doc). Copy link copies the
          page's link; Add to calendar opens the API's .ics for the phone's calendar, and Report opens its sheet (X15),
          both for a real event only (a mock one has no id the API knows). */}
      <BackBar dark>
        {past && went && <LoveButton event={e} bar dark />}
        {(!past || saved) && <SaveButton event={e} bar dark />}
        <MenuButton
          tint={DARK_TINT}
          actions={[
            ...(past ? [] : [{ label: 'Add to a list', icon: 'listPlus' as const, onPress: () => addToList(e.id) }]),
            {
              label: 'Share',
              icon: 'share',
              onPress: () => shareLink(`${e.title} · ${e.when} · ${e.area} · ${formatPrice(e.pricePaise)}`, `/event/${e.slug}`),
            },
            { label: 'Copy link', icon: 'link', onPress: () => void copyLink(`/event/${e.slug}`) },
            // The API has no calendar file for a cancelled event; a phone that can't open one says so.
            ...(live && status.kind !== 'cancelled'
              ? [
                  {
                    label: 'Add to calendar',
                    icon: 'calendar' as const,
                    onPress: () =>
                      void Linking.openURL(`${API_URL}/public/events/${e.slug}/calendar.ics`).catch(() =>
                        Alert.alert('Couldn’t open your calendar', 'Try again, or add it from the event’s link.'),
                      ),
                  },
                ]
              : []),
            ...(live ? [{ label: 'Report', icon: 'report' as const, onPress: () => reportIt('event', e.id, e.title) }] : []),
          ]}
        />
      </BackBar>
    </View>
  );
}

// Interested (owner, 19 Nov 2026: "add interest cards for events"), apart from Save: it says you're thinking of going.
// Orbit asks, in its bubble, with the answer on your side (Home's Orbit speaks), and says how many are, yours included
// ("in interested add count too"). Signed out, it asks to sign in first. A real event's count is the API's as the page
// was read, which held your own tap if you'd made it then; a tap since moves it by one at once.
// Whether the read held yours is taken once your Interested list has been read (it may land after the page), or as
// not if you tap first (signing in from here).
// ponytail: a tap still on its way when the page was read can be off by one until it reads again.
function Interested({ event: e, live }: { event: Event; live: boolean }) {
  const mine = useInterested(e.id);
  const ready = useInterestsStatus() === 'ready';
  const [atRead, setAtRead] = useState<boolean | null>(ready ? mine : null);
  if (atRead === null && ready) setAtRead(mine);
  const n = live ? (e.interested ?? 0) - (atRead ? 1 : 0) + (mine ? 1 : 0) : interestedBase(e.id) + (mine ? 1 : 0);
  return (
    <OrbitSays
      top={SECTION}
      title={mine ? 'You’re interested' : 'Thinking of going?'}
      text={n > 0 ? `${n} ${n === 1 ? 'person is' : 'people are'} interested.` : 'Tell Orbit you might come.'}
      answers={[
        {
          label: mine ? 'Interested' : 'I’m interested',
          picked: mine,
          onPress: () =>
            needsAccount(() => {
              if (atRead === null) setAtRead(false);
              setInterested(e.id, !mine);
            }),
        },
      ]}
    />
  );
}

// Thanks for coming, on an event you went to for a week after, in Home's words (Home's Thanks): Loved it, or for a
// meetup with a room, See who was there (inRoom 3), which replaced the Open the room pill in its Meet people here card.
function Thanks({ event: e, host }: { event: Event; host: Host }) {
  const loved = useLoved(e.id);
  const title = `Thanks for coming to ${e.title}`;
  if (meetups[e.id]?.inRoom) {
    return (
      <OrbitSays
        top={SECTION}
        title={title}
        text="See who was there, and connect. The room’s open for a week after."
        answers={[{ label: 'See who was there', onPress: () => router.push(`/room/${e.id}`) }]}
      />
    );
  }
  return (
    <OrbitSays
      top={SECTION}
      title={title}
      text={`Loved it? Let ${host.name} know.`}
      then={loved ? { mine: 'Loved it', reply: `${host.name} will hear.` } : undefined}
      answers={[loved ? { label: 'Take it back', onPress: () => loveIt(e.id, false) } : { label: 'Loved it', onPress: () => loveIt(e.id, true) }]}
    />
  );
}

// One person on the event, a plain row like the host rows: their 1:1 photo (a circle, as your own; the monogram until
// photos exist), name and one line. Tapping opens the person sheet.
function PersonRow({ person: p }: { person: Pick<Person, 'id' | 'name' | 'headline' | 'initials' | 'bg' | 'fg'> }) {
  return (
    <Pressable
      onPress={() => router.push(`/person/${p.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rowLink, pressed && styles.pressed]}>
      <Monogram mark={p} size={PHOTO} round />
      <View style={styles.grow}>
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {p.headline}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },

  head: { marginTop: space.big, marginHorizontal: 20, alignItems: 'flex-start' },
  hostLine: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: space.small },
  hostName: { flexShrink: 1, fontFamily: font.medium, fontSize: 14, color: color.text },
  title: { marginTop: 10, fontFamily: font.headline, fontSize: 26, lineHeight: 32, color: color.text },
  status: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The accent on the dot, never on text.
  statusText: { flexShrink: 1, fontFamily: font.text, fontSize: 13, color: color.secondary },

  first: { marginTop: space.big },
  section: { marginTop: SECTION },
  prose: { marginHorizontal: 20, fontFamily: font.text, fontSize: 15, lineHeight: 22, color: color.secondary },
  tags: { marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  people: { marginHorizontal: 20, gap: 16 },
  rowLink: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },

  hostedBy: { marginHorizontal: 20 },
});
