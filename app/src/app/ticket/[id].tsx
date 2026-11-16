// A ticket (Booking doc, The ticket; Event day doc), opened from Account › Tickets, Home's ticket stack and the event
// page. The event first, as a row that opens its page; then the QR the crew scans at the gate, big on a bright plate,
// with how many it admits and the 8-character code they type when a QR won't scan; then what the booking is, and what
// can be done with it. One QR per booking, admitting everyone on it. The QR is drawn on the phone (src/qr.ts), so it
// shows with no signal.
// Not here yet: Pass on, for free single tickets (it needs its own form), and a brighter screen at the gate
// (expo-brightness, a native rebuild). No wallet pass in v1 (Booking decision 8).
// Signed out (a link or a push opened it), a line and Sign in, and the ticket once signed in.
import { formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Linking, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { bookings, payments, profile, refunds } from '../../account/data';
import { EDGE, Group, PAD, Page, Pill, RIM, Row, SignInNote } from '../../account/kit';
import { calendarLink, isOpen, spacedCode, ticketActions } from '../../account/rules';
import { Glass } from '../../glass';
import { events, hosts, now } from '../../mock';
import { qr } from '../../qr';
import { EventRow, NotFound } from '../../rows';
import { useSignedIn } from '../../session';
import { around, color, font, radius, space } from '../../theme';

const WEB = 'https://heyorbit.in'; // the event's page on the web, for sharing
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const signedIn = useSignedIn();
  const b = bookings.find((x) => x.id === id);
  const e = b && events.find((x) => x.id === b.eventId);
  const host = e && hosts.find((h) => h.id === e.hostId);
  if (!signedIn)
    return (
      <Page title="Ticket">
        <SignInNote>Sign in to see this ticket.</SignInNote>
      </Page>
    );
  if (!b || !e || !host) return <NotFound what="ticket" />;

  const paid = payments.find((p) => p.eventId === e.id);
  const refund = refunds.find((r) => r.eventId === e.id && isOpen(r.status));
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
  const cancel = () =>
    Alert.alert('Cancel this ticket?', 'Your seat goes back to the host at once.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel ticket', style: 'destructive', onPress: () => router.back() },
    ]);

  return (
    <Page>
      <View style={styles.event}>
        <EventRow event={e} host={host} past />
      </View>

      {/* The QR on white, as scanners read best: a 1px frosted rim round a plate whose padding, with the QR's own
          margin, gives it the standard's quiet zone. Corners nest as on every card (6 + 16 = 22, rim 23). */}
      <View style={styles.gate}>
        <Glass style={styles.qrRim}>
          <View style={styles.plate}>
            <QrCode value={b.qr} size={size} />
          </View>
        </Glass>
        <Text style={styles.admits}>{b.count > 1 ? `Admits ${b.count}` : 'Admits 1'}</Text>
        <Text style={styles.code} selectable accessibilityLabel={`Ticket code ${b.code.split('').join(' ')}`}>
          {spacedCode(b.code)}
        </Text>
      </View>

      <Group>
        <Row label="Ticket" value={b.tier} />
        <Row label="Holder" value={profile.name} />
        <Row label="Booking" value={b.id} />
        <Row label="Venue" value={e.venue.name} />
        <Row label="Paid" value={paid ? formatPrice(paid.pricePaise + paid.feePaise) : 'Free'} />
        {refund && <Row label="Refund" value={refund.status} />}
      </Group>

      <View style={styles.actions}>
        <Pill label="Add to calendar" size="small" onPress={() => Linking.openURL(calendarLink({ title: e.title, startsAt: e.startsAt, place }))} />
        <Pill label="Directions" size="small" onPress={() => Linking.openURL(mapsUrl(place))} />
        <Pill label="Share" size="small" onPress={() => Share.share({ message: `I’m going to ${e.title}, ${e.when}. ${WEB}/event/${e.id}` })} />
        {b.group && <Pill label="WhatsApp group" size="small" onPress={() => Linking.openURL(b.group!)} />}
      </View>

      {can.refund && (
        <View style={styles.last}>
          <Pill label="Ask for a refund" size="wide" onPress={askRefund} />
        </View>
      )}
      {can.cancel && (
        <View style={styles.last}>
          <Pill label="Cancel ticket" size="wide" onPress={cancel} />
        </View>
      )}
    </Page>
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
  event: { marginTop: space.small },
  gate: { marginTop: space.small, alignItems: 'center' },
  qrRim: { padding: EDGE, borderRadius: RIM },
  plate: { padding: PAD, borderRadius: PLATE, backgroundColor: '#FFFFFF' },
  admits: { marginTop: 16, fontFamily: font.title, fontSize: 15, color: color.text },
  // The code in two halves, spaced out so it reads aloud cleanly.
  code: { marginTop: 4, fontFamily: font.price, fontSize: 20, letterSpacing: 3, color: color.text },
  actions: { marginTop: space.big, marginHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.small },
  last: { marginTop: space.big },
});
