// Booking a slot at a place to play (owner, 19 Nov 2026: "Booking screens"; Play doc), from its page's Book a slot.
// Pick the kind of station, the day (today and the next 13), the start, how long, and for gaming how many or two on
// one; then it's held for you for 10 minutes while you pay (Play 17). If the hold runs out you can ask to hear if that
// time frees up, once (Play 18). The rules are in src/booking.ts. Days and free times follow the app's clock (the mock's
// `now`); the hold counts down on the real one.
// ponytail: payments (Razorpay) and the slots API aren't on yet, so Pay says so and charges nothing; free stations are a
// made-up pattern until the API knows the bookings.
import { formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Pill } from '../../account/kit';
import { BookBar } from '../../bookBar';
import { bookingDays, freeAt, HOLD_MS, holdLeft, MAX_HOURS, mmss, slotLine, slotPrice, startTimes, timeLabel } from '../../booking';
import { Fact, FactCard } from '../../fact';
import { perHour, startsLine, venues } from '../../kinds';
import { hosts, now } from '../../mock';
import { payLabel, payName, payReady } from '../../pay';
import { Chip, Stepper } from '../../pickers';
import { NotFound, Sheet } from '../../rows';
import { usePayWith } from '../../session';
import { color, font, space } from '../../theme';


export default function SlotSheet() {
  const { venue: id } = useLocalSearchParams<{ venue: string }>();
  const v = venues[id];
  const host = hosts.find((h) => h.id === id);
  const [si, setSi] = useState(0);
  const [day, setDay] = useState(0);
  const [hours, setHours] = useState(1);
  const [start, setStart] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [coop, setCoop] = useState(false);
  const [heldAt, setHeldAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [asked, setAsked] = useState(false);
  const pay = usePayWith(); // the way you usually pay, changed from Pay with (src/app/pay.tsx)
  const [bar, setBar] = useState(140);
  // While held, the countdown ticks every second, and stops itself once the hold has run out.
  useEffect(() => {
    if (heldAt === null) return;
    const t = setInterval(() => {
      const at = Date.now();
      setClock(at);
      if (at - heldAt >= HOLD_MS) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [heldAt]);
  if (!v || !host) return <NotFound what="place to play" />;
  const days = bookingDays(now); // the app's clock, read each time, so the days move with it

  const s = v.stations[si]!;
  const whole = v.kind !== 'gaming'; // a pitch or court is booked whole, for the group
  const need = whole || coop ? 1 : count; // stations a time needs free
  const times = startTimes(v, days[day]!.start, now, hours);
  const chosen = start !== null && times.includes(start) && freeAt(s, start, hours) >= need ? start : null;
  const free = chosen !== null ? freeAt(s, chosen, hours) : s.count;
  const price = chosen !== null ? slotPrice(s, chosen, hours, need, coop) : 0;
  const line = chosen !== null ? slotLine(v, s, chosen, hours, need) : undefined;
  const left = heldAt === null ? 0 : holdLeft(heldAt, clock);
  const lapsed = heldAt !== null && left === 0;
  const unitHours = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const pick = (fn: () => void) => {
    fn();
    setHeldAt(null);
  };

  return (
    <Sheet title={heldAt === null ? 'Book a slot' : lapsed ? 'Hold ended' : 'Held for you'} note={host.name} full>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
        {heldAt === null ? (
          <>
            <Text style={styles.heading}>What</Text>
            <View style={styles.wrap}>
              {v.stations.map((x, i) => (
                <Chip key={x.name} label={`${x.name} · ${perHour(x.pricePaise)}`} picked={i === si} onPress={() => pick(() => { setSi(i); setCoop(false); setCount(1); })} />
              ))}
            </View>

            <Text style={styles.heading}>When</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              {days.map((d, i) => (
                <Chip key={d.start} label={d.label} picked={i === day} onPress={() => pick(() => setDay(i))} />
              ))}
            </ScrollView>

            <Text style={styles.heading}>Start</Text>
            {times.length ? (
              <View style={styles.wrap}>
                {times.map((t) => (
                  <Chip key={t} label={timeLabel(t)} picked={t === chosen} disabled={freeAt(s, t, hours) < need} onPress={() => pick(() => setStart(t))} />
                ))}
              </View>
            ) : (
              <Text style={styles.note}>Nothing left that day. Try another.</Text>
            )}
            <Text style={styles.note}>{startsLine(v)}</Text>

            <View style={styles.line}>
              <Text style={[styles.grow, styles.label]}>For {unitHours}</Text>
              <Stepper value={hours} min={1} max={MAX_HOURS} label="Hours" onChange={(n) => pick(() => setHours(n))} />
            </View>
            {!whole && (
              <>
                <View style={styles.line}>
                  <Text style={[styles.grow, styles.label]}>
                    {coop ? `1 ${s.unit[0]}, two playing` : `${count} ${count === 1 ? s.unit[0] : s.unit[1]}`}
                  </Text>
                  {!coop && <Stepper value={count} min={1} max={Math.max(Math.min(free, s.count), 1)} label={s.unit[1]} onChange={(n) => pick(() => setCount(n))} />}
                </View>
                {s.coopPaise && (
                  <View style={styles.wrap}>
                    <Chip label={`Two on one · ${perHour(s.coopPaise)}`} picked={coop} onPress={() => pick(() => setCoop(!coop))} />
                  </View>
                )}
              </>
            )}
          </>
        ) : (
          <FactCard flush>
            <Fact label={lapsed ? 'Was held for you' : `${mmss(left)} left to pay`} value={line ?? ''} note={formatPrice(price)} />
            {lapsed ? (
              <>
                <Fact label="Your hold ended" value="Someone else can book this time now" />
                {asked ? (
                  <Text style={styles.note}>We’ll tell you once if it frees up.</Text>
                ) : (
                  <View style={styles.wrap}>
                    <Pill label="Hear if it frees up" size="small" onPress={() => setAsked(true)} />
                  </View>
                )}
              </>
            ) : (
              <>
                <Fact label="Pay with" value={payReady(pay) ? payName(pay) : 'Choose how to pay'} onPress={() => router.push('/pay')} />
                <Text style={styles.note}>Pay before the time’s up and it’s yours. You can cancel up to 2 hours before the start.</Text>
              </>
            )}
          </FactCard>
        )}
      </ScrollView>
      <BookBar
        // Before a start is picked, the station's cheapest hour (its off-peak where it has one), as the venue page's from.
        price={chosen !== null ? formatPrice(price) : perHour(Math.min(s.pricePaise, s.offPeak?.pricePaise ?? Infinity))}
        from={chosen === null}
        note={line ?? 'Pick a start time'}
        action={heldAt === null ? 'Hold for 10 minutes' : lapsed ? 'Pick again' : payReady(pay) ? `Pay ${formatPrice(price)}` : payLabel(pay)}
        onAction={
          heldAt === null
            ? chosen === null
              ? undefined
              : () => {
                  setHeldAt(Date.now());
                  setClock(Date.now());
                  setAsked(false);
                }
            : lapsed
              ? () => setHeldAt(null)
              : payReady(pay)
                ? () => Alert.alert('Payments aren’t on yet', 'Orbit isn’t taking payments yet, so nothing was charged.')
                : () => router.push('/pay')
        }
        onHeight={setBar}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.small + 4 },
  grow: { flex: 1, minWidth: 0 },
  heading: { marginTop: space.small, fontFamily: font.headline, fontSize: 18, color: color.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  row: { gap: space.small },
  line: { marginTop: space.small, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.small },
  label: { fontFamily: font.title, fontSize: 15, color: color.text },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
