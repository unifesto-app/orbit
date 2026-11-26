// Booking a slot at a place to play (owner, 19 Nov 2026: "Booking screens"; Play doc), from its page's Book a slot.
// Pick the kind of station, the day (today and the next 13), the start, how long, and for gaming how many or two on
// one; then it's held for you for 10 minutes while you pay (Play 17). If the hold runs out you can ask to hear if that
// time frees up, once (Play 18). The rules are in src/booking.ts. Days and free times follow the app's clock (the mock's
// `now`); the hold counts down on the real one.
// Since 19 Nov 2026 in the Tickets sheet's language (owner approved Take 5 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq): Slot and Pay as a capsule, the picks in outlined cards, the way
// you pay on the dark bar's left, and Orbit saying what a hold means, that it ended, and what isn't on yet.
// A real venue books on the API (LiveSlots below, X8). The mock's venues keep the mock: Pay says payments aren't on and
// charges nothing, and free stations are a made-up pattern.
import { formatPrice, type NewHold, type SlotHold } from '@orbit/contract';
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
import { Failed, NotFound, Sheet, SheetSays, Waiting } from '../../rows';
import { api, needsAccount, real, usePayWith } from '../../session';
import { confirmed, holdMsLeft, PAYS, payForHold, slotDays, slotMessage, slotsApi, startsFor } from '../../slots';
import { useLoad } from '../../load';
import { color, font, space } from '../../theme';


const NOT_PAYING = 'Orbit isn’t taking payments yet, so nothing was charged.';

// A real venue (a host's uuid, the "UUID = real, else mock" rule since #43) books on the API; a mock one's id draws the
// mock's sheet below, as it was.
export default function SlotSheet() {
  const { venue: id, name } = useLocalSearchParams<{ venue: string; name?: string }>();
  return real(id) ? <LiveSlots id={id} name={name} /> : <MockSlots id={id} />;
}

function MockSlots({ id }: { id: string }) {
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

// Booking a real venue's slot (X8, on X7's API through src/slots.ts), in the mock's look. The days and each station's
// free starts are the API's; a hold is the server's, so its countdown runs to the server's holdEndsAt. A ₹0 slot is
// confirmed with a tap and shows its code; a priced one shows the server's total with Pay off until payments land
// (payForHold, src/slots.ts: the one seam). A full time, or a hold that ran out, can ask to hear if it frees up.
// ponytail: a hold doesn't carry co-op yet (the API prices it solo), so no Two on one here; and a booked slot's code
// shows on this sheet only, until slot bookings join Tickets.
const HOUR = 3_600_000;
function LiveSlots({ id, name }: { id: string; name?: string }) {
  const [di, setDi] = useState(0);
  const [si, setSi] = useState(0);
  const [hours, setHours] = useState(1);
  const [count, setCount] = useState(1);
  const [start, setStart] = useState<number | null>(null);
  const [held, setHeld] = useState<SlotHold | null>(null);
  const [booked, setBooked] = useState<SlotHold | null>(null);
  const [total, setTotal] = useState<number | null>(null); // the confirm's 402: what this hold costs
  const [said, setSaid] = useState<string | null>(null); // Orbit's last word: a refusal
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [bar, setBar] = useState(140);
  const pay = usePayWith();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const first = useLoad(`slots|${id}`, () => slotsApi(api).publicSlots(id));
  const days = first.data ? slotDays(first.data.day) : [];
  const dayText = di > 0 ? (days[di]?.day ?? null) : null;
  const other = useLoad(dayText && `slots|${id}|${dayText}`, () => slotsApi(api).publicSlots(id, dayText ?? undefined));
  const page = di === 0 ? first : other;
  const ends = booked ? null : (held?.holdEndsAt ?? null);
  // While held, the countdown ticks every second to the server's end, and stops itself once it's run out.
  useEffect(() => {
    if (!ends) return;
    const t = setInterval(() => {
      const at = Date.now();
      setClock(at);
      if (at >= Date.parse(ends)) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [ends]);

  if (!first.data) return first.status === 404 ? <NotFound what="place to play" /> : first.error ? <Failed message={first.error.message} retry={first.reload} /> : <Waiting />;
  const stations = page.data?.stations ?? first.data.stations;
  const s = stations[Math.min(si, stations.length - 1)];
  if (!s) return <NotFound what="place to play" />;

  const kind = { kind: s.whole ? ('turf' as const) : ('gaming' as const) }; // a pitch or court is booked whole, for the group
  const unit = { name: s.name, unit: [s.unit] };
  const need = s.whole ? 1 : count;
  const times = page.data ? startsFor(s, hours) : [];
  const chosen = times.find((t) => t.at === start) ?? null;
  const full = chosen !== null && chosen.free < need;
  const ofHold = (h: SlotHold) => ({ at: Date.parse(h.start), hours: (Date.parse(h.end) - Date.parse(h.start)) / HOUR, count: h.count });
  const was = held && ofHold(held);
  const line = was ? slotLine(kind, unit, was.at, was.hours, was.count) : chosen ? slotLine(kind, unit, chosen.at, hours, need) : undefined;
  const cost = was ? (total ?? slotPrice(s, was.at, was.hours, was.count)) : chosen ? slotPrice(s, chosen.at, hours, need) : null;
  const priced = cost !== null && cost > 0;
  const left = held ? holdMsLeft(held.holdEndsAt, clock) : 0;
  const lapsed = !!held && !booked && left === 0;
  const unitHours = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

  const say = (text: string) => {
    setSaid(text);
    AccessibilityInfo.announceForAccessibility(text); // focus stays on the bar
    requestAnimationFrame(() => scroll.current?.scrollToEnd());
  };
  // Every call needs an account: signed out, the sign-in sheet first, then the tap goes on (src/session.ts).
  const run = (fn: () => Promise<void>) =>
    needsAccount(async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  const clear = () => {
    setHeld(null);
    setTotal(null);
    setSaid(null);
    setAsked(false);
  };
  // A new pick lets go of a live hold, so the time is free for others at once.
  const pick = (fn: () => void) => {
    fn();
    if (held && !booked && !lapsed) void slotsApi(api).letGo(id, held.id);
    clear();
  };
  const asNew = (): NewHold => ({ stationId: s.id, start: new Date(chosen!.at).toISOString(), hours, count: need });
  const hold = () =>
    run(async () => {
      const r = await slotsApi(api).hold(id, asNew());
      if (!r.ok) {
        if (r.error.error === 'full' || r.error.error === 'badTime') page.reload();
        return say(slotMessage(r.error));
      }
      clear();
      setHeld(r.data);
      setClock(Date.now());
      // A priced slot asks the server what it costs: the confirm answers 402 with the total, and changes nothing.
      if (cost) {
        const c = confirmed(await slotsApi(api).confirm(id, r.data.id));
        if ('pay' in c) setTotal(c.pay);
        else if ('booked' in c) setBooked(c.booked);
      }
    });
  const confirm = () =>
    run(async () => {
      const c = confirmed(await slotsApi(api).confirm(id, held!.id));
      if ('booked' in c) setBooked(c.booked);
      else if ('pay' in c) setTotal(c.pay);
      else say(c.no);
    });
  const payNow = () =>
    run(async () => {
      const c = confirmed(await payForHold(id, held!.id));
      if ('booked' in c) setBooked(c.booked);
      else if ('no' in c) say(c.no);
    });
  const letGo = () =>
    run(async () => {
      await slotsApi(api).letGo(id, held!.id); // a hold already ended answers 404: let go all the same
      clear();
      page.reload();
    });
  // Hear if it frees up (Play 18): once; the tap is also the yes to the phone's push prompt (src/push.tsx).
  const ask = (what: NewHold) =>
    run(async () => {
      const r = await slotsApi(api).askAlert(id, what);
      if (!r.ok) return say(slotMessage(r.error));
      setAsked(true);
      void answerPush(true);
    });
  // What "Hear if it frees up" asks about: the hold that ran out, or the full time picked.
  const what: (() => NewHold) | null = lapsed ? () => ({ stationId: held.stationId, start: held.start, hours: was!.hours, count: held.count }) : full ? asNew : null;
  const hear = what && (
    <SheetSays
      text={held ? 'Your hold ended, so someone else can book this time now.' : 'That time’s full.'}
      then={asked ? { mine: 'Hear if it frees up', reply: 'I’ll tell you once if it frees up.' } : undefined}
      answers={asked ? [] : [{ label: 'Hear if it frees up', onPress: () => ask(what()) }]}
    />
  );
  const steps = [
    { key: 'pick' as const, label: 'Slot', ready: !booked },
    { key: 'pay' as const, label: priced ? 'Pay' : 'Confirm', ready: !!held && !lapsed },
  ];
  const from = Math.min(...stations.map((x) => Math.min(x.pricePaise, x.offPeak?.pricePaise ?? Infinity)));

  return (
    <Sheet title={booked ? 'Booked' : !held ? 'Book a slot' : lapsed ? 'Hold ended' : 'Held for you'} note={name} full>
      <ScrollView ref={scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
        <Steps steps={steps} at={held ? 'pay' : 'pick'} onPick={(k) => k === 'pick' && !booked && pick(() => undefined)} />
        {booked ? (
          <>
            <FactCard flush>
              <Fact label="Booked" value={line ?? ''} note={booked.code ? `Code ${booked.code}` : undefined} />
            </FactCard>
            <SheetSays text="Show this code at the desk when you get there." />
          </>
        ) : !held ? (
          <>
            <FactCard flush>
              <View style={styles.group}>
                <Text style={styles.label}>What</Text>
                <View style={styles.wrap}>
                  {stations.map((x, i) => (
                    <Chip
                      key={x.id}
                      label={`${x.name} · ${perHour(x.pricePaise)}`}
                      picked={x.id === s.id}
                      onPress={() => pick(() => { setSi(i); setCount(1); })}
                    />
                  ))}
                </View>
              </View>
            </FactCard>

            <FactCard flush>
              <View style={styles.group}>
                <Text style={styles.label}>Day</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                  {days.map((d, i) => (
                    <Chip key={d.day} label={d.label} picked={i === di} onPress={() => pick(() => setDi(i))} />
                  ))}
                </ScrollView>
              </View>
              <View style={styles.group}>
                <Text style={styles.label}>Start</Text>
                {times.length > 0 && (
                  <View style={styles.wrap}>
                    {/* A full time stays pickable, to hear if it frees up. */}
                    {times.map((t) => (
                      <Chip key={t.at} label={t.free < need ? `${timeLabel(t.at)} · Full` : timeLabel(t.at)} picked={t.at === chosen?.at} onPress={() => pick(() => setStart(t.at))} />
                    ))}
                  </View>
                )}
                <Text style={styles.note}>{startsLine(kind)}</Text>
              </View>
            </FactCard>
            {page.data && times.length === 0 && <SheetSays text={page.data.opening ? 'Nothing’s left that day. Try another.' : 'Closed that day. Try another.'} />}
            {!page.data && page.error && <SheetSays text={slotMessage(page.error)} answers={[{ label: 'Try again', onPress: page.reload }]} />}

            <FactCard flush>
              <View style={styles.line}>
                <Text style={[styles.grow, styles.value]}>For {unitHours}</Text>
                <Stepper value={hours} min={1} max={MAX_HOURS} label="Hours" onChange={(n) => pick(() => setHours(n))} />
              </View>
              {!s.whole && (
                <View style={styles.line}>
                  <Text style={[styles.grow, styles.value]}>{`${count} × ${s.unit}`}</Text>
                  <Stepper value={count} min={1} max={s.count} label={s.unit} onChange={(n) => pick(() => setCount(n))} />
                </View>
              )}
            </FactCard>
            {hear}
          </>
        ) : lapsed ? (
          <>
            <FactCard flush>
              <Fact label="Was held for you" value={line ?? ''} note={cost !== null ? formatPrice(cost) : undefined} />
            </FactCard>
            {hear}
          </>
        ) : (
          <>
            <FactCard flush>
              <Fact label={`${mmss(left)} left to ${priced ? 'pay' : 'confirm'}`} value={line ?? ''} note={cost !== null ? formatPrice(cost) : undefined} />
            </FactCard>
            <SheetSays
              text={
                !priced
                  ? 'It’s yours once you confirm, before the time’s up.'
                  : PAYS
                    ? 'It’s yours if you pay before the time’s up. You can cancel up to 2 hours before the start.'
                    : 'Paying in the app is coming soon, so this slot can’t be paid for yet. Nothing was charged.'
              }
              answers={[{ label: 'Let go', onPress: letGo }]}
            />
          </>
        )}
        {said && <SheetSays text={said} />}
      </ScrollView>
      <BookBar
        dark
        price={cost !== null ? formatPrice(cost) : perHour(from)}
        from={cost === null}
        note={line ?? 'Pick a start time'}
        action={booked ? 'Done' : !held ? (full ? 'Full' : 'Hold for 10 minutes') : lapsed ? 'Pick again' : priced ? 'Pay' : 'Confirm'}
        onAction={
          busy
            ? undefined
            : booked
              ? () => router.back()
              : !held
                ? chosen && !full
                  ? hold
                  : undefined
                : lapsed
                  ? () => pick(() => undefined)
                  : priced
                    ? PAYS && total !== null
                      ? payReady(pay)
                        ? payNow
                        : () => router.push('/pay')
                      : undefined
                    : confirm
        }
        pay={held && !lapsed && !booked && priced ? { mark: <PayMark pay={pay} />, label: payLabel(pay), onPress: () => router.push('/pay') } : undefined}
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
