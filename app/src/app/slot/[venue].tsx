// Booking a slot at a place to play (owner, 19 Nov 2026: "Booking screens"; Play doc), from its page's Book a slot.
// Pick the kind of station, the day (today and the next 13), the start, how long, and for gaming how many or two on
// one; then it's held for you for 10 minutes while you pay (Play 17). If the hold runs out you can ask to hear if that
// time frees up, once (Play 18). The rules are in src/booking.ts. Days and free times follow the app's clock (the mock's
// `now`); the hold counts down on the real one.
// Since 19 Nov 2026 in the Tickets sheet's language (owner approved Take 5 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): Slot and Pay as a capsule, the picks in outlined cards, the way
// you pay on the dark bar's left, and Orbit saying what a hold means, that it ended, and what isn't on yet.
// ponytail: payments (Razorpay) and the slots API aren't on yet, so Pay says so and charges nothing; free stations are a
// made-up pattern until the API knows the bookings.
import { formatPrice } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BookBar } from '../../bookBar';
import { bookingDays, freeAt, HOLD_MS, holdLeft, MAX_HOURS, mmss, slotLine, slotPrice, startTimes, timeLabel } from '../../booking';
import { Fact, FactCard } from '../../fact';
import { perHour, startsLine, venues } from '../../kinds';
import { hosts, now } from '../../mock';
import { payLabel, payReady } from '../../pay';
import { PayMark } from '../../payChoices';
import { Chip, Stepper, Steps } from '../../pickers';
import { answerPush } from '../../push';
import { NotFound, Sheet, SheetSays } from '../../rows';
import { usePayWith } from '../../session';
import { color, font, space } from '../../theme';


const NOT_PAYING = 'Orbit isn’t taking payments yet, so nothing was charged.';

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
  const [said, setSaid] = useState(false); // Pay tapped: Orbit says payments aren't on yet
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
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
    setSaid(false);
  };
  const hold = () => {
    setHeldAt(Date.now());
    setClock(Date.now());
    setAsked(false);
    setSaid(false);
  };
  const steps = [
    { key: 'pick' as const, label: 'Slot', ready: true },
    { key: 'pay' as const, label: 'Pay', ready: heldAt !== null && !lapsed },
  ];

  return (
    <Sheet title={heldAt === null ? 'Book a slot' : lapsed ? 'Hold ended' : 'Held for you'} note={host.name} full>
      <ScrollView ref={scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
        {/* Tap Slot while a time is held to pick again (the hold lets go). */}
        <Steps steps={steps} at={heldAt === null ? 'pick' : 'pay'} onPick={(k) => k === 'pick' && pick(() => undefined)} />
        {heldAt === null ? (
          <>
            <FactCard flush>
              <View style={styles.group}>
                <Text style={styles.label}>What</Text>
                <View style={styles.wrap}>
                  {v.stations.map((x, i) => (
                    <Chip key={x.name} label={`${x.name} · ${perHour(x.pricePaise)}`} picked={i === si} onPress={() => pick(() => { setSi(i); setCoop(false); setCount(1); })} />
                  ))}
                </View>
              </View>
            </FactCard>

            <FactCard flush>
              <View style={styles.group}>
                <Text style={styles.label}>Day</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {days.map((d, i) => (
                    <Chip key={d.start} label={d.label} picked={i === day} onPress={() => pick(() => setDay(i))} />
                  ))}
                </ScrollView>
              </View>
              <View style={styles.group}>
                <Text style={styles.label}>Start</Text>
                {times.length > 0 && (
                  <View style={styles.wrap}>
                    {times.map((t) => (
                      <Chip key={t} label={timeLabel(t)} picked={t === chosen} disabled={freeAt(s, t, hours) < need} onPress={() => pick(() => setStart(t))} />
                    ))}
                  </View>
                )}
                <Text style={styles.note}>{startsLine(v)}</Text>
              </View>
            </FactCard>
            {times.length === 0 && <SheetSays text="Nothing’s left that day. Try another." />}

            <FactCard flush>
              <View style={styles.line}>
                <Text style={[styles.grow, styles.value]}>For {unitHours}</Text>
                <Stepper value={hours} min={1} max={MAX_HOURS} label="Hours" onChange={(n) => pick(() => setHours(n))} />
              </View>
              {!whole && (
                <>
                  <View style={styles.line}>
                    <Text style={[styles.grow, styles.value]}>
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
            </FactCard>
          </>
        ) : lapsed ? (
          <>
            <FactCard flush>
              <Fact label="Was held for you" value={line ?? ''} note={formatPrice(price)} />
            </FactCard>
            {/* Ask once to hear if it frees up (Play 18); the tap is the yes to the phone's push prompt (src/push.tsx). */}
            <SheetSays
              text="Your hold ended, so someone else can book this time now."
              then={asked ? { mine: 'Hear if it frees up', reply: 'I’ll tell you once if it frees up.' } : undefined}
              answers={
                asked
                  ? []
                  : [
                      {
                        label: 'Hear if it frees up',
                        onPress: () => {
                          setAsked(true);
                          void answerPush(true); // the tap says it already: the phone's push prompt, if never asked (src/push.tsx)
                        },
                      },
                    ]
              }
            />
          </>
        ) : (
          <>
            <FactCard flush>
              <Fact label={`${mmss(left)} left to pay`} value={line ?? ''} note={formatPrice(price)} />
            </FactCard>
            <SheetSays text="It’s yours if you pay before the time’s up. You can cancel up to 2 hours before the start." />
            {said && <SheetSays text={NOT_PAYING} />}
          </>
        )}
      </ScrollView>
      <BookBar
        dark
        // Before a start is picked, the station's cheapest hour (its off-peak where it has one), as the venue page's from.
        price={chosen !== null ? formatPrice(price) : perHour(Math.min(s.pricePaise, s.offPeak?.pricePaise ?? Infinity))}
        from={chosen === null}
        note={line ?? 'Pick a start time'}
        action={heldAt === null ? 'Hold for 10 minutes' : lapsed ? 'Pick again' : 'Pay'}
        onAction={
          heldAt === null
            ? chosen === null
              ? undefined
              : hold
            : lapsed
              ? () => setHeldAt(null)
              : payReady(pay)
                ? () => {
                    setSaid(true);
                    AccessibilityInfo.announceForAccessibility(NOT_PAYING); // focus stays on the bar
                    requestAnimationFrame(() => scroll.current?.scrollToEnd());
                  }
                : () => router.push('/pay')
        }
        // Held, the way you pay on the bar's left, as on the Tickets sheet; a tap opens How to pay.
        pay={heldAt !== null && !lapsed ? { mark: <PayMark pay={pay} />, label: payLabel(pay), onPress: () => router.push('/pay') } : undefined}
        onHeight={setBar}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  grow: { flex: 1, minWidth: 0 },
  group: { gap: space.small },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  row: { gap: space.small },
  line: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.small },
  label: { fontFamily: font.medium, fontSize: 12, color: color.secondary }, // a fact's label (src/fact.tsx)
  value: { fontFamily: font.title, fontSize: 15, color: color.text },
  note: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
