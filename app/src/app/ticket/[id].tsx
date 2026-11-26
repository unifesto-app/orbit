// A ticket (Booking doc, The ticket; Event day doc), opened from Account › Tickets, Home's ticket stack and the event
// page. The event first, as a row that opens its page; then the QR the crew scans at the gate, big on a bright plate,
// with how many it admits and the 8-character code they type when a QR won't scan; then what the booking is, and what
// can be done with it. One QR per booking, admitting everyone on it. The QR is drawn on the phone (src/qr.ts), so it
// shows with no signal.
// Not here yet: Pass on, for free single tickets (it needs its own form), and a brighter screen at the gate
// (expo-brightness, a native rebuild). No wallet pass in v1 (Booking decision 8).
// Signed out (a link or a push opened it), a line and Sign in, and the ticket once signed in. The host's newest
// announcement for the event is on top (src/inboxStore.ts).
// Since 19 Nov 2026 in the event page's language (owner approved Take 7 of the detail pages mockup): the back circle on
// the dark glass with nothing behind it, the announcement as the host talking in its bubble, the event as a Clean row
// and the booking's details in an outlined card.
// A real ticket (a uuid id, P12.1) is the API's (GET /me/tickets/:id): its QR and code, how many it admits, the event,
// and the event's online link while it's live. The last answer is kept on the phone (src/session.ts keepTicket), drawn
// while it loads or with no signal. A cancelled one says so in plain words where the QR was. A free one can be
// cancelled before the start. Mock ids keep the mock ticket.
import { formatPrice, type Ticket as LiveTicket } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { bookings, type Payment, payments, type Refund, refunds } from '../../account/data';
import { EDGE, PAD, Page, Pill, RIM, SignInNote } from '../../account/kit';
import { calendarLink, isOpen, spacedCode, ticketActions } from '../../account/rules';
import { Fact, FactCard } from '../../fact';
import { Glass } from '../../glass';
import { dayLabel, timeLabel } from '../../inbox';
import { useAnnouncement } from '../../inboxStore';
import { type Event, type Host, toEvent, toHost } from '../../events';
import { useLoad } from '../../load';
import { events, hosts, now as mockNow } from '../../mock';
import { qr } from '../../qr';
import { BackBar, EventRow, Failed, HostSays, NotFound, TOP, Waiting } from '../../rows';
import { api, keepTicket, keptTicket, real, ticketsChanged, useSession, useSignedIn } from '../../session';
import { checkInLine, statusText, ticketsApi } from '../../tickets';
import { around, color, font, radius, space } from '../../theme';

const WEB = 'https://heyorbit.in'; // the event's page on the web, for sharing
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useSignedIn();
  if (!signedIn)
    return (
      <Page title="Ticket">
        <SignInNote>Sign in to see this ticket.</SignInNote>
      </Page>
    );
  return real(id) ? <Live id={id} /> : <Mock id={id} />;
}

// What the ticket draws, from the mock's booking or the API's.
type Shown = {
  e: Event;
  host: Host;
  now: number;
  qr: string | null; // null once cancelled
  code: string | null;
  count: number;
  tier: string;
  booking?: string; // the mock's booking id; a real one's is internal
  status?: string; // a cancelled one's plain words
  checkIn?: string; // once anyone on it is in: "You’re in · 7:12 PM", "3 of 4 in · 7:12 PM"
  paid?: Payment;
  refund?: Refund;
  group?: string;
  online?: string | null;
  onCancel?: () => void;
};

function Mock({ id }: { id: string }) {
  const b = bookings.find((x) => x.id === id);
  const e = b && events.find((x) => x.id === b.eventId);
  const host = e && hosts.find((h) => h.id === e.hostId);
  if (!b || !e || !host) return <NotFound what="ticket" />;
  const cancel = () =>
    Alert.alert('Cancel this ticket?', 'Your seat goes back to the host at once.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel ticket', style: 'destructive', onPress: () => router.back() },
    ]);
  return (
    <TicketView
      t={{
        e, host, now: mockNow, qr: b.qr, code: b.code, count: b.count, tier: b.tier, booking: b.id, group: b.group,
        paid: payments.find((p) => p.eventId === e.id), refund: refunds.find((r) => r.eventId === e.id && isOpen(r.status)), onCancel: cancel,
      }}
    />
  );
}

function Live({ id }: { id: string }) {
  const me = useSession()?.me.id ?? '';
  const page = useLoad(`ticket|${me}|${id}`, () => ticketsApi(api).one(id));
  const [cancelled, setCancelled] = useState<LiveTicket>();
  useEffect(() => {
    if (page.data && !cancelled) keepTicket(page.data); // never the confirmed answer over a cancel made here
  }, [page.data, cancelled]);
  const t = cancelled ?? page.data ?? (page.status === 404 ? null : keptTicket(id)); // the phone's copy until the answer comes
  if (!t) return page.status === 404 ? <NotFound what="ticket" /> : page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />;

  const now = Date.now();
  const live = t.status === 'confirmed';
  const cancel = () =>
    Alert.alert('Cancel this ticket?', 'Your seat goes back to the host at once.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel ticket',
        style: 'destructive',
        onPress: async () => {
          const r = await ticketsApi(api).cancel(t.id);
          if (!r.ok) return Alert.alert('Couldn’t cancel', r.error.message);
          setCancelled(r.data);
          ticketsChanged(r.data);
        },
      },
    ]);
  return (
    <TicketView
      t={{
        e: toEvent(t.event), host: toHost(t.event.host), now, qr: t.qr, code: t.code, count: t.quantity, tier: t.ticketType.name,
        status: statusText(t.status), checkIn: checkInLine(t), online: t.onlineLink, onCancel: live && t.ticketType.pricePaise === 0 ? cancel : undefined,
      }}
    />
  );
}

function TicketView({ t }: { t: Shown }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const holder = useSession()?.me.name ?? '';
  const { e, host, now, paid, refund } = t;
  // The host's newest announcement sits on top (Notifications doc: a host announcement opens "the ticket, with the
  // announcement on top").
  const news = useAnnouncement(e.id);
  const can = ticketActions({ paid: !!paid, startsAt: e.startsAt, refundOpen: !!refund, now });
  const place = `${e.venue.name}, ${e.venue.address}`;
  // As big as the page allows inside the plate, but no bigger than a scanner needs.
  const size = Math.min(width - 2 * (20 + EDGE + PAD), 280);

  const askRefund = () =>
    paid &&
    Alert.alert('Ask for a refund?', `${formatPrice(paid.pricePaise)} comes back to your ${paid.via}. ${host.name} decides until their cut-off, then Orbit does.`, [
      { text: 'Not now', style: 'cancel' },
      // ponytail: nothing to send it to until the API exists.
      { text: 'Ask for a refund' },
    ]);

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + TOP, paddingBottom: insets.bottom + space.big }}>
        {news && (
          <View style={styles.news}>
            <HostSays host={host} text={news.text} line={`${host.name} · ${dayLabel(news.at, now)}, ${timeLabel(news.at)}`} />
          </View>
        )}
        {/* A Clean row, the host on top; no price or star on a ticket. */}
        <View style={[styles.event, news && styles.afterNews]}>
          <EventRow event={e} host={host} found kicker={host.name} past now={now} />
        </View>

        {/* The QR on white, as scanners read best: a 1px frosted rim round a plate whose padding, with the QR's own
            margin, gives it the standard's quiet zone. Corners nest as on every card (6 + 16 = 22, rim 23). */}
        {t.qr && t.code ? (
          <View style={styles.gate}>
            <Glass style={styles.qrRim}>
              <View style={styles.plate}>
                <QrCode value={t.qr} size={size} />
              </View>
            </Glass>
            <Text style={styles.admits}>{t.count > 1 ? `Admits ${t.count}` : 'Admits 1'}</Text>
            <Text style={styles.code} selectable accessibilityLabel={`Ticket code ${t.code.split('').join(' ')}`}>
              {spacedCode(t.code)}
            </Text>
            {t.checkIn && <Text style={styles.admits}>{t.checkIn}</Text>}
          </View>
        ) : (
          <View style={styles.gate}>
            <Text style={styles.admits}>{t.status}</Text>
          </View>
        )}

        <View style={styles.details}>
          <FactCard>
            <Fact label="Ticket" value={t.tier} />
            <Fact label="Holder" value={holder} />
            {t.booking && <Fact label="Booking" value={t.booking} />}
            <Fact label="Venue" value={e.venue.name} />
            <Fact label="Paid" value={paid ? formatPrice(paid.pricePaise + paid.feePaise) : 'Free'} />
            {refund && <Fact label="Refund" value={refund.status} />}
          </FactCard>
        </View>

        <View style={styles.actions}>
          <Pill label="Add to calendar" size="small" onPress={() => Linking.openURL(calendarLink({ title: e.title, startsAt: e.startsAt, place }))} />
          {!!e.venue.address && <Pill label="Directions" size="small" onPress={() => Linking.openURL(mapsUrl(place))} />}
          <Pill label="Share" size="small" onPress={() => Share.share({ message: `I’m going to ${e.title}, ${e.when}. ${WEB}/event/${e.slug}` })} />
          {t.online && <Pill label="Join online" size="small" onPress={() => Linking.openURL(t.online!)} />}
          {t.group && <Pill label="WhatsApp group" size="small" onPress={() => Linking.openURL(t.group!)} />}
        </View>

        {can.refund && (
          <View style={styles.last}>
            <Pill label="Ask for a refund" size="wide" onPress={askRefund} />
          </View>
        )}
        {can.cancel && t.onCancel && (
          <View style={styles.last}>
            <Pill label="Cancel ticket" size="wide" onPress={t.onCancel} />
          </View>
        )}
      </ScrollView>
      <BackBar dark />
    </View>
  );
}

const QUIET = 2; // modules of margin round the QR; the plate's padding makes up the rest of the standard's four

// The QR as one path, a rectangle per run of dark modules in a row.
function QrCode({ value, size }: { value: string; size: number }) {
  const { d, n } = useMemo(() => {
    const m = qr(value);
    let path = '';
    m.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (!row[x]) continue;
        let run = 1;
        while (row[x + run]) run++;
        path += `M${x} ${y}h${run}v1h${-run}z`;
        x += run - 1;
      }
    });
    return { d: path, n: m.length };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${n + 2 * QUIET} ${n + 2 * QUIET}`} accessibilityLabel="Ticket QR code">
      <Path d={d} fill="#000" />
    </Svg>
  );
}

const PLATE = around(radius.sm, PAD);
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  news: { marginTop: space.small, marginHorizontal: 20 },
  details: { marginTop: space.big },
  event: { marginTop: space.small },
  afterNews: { marginTop: space.big },
  gate: { marginTop: space.small, alignItems: 'center' },
  qrRim: { padding: EDGE, borderRadius: RIM },
  plate: { padding: PAD, borderRadius: PLATE, backgroundColor: '#FFFFFF' },
  admits: { marginTop: 16, fontFamily: font.title, fontSize: 15, color: color.text },
  // The code in two halves, spaced out so it reads aloud cleanly.
  code: { marginTop: 4, fontFamily: font.price, fontSize: 20, letterSpacing: 3, color: color.text },
  actions: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.small },
  last: { marginTop: space.big },
});
