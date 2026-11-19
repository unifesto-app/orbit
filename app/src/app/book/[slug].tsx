// Booking an event (owner, 19 Nov 2026: "Booking screens"; Booking doc), from the event page's Book ticket, Register or
// Join waitlist. Two steps on one sheet: pick, then review.
// - Pick: each ticket type with how many (Booking 17: sold-out types say so). An 18+ or 21+ event books one ticket each
//   (Booking 14). A fest with one ticket type books in one tap for you, with Add people: friends by name only, up to 10
//   in all, off on 18+ and 21+ (Booking 13).
// - Review: what you're getting and the total, then Pay or Register; Change goes back with everything kept.
// - Sold out with a waitlist: Join the waitlist, for how many, with no prices (Booking 17).
// How many of a type fit is ticketMax (src/booking.ts): the booking's limit and the seats left, a team ticket taking its
// team's seats. Free or paid is the event's prices, not what's picked.
// ponytail: payments (Razorpay) and the bookings API aren't on yet, so the last button says so and charges nothing.
import { formatPrice } from '@orbit/contract';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Pill } from '../../account/kit';
import { BookBar } from '../../bookBar';
import { maxGuests, maxTickets, ticketMax } from '../../booking';
import { Fact, FactCard } from '../../fact';
import { fests, shows, teamSeats } from '../../kinds';
import { events, now } from '../../mock';
import { Stepper } from '../../pickers';
import { NotFound, Sheet } from '../../rows';
import { eventStatus } from '../../status';
import { color, font, space } from '../../theme';

export default function Book() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const e = events.find((x) => x.id === slug);
  const tiers = (e?.tiers?.length ? e.tiers : [{ name: e?.pricePaise ? 'Ticket' : 'Entry', pricePaise: e?.pricePaise ?? 0 }]).map((t) => ({
    ...t,
    seats: teamSeats[slug]?.[t.name] ?? t.seats,
  }));
  const [qty, setQty] = useState<number[]>(() => {
    const first = tiers.findIndex((t) => !t.soldOut);
    return tiers.map((_, i) => (i === first ? 1 : 0));
  });
  const [guests, setGuests] = useState<string[]>([]);
  const [wanted, setWanted] = useState(1); // on the waitlist
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [bar, setBar] = useState(140);
  if (!e) return <NotFound what="event" />;

  // ponytail: only comedy shows carry an age in the mock (src/kinds.ts); the API's events carry their own.
  const age = shows[e.id]?.age;
  const oneTap = !!fests[e.id]?.oneClick && tiers.length === 1;
  const named = guests.map((g) => g.trim()).filter(Boolean);
  const lines = oneTap
    ? [{ name: `${tiers[0]!.name} for ${named.length + 1}`, count: named.length + 1, pricePaise: tiers[0]!.pricePaise }]
    : tiers.map((t, i) => ({ name: t.name, count: qty[i]!, pricePaise: t.pricePaise })).filter((l) => l.count > 0);
  const count = lines.reduce((n, l) => n + l.count, 0);
  const total = lines.reduce((n, l) => n + l.count * l.pricePaise, 0);
  const free = tiers.every((t) => t.pricePaise === 0);
  // A paid event with nothing picked shows ₹0, not Free.
  const price = !free && total === 0 ? '₹0' : formatPrice(total);

  if (eventStatus(e, now).kind === 'waitlist') {
    return (
      <Sheet title="Join the waitlist" note={`${e.title} · ${e.when}`} full>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
          <FactCard flush>
            <Fact label="Sold out" value="Join, and hear if tickets free up" note="Nothing is booked or charged by joining." />
            <View style={styles.line}>
              <Text style={[styles.grow, styles.name]}>How many</Text>
              <Stepper value={wanted} min={1} max={maxTickets(age)} label="Tickets wanted" onChange={setWanted} />
            </View>
          </FactCard>
        </ScrollView>
        <BookBar
          price="Sold out"
          from={false}
          note={`${wanted} ${wanted === 1 ? 'ticket' : 'tickets'} wanted`}
          action="Join the waitlist"
          onAction={() => Alert.alert('Waitlists aren’t on yet', 'Orbit isn’t taking bookings yet, so nothing was joined.')}
          onHeight={setBar}
        />
      </Sheet>
    );
  }

  const finish = () =>
    Alert.alert(
      free ? 'Registration isn’t on yet' : 'Payments aren’t on yet',
      free ? 'Orbit isn’t taking bookings yet, so you’re not registered.' : 'Orbit isn’t taking payments yet, so nothing was charged.',
    );

  return (
    <Sheet title={step === 'review' ? 'Review' : free ? 'Register' : 'Tickets'} note={`${e.title} · ${e.when}`} full>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
        {step === 'pick' ? (
          <>
            {oneTap ? (
              <FactCard flush>
                <Fact label="One tap" value={`${tiers[0]!.name} · ${formatPrice(tiers[0]!.pricePaise)} each`} note="You, and anyone you add below. One QR lets you all in." />
              </FactCard>
            ) : (
              <FactCard flush>
                {tiers.map((t, i) => (
                  <View key={t.name} style={styles.line}>
                    <View style={styles.grow}>
                      <Text style={styles.name}>{t.name}</Text>
                      <Text style={styles.meta}>{formatPrice(t.pricePaise)}</Text>
                    </View>
                    {t.soldOut ? (
                      <Text style={styles.meta}>Sold out</Text>
                    ) : (
                      <Stepper
                        value={qty[i]!}
                        max={ticketMax(tiers, qty, i, { age, left: e.left })}
                        label={`${t.name} tickets`}
                        onChange={(n) => setQty((q) => q.map((v, j) => (j === i ? n : v)))}
                      />
                    )}
                  </View>
                ))}
              </FactCard>
            )}
            {age && <Text style={styles.note}>{age} only: one ticket each, and bring a photo ID.</Text>}
            {oneTap && maxGuests(age) > 0 && (
              <>
                <Text style={styles.heading}>Who’s coming with you</Text>
                <FactCard flush>
                  {guests.map((g, i) => (
                    <View key={i} style={styles.line}>
                      <TextInput
                        value={g}
                        onChangeText={(t) => setGuests((all) => all.map((x, j) => (j === i ? t : x)))}
                        placeholder={`Friend ${i + 1}’s name`}
                        placeholderTextColor={color.secondary}
                        keyboardAppearance="dark"
                        autoCapitalize="words"
                        maxLength={60}
                        style={[styles.grow, styles.input]}
                        accessibilityLabel={`Friend ${i + 1}’s name`}
                      />
                      <Pressable onPress={() => setGuests((all) => all.filter((_, j) => j !== i))} accessibilityRole="button" hitSlop={8}>
                        <Text style={styles.meta}>Remove</Text>
                      </Pressable>
                    </View>
                  ))}
                  {guests.length < maxGuests(age) ? (
                    <View style={styles.add}>
                      <Pill label="Add someone" size="small" onPress={() => setGuests((all) => [...all, ''])} />
                    </View>
                  ) : (
                    <Text style={styles.meta}>That’s 10, the most one booking takes.</Text>
                  )}
                </FactCard>
                <Text style={styles.note}>Names only. The host and the door see them, and they’re deleted 30 days after.</Text>
              </>
            )}
          </>
        ) : (
          <FactCard flush>
            {lines.map((l) => (
              <Fact key={l.name} label={`${l.count} × ${formatPrice(l.pricePaise)}`} value={l.name} />
            ))}
            {named.length > 0 && <Fact label="With you" value={named.join(', ')} />}
            <Fact label="Total" value={price} note={free ? undefined : 'Fees, if any, show when you pay'} />
            <View style={styles.add}>
              <Pill label="Change" size="small" onPress={() => setStep('pick')} />
            </View>
          </FactCard>
        )}
      </ScrollView>
      <BookBar
        price={price}
        from={false}
        note={`${count} ${count === 1 ? 'ticket' : 'tickets'}`}
        action={step === 'pick' ? 'Review' : free ? 'Register' : `Pay ${formatPrice(total)}`}
        onAction={count === 0 ? undefined : step === 'pick' ? () => setStep('review') : finish}
        onHeight={setBar}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  grow: { flex: 1, minWidth: 0 },
  line: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.small },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  heading: { fontFamily: font.headline, fontSize: 18, color: color.text },
  input: { height: 36, fontFamily: font.text, fontSize: 15, color: color.text },
  add: { alignItems: 'flex-start' },
});
