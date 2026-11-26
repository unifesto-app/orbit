// Booking an event (owner, 19 Nov 2026: "Booking screens"; Booking doc), from the event page's Book ticket, Register or
// Join waitlist. One sheet, its steps in a capsule under the title (owner approved Take 4 of the detail pages mockup,
// https://claude.ai/artifact/5dDmrmZ6soDjoe8kro1xAq):
// - Tickets: each ticket type with how many (Booking 17: sold-out types say so). An 18+ or 21+ event books one ticket
//   each (Booking 14). A fest with one ticket type books in one tap for you, with Add people: friends by name only, up
//   to 10 in all, off on 18+ and 21+ (Booking 13).
// - Details, when the host asks questions (owner: "Hosts can add Custom Questions to registrations"; Booking doc: asked
//   once per booking, what the profile knows filled in): short text, a choice, or Yes and No.
// - A hackathon books a team instead (owner: "for hackathon we need to collect data right?"; Running hackathons doc):
//   one team ticket, picked, never a count, then Your team: its name, its track, you and the host's questions, and the
//   rules. Teammates claim their seats by link after paying and answer the same questions then.
// - Review: what you're getting and the total. Paying, the way you pay sits on the bar's left as in Unifesto's pay bar
//   (owner: "move paywith to cta, check unifesto app for ref"): a tap changes it, and the button says Pay.
// - Sold out with a waitlist: Join the waitlist, for how many, with no prices (Booking 17).
// The rules and notes are Orbit's bubbles, and what a tap can't do yet Orbit says in the sheet, not in an alert.
// How many of a type fit is ticketMax (src/booking.ts): the booking's limit and the seats left, a team ticket taking its
// team's seats. Free or paid is the event's prices, not what's picked.
// A real event (the API's, P10.1) books for real: one type per booking, up to its per-person limit and the seats left,
// then its ticket opens. A free type registers; a paid one (X3) gets its order from the API on Review, which shows the
// server's price, fee and total, and Pay opens Razorpay's checkout (the native SDK, so UPI apps open from Orbit) on the
// way you picked, then the API confirms it. The mock's steps (questions, teams, Add people, waitlists) and the mock's
// paid events stay the mock's until their slices.
import { formatPrice, type PayOrder, type PublicEvent } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';

import { Field, Pill } from '../../account/kit';
import { BookBar } from '../../bookBar';
import { answered, firstTeam, liveTiers, maxGuests, maxTickets, TEAM_NAME, teamFits, teamNameOk, ticketMax } from '../../booking';
import { Fact, FactCard } from '../../fact';
import { Glass } from '../../glass';
import { Icon } from '../../icons';
import { fests, hackathons, type Question, questions, shows, teamSeats } from '../../kinds';
import { type Event, eventsApi, toEvent } from '../../events';
import { useLoad } from '../../load';
import { events, now as mockNow } from '../../mock';
import { checkoutCancelled, PAY_SAYS, payLabel, paymentsApi, payReady, prefillOf, RAZORPAY_KEY } from '../../pay';
import { PayMark } from '../../payChoices';
import { Chip, Stepper, Steps } from '../../pickers';
import { Failed, NotFound, Sheet, SheetSays, Waiting } from '../../rows';
import { api, loadTickets, needsAccount, ticketsChanged, usePayWith, useSession } from '../../session';
import { eventStatus } from '../../status';
import { ticketsApi } from '../../tickets';
import { color, font, space, stoneAt } from '../../theme';

type Step = 'pick' | 'team' | 'details' | 'review';
const NOT_ON = {
  pay: 'Orbit isn’t taking payments yet, so nothing was charged.',
  register: 'Orbit isn’t taking bookings yet, so you’re not registered.',
  waitlist: 'Waitlists aren’t on yet, so nothing was joined.',
};

// The API's event first (an old slug too); only when it says 404 and the slug is a mock event's id does the mock's
// booking draw, as useEvent does.
export default function Book() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const page = useLoad(`book|${slug}`, () => eventsApi(api).event(slug));
  const mock = page.status === 404 ? events.find((x) => x.id === slug) : undefined;
  if (mock) return <Booking slug={slug} e={mock} now={mockNow} />;
  if (page.data) return <Booking slug={page.data.slug} e={toEvent(page.data)} live={page.data} now={Date.now()} reload={page.reload} />;
  return page.status === 404 ? <NotFound what="event" /> : page.error ? <Failed message={page.error.message} retry={page.reload} /> : <Waiting />;
}

// `reload` reads the event again (a real one's), after the API refused a booking on what this sheet showed.
function Booking({ slug, e, live, now, reload }: { slug: string; e: Event; live?: PublicEvent; now: number; reload?: () => void }) {
  const me = useSession()?.me;
  const tiers: { name: string; pricePaise: number; soldOut?: boolean; seats?: number; id?: string; max?: number; off?: string }[] = live
    ? liveTiers(live.tiers, now)
    : (e.tiers?.length ? e.tiers : [{ name: e.pricePaise ? 'Ticket' : 'Entry', pricePaise: e.pricePaise }]).map((t) => ({
        ...t,
        seats: teamSeats[slug]?.[t.name] ?? t.seats,
      }));
  const hack = hackathons[slug];
  const asks = questions[slug] ?? [];
  // Whether a team ticket fits at all (src/booking.ts).
  const fits = (i: number) => teamFits(tiers, i, { age: shows[slug]?.age, left: e.left });
  const [qty, setQty] = useState<number[]>(() => {
    const first = tiers.findIndex((t) => !t.soldOut && !t.off);
    return tiers.map((_, i) => (i === first ? 1 : 0));
  });
  // A hackathon's team ticket, the biggest team that fits first; when none fits, nothing is booked.
  const [team, setTeam] = useState(() => Math.max(firstTeam(tiers, { age: shows[slug]?.age, left: e.left }), 0));
  const [teamName, setTeamName] = useState('');
  const [track, setTrack] = useState(hack?.tracks[0]?.name);
  const [rules, setRules] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [guests, setGuests] = useState<string[]>([]);
  const [wanted, setWanted] = useState(1); // on the waitlist
  const [step, setStep] = useState<Step>('pick');
  const [said, setSaid] = useState<string>();
  const pay = usePayWith(); // the way you usually pay (Account › Payment methods), changed from the bar
  const [bar, setBar] = useState(140);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const [sending, setSending] = useState(false); // draws the bar's button as off
  const [order, setOrder] = useState<{ key: string; o: PayOrder }>(); // a paid type's order, for the pick it was made for
  const [confirming, setConfirming] = useState(false); // paid, Razorpay still confirming: the bar goes to the tickets
  const sendingNow = useRef(false); // the guard itself: a second tap in the same frame sees it at once
  // A real event read again (after a refusal): each pick held to what its type takes now, so the stepper matches the
  // server. Same tiers by index, as liveTiers keeps the API's order.
  useEffect(() => {
    if (live) setQty((q) => tiers.map((t, i) => Math.min(q[i] ?? 0, t.off ? 0 : (t.max ?? 10))));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tiers` is drawn from `live`
  }, [live]);

  // ponytail: only comedy shows carry an age in the mock (src/kinds.ts); the API's events carry their own.
  const age = shows[e.id]?.age;
  const oneTap = !hack && !!fests[e.id]?.oneClick && tiers.length === 1;
  const named = guests.map((g) => g.trim()).filter(Boolean);
  const picked = tiers[team]!;
  const lines = hack
    ? fits(team)
      ? [{ name: picked.name, count: 1, pricePaise: picked.pricePaise }]
      : []
    : oneTap
      ? [{ name: `${tiers[0]!.name} for ${named.length + 1}`, count: named.length + 1, pricePaise: tiers[0]!.pricePaise }]
      : tiers.map((t, i) => ({ name: t.name, count: qty[i]!, pricePaise: t.pricePaise })).filter((l) => l.count > 0);
  const count = lines.reduce((n, l) => n + l.count, 0);
  const total = lines.reduce((n, l) => n + l.count * l.pricePaise, 0);
  // A real event's booking is one type: free when that type is (or, nothing picked yet, when every type is).
  const free = live && count > 0 ? total === 0 : tiers.every((t) => t.pricePaise === 0);
  // A real event's paid pick on Review: its order, made once per pick (the same pick again reuses it).
  const at = qty.findIndex((q) => q > 0);
  const orderKey = live && !free && step === 'review' && tiers[at]?.id ? `${tiers[at]!.id}|${qty[at]}` : null;
  const ready = order && order.key === orderKey ? order.o : undefined;
  // A paid event with nothing picked shows ₹0, not Free.
  const price = ready ? formatPrice(ready.amountPaise) : !free && total === 0 ? '₹0' : formatPrice(total);
  const seats = picked.seats ?? 1;
  const note = hack ? `1 team · ${seats} ${seats === 1 ? 'seat' : 'seats'}` : `${count} ${count === 1 ? 'ticket' : 'tickets'}`;
  // Orbit answers in the sheet, at the bottom, scrolled to, and spoken to screen readers (focus stays on the bar).
  const say = (text: string) => {
    setSaid(text);
    AccessibilityInfo.announceForAccessibility(text);
    requestAnimationFrame(() => scroll.current?.scrollToEnd());
  };
  const go = (s: Step) => {
    setSaid(undefined);
    setStep(s);
  };
  const answer = (id: string, v: string) => setAnswers((all) => ({ ...all, [id]: v }));
  // The API's refusal, in its words; seats or the sales window changed since this sheet read the event, so it's read
  // again and the pick shown, where the stepper now matches. Paying off on the server keeps today's line.
  const refused = (r: { status: number; error: { error: string; message: string } }) => {
    if (r.status === 503 && r.error.error === 'paymentsOff') return say(NOT_ON.pay);
    if (r.status === 409) {
      reload?.();
      setStep('pick');
    }
    say(r.error.message);
  };

  useEffect(() => {
    if (!orderKey || !live || order?.key === orderKey) return;
    let on = true;
    void paymentsApi(api)
      .order(live.id, tiers[at]!.id!, qty[at]!)
      .then((r) => {
        if (!on) return;
        if (!r.ok) return refused(r);
        setOrder({ key: orderKey, o: r.data });
        if (r.data.already) say(PAY_SAYS.already); // checkout still opens on it
      });
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `orderKey` says when
  }, [orderKey]);

  if (eventStatus(e, now).kind === 'waitlist') {
    return (
      <Sheet title="Join the waitlist" note={`${e.title} · ${e.when}`} full>
        <ScrollView ref={scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
          <SheetSays text="It’s sold out. Join the waitlist and you’ll hear if tickets free up. Nothing is booked or charged by joining." />
          <FactCard flush>
            <View style={styles.line}>
              <Text style={[styles.grow, styles.name]}>How many</Text>
              <Stepper value={wanted} min={1} max={maxTickets(age)} label="Tickets wanted" onChange={setWanted} />
            </View>
          </FactCard>
          {said && <SheetSays text={said} />}
        </ScrollView>
        <BookBar
          dark
          price="Sold out"
          from={false}
          note={`${wanted} ${wanted === 1 ? 'ticket' : 'tickets'} wanted`}
          action="Join the waitlist"
          onAction={() => say(NOT_ON.waitlist)}
          onHeight={setBar}
        />
      </Sheet>
    );
  }

  // The middle step, when there's one: a hackathon's team, or the host's questions.
  const middle: Step | undefined = hack ? 'team' : asks.length ? 'details' : undefined;
  const middleDone = answered(asks, answers) && (!hack || (teamNameOk(teamName) && rules));
  const steps = [
    { key: 'pick' as Step, label: hack ? 'Team ticket' : free ? 'Register' : 'Tickets', ready: true },
    ...(middle ? [{ key: middle, label: hack ? 'Your team' : 'Details', ready: count > 0 }] : []),
    { key: 'review' as Step, label: 'Review', ready: count > 0 && (!middle || middleDone) },
  ];
  // A real event: the one type picked, booked through the API (signed out, the sign-in sheet first, keeping the pick),
  // then its ticket opens in place of this sheet. A refusal is said in the sheet in the API's words.
  const register = () => {
    const i = qty.findIndex((q) => q > 0);
    const t = tiers[i];
    if (!live || !t?.id || sendingNow.current) return;
    const n = qty[i]!;
    needsAccount(async () => {
      if (sendingNow.current) return;
      sendingNow.current = true;
      setSending(true);
      const r = await ticketsApi(api).book(live.id, t.id!, n);
      sendingNow.current = false;
      setSending(false);
      if (!r.ok) return refused(r);
      ticketsChanged(r.data);
      router.dismiss();
      router.push(`/ticket/${r.data.id}`);
    });
  };
  // A paid pick: Razorpay's checkout on the order, then the API confirms it. Paid opens the ticket; Razorpay still
  // confirming says so and the bar goes to the tickets; no seat left by then means it all went back.
  const checkout = async () => {
    const o = ready;
    if (!o || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    try {
      let paid;
      try {
        paid = await RazorpayCheckout.open({
          key: RAZORPAY_KEY || o.keyId,
          order_id: o.orderId,
          amount: o.amountPaise,
          currency: 'INR',
          name: 'Orbit',
          description: e.title,
          prefill: { name: me?.name ?? undefined, email: me?.email ?? undefined, contact: me?.phone ?? undefined, ...prefillOf(pay) },
          theme: { color: color.accent },
        });
      } catch (err) {
        return say(checkoutCancelled(err, Platform.OS) ? PAY_SAYS.dismissed : PAY_SAYS.failed);
      }
      const v = await paymentsApi(api).verify(o.orderId, paid.razorpay_payment_id, paid.razorpay_signature ?? '');
      if (v.ok && v.data.status === 'paid' && v.data.bookingId) {
        void loadTickets();
        router.dismiss();
        router.push(`/ticket/${v.data.bookingId}`);
        return;
      }
      if (v.ok && (v.data.status === 'refundPending' || v.data.status === 'refunded')) {
        setOrder(undefined);
        reload?.();
        return say(PAY_SAYS.refunded);
      }
      // Confirming, or no answer: the webhook or the poller settles it. A refusal (a bad signature) says its own words.
      if (!v.ok && v.status > 0 && v.status < 500) return say(v.error.message);
      void loadTickets();
      setConfirming(true);
      say(PAY_SAYS.confirming);
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  };
  const finish = live ? (free ? register : () => void checkout()) : () => say(free ? NOT_ON.register : NOT_ON.pay);
  // What the middle step still needs, said by Orbit when Review is tapped too soon (the button stays a button).
  const missing = hack && !teamNameOk(teamName) ? 'Name your team first.' : !answered(asks, answers) ? 'Answer the questions marked Required first.' : hack && !rules ? 'Accept the hackathon’s rules first.' : undefined;
  const you = me?.name ? <Fact label={hack ? 'You, the lead' : 'You'} value={me.name} note={[me.phone ?? me.email, 'from your profile'].filter(Boolean).join(' · ')} /> : null;

  return (
    <Sheet title={hack ? 'Book your team' : free ? 'Register' : 'Tickets'} note={`${e.title} · ${e.when}`} full>
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.list, { paddingBottom: bar }]}>
        <Steps steps={steps} at={step} onPick={go} />

        {step === 'pick' &&
          (hack ? (
            <>
              {/* One booking is one team (Running hackathons: one team per person), so a team ticket is picked. */}
              <FactCard flush>
                {tiers.map((t, i) => (
                  <Pressable
                    key={t.name}
                    onPress={() => setTeam(i)}
                    disabled={!fits(i)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: i === team, disabled: !fits(i) }}
                    style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
                    <View style={styles.grow}>
                      <Text style={styles.name}>{t.name}</Text>
                      <Text style={styles.meta}>
                        {formatPrice(t.pricePaise)} {(t.seats ?? 1) > 1 ? `for ${t.seats} seats` : 'for one seat'}
                      </Text>
                    </View>
                    {t.soldOut ? <Text style={styles.meta}>Sold out</Text> : fits(i) ? <Radio on={i === team} /> : <Text style={styles.meta}>Not enough seats</Text>}
                  </Pressable>
                ))}
              </FactCard>
              <SheetSays text={`One booking is one team, ${hack.team[0]} to ${hack.team[1]} people. You book and pay once for everyone, and each of you gets your own QR.`} />
            </>
          ) : oneTap ? (
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
                  {t.soldOut || t.off ? (
                    <Text style={styles.meta}>{t.off ?? 'Sold out'}</Text>
                  ) : (
                    <Stepper
                      value={qty[i]!}
                      max={t.max ?? ticketMax(tiers, qty, i, { age, left: e.left })}
                      label={`${t.name} tickets`}
                      // A real event's booking is one ticket type (Booking doc): picking one clears the others.
                      onChange={(n) => setQty((q) => q.map((v, j) => (j === i ? n : live && n > 0 ? 0 : v)))}
                    />
                  )}
                </View>
              ))}
            </FactCard>
          ))}
        {step === 'pick' && age && <SheetSays text={`It’s ${age} only, so one ticket each. Bring a photo ID.`} />}
        {step === 'pick' && oneTap && maxGuests(age) > 0 && (
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
                <View style={styles.start}>
                  <Pill label="Add someone" size="small" onPress={() => setGuests((all) => [...all, ''])} />
                </View>
              ) : (
                <Text style={styles.meta}>That’s 10, the most one booking takes.</Text>
              )}
            </FactCard>
            <SheetSays text="Names only. The host and the door see them, and they’re deleted 30 days after." />
          </>
        )}

        {step === 'team' && hack && (
          <>
            <FactCard flush>
              <View style={styles.ask}>
                <Field label="Team name" value={teamName} onChangeText={setTeamName} maxLength={TEAM_NAME} placeholder="Name your team" autoCapitalize="words" />
                <Text style={styles.meta}>Up to 40 letters. No other team in this hackathon can have it.</Text>
              </View>
              {hack.tracks.length > 1 && (
                <View style={styles.ask}>
                  <Text style={styles.label}>Track</Text>
                  <View style={styles.chips}>
                    {hack.tracks.map((t) => (
                      <Chip key={t.name} label={t.name} picked={t.name === track} onPress={() => setTrack(t.name)} />
                    ))}
                  </View>
                  <Text style={styles.meta}>You can change it until the team locks.</Text>
                </View>
              )}
            </FactCard>
            <FactCard flush>
              {you}
              {asks.map((q) => (
                <Ask key={q.id} q={q} value={answers[q.id] ?? ''} onChange={(v) => answer(q.id, v)} />
              ))}
            </FactCard>
            {/* The rules every member accepts (Running hackathons); the event's terms hold them. */}
            <View style={styles.line}>
              <Pressable
                onPress={() => setRules((on) => !on)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rules }}
                style={({ pressed }) => [styles.grow, styles.check, pressed && styles.pressed]}>
                <View style={[styles.box, rules && styles.boxOn]}>{rules && <Icon name="check" size={14} color={color.onAccent} />}</View>
                <Text style={[styles.grow, styles.text]}>I accept the hackathon’s rules</Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/terms/${e.slug}`)} accessibilityRole="link" hitSlop={8}>
                <Text style={[styles.meta, styles.link]}>Read</Text>
              </Pressable>
            </View>
            {seats > 1 && (
              <SheetSays text={`After you pay, you’ll get a link for each of the other ${seats - 1} seats. Your teammates claim theirs, accept the rules and answer the same questions.`} />
            )}
          </>
        )}

        {step === 'details' && (
          <>
            {you && <FactCard flush>{you}</FactCard>}
            <FactCard flush>
              {asks.map((q) => (
                <Ask key={q.id} q={q} value={answers[q.id] ?? ''} onChange={(v) => answer(q.id, v)} />
              ))}
            </FactCard>
          </>
        )}

        {step === 'review' && (
          <FactCard flush>
            {lines.map((l) => (
              <Fact key={l.name} label={`${l.count} × ${formatPrice(l.pricePaise)}`} value={hack && seats > 1 ? `${l.name} · ${seats} seats` : l.name} />
            ))}
            {hack && <Fact label="Team" value={teamName.trim()} note={track && `Track: ${track}`} />}
            {named.length > 0 && <Fact label="With you" value={named.join(', ')} />}
            {asks
              .filter((q) => answers[q.id]?.trim())
              .map((q) => (
                <Fact key={q.id} label={q.q} value={answers[q.id]!.trim()} />
              ))}
            {ready ? (
              <>
                <Fact label="Price" value={formatPrice(ready.breakdown.pricePaise)} />
                <Fact label="Fee" value={ready.breakdown.feeIncluded ? 'Included' : formatPrice(ready.breakdown.feePaise)} />
                <Fact label="Total" value={formatPrice(ready.breakdown.amountPaise)} />
              </>
            ) : (
              <Fact label="Total" value={price} note={free ? undefined : 'Fees, if any, show when you pay'} />
            )}
          </FactCard>
        )}

        {said && <SheetSays text={said} />}
      </ScrollView>
      <BookBar
        dark
        price={price}
        from={false}
        note={note}
        action={confirming ? 'Your tickets' : step === 'review' ? (free ? 'Register' : 'Pay') : step === 'pick' && middle ? 'Continue' : 'Review'}
        onAction={
          confirming
            ? () => {
                router.dismiss();
                router.push('/account/tickets');
              }
            : step === 'review'
            ? sending || (orderKey && !ready)
              ? undefined
              : free || payReady(pay)
                ? finish
                : () => router.push('/pay')
            : step === 'pick'
              ? count > 0
                ? () => go(middle ?? 'review')
                : undefined
              : middleDone
                ? () => go('review')
                : () => missing && say(missing)
        }
        // Paying, the way you pay on the bar's left; a tap opens How to pay (src/app/pay.tsx).
        pay={step === 'review' && !free ? { mark: <PayMark pay={pay} />, label: payLabel(pay), onPress: () => router.push('/pay') } : undefined}
        onHeight={setBar}
      />
    </Sheet>
  );
}

// A picked team ticket's mark: the accent's ring and dot, an element, never text.
function Radio({ on }: { on: boolean }) {
  return <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>;
}

// One of the host's questions: the question, Required or Optional, then a field, or chips for a choice or Yes and No.
function Ask({ q, value, onChange }: { q: Question; value: string; onChange: (v: string) => void }) {
  const options = q.type === 'yesno' ? ['Yes', 'No'] : (q.options ?? []);
  return (
    <View style={styles.ask}>
      <Text style={styles.name}>{q.q}</Text>
      <Text style={styles.label}>{q.required ? 'Required' : 'Optional'}</Text>
      {q.type === 'text' ? (
        <Glass style={styles.field}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="Type your answer"
            placeholderTextColor={color.secondary}
            keyboardAppearance="dark"
            maxLength={500}
            style={styles.fieldText}
            accessibilityLabel={`${q.q}, ${q.required ? 'required' : 'optional'}`}
          />
        </Glass>
      ) : (
        <View style={styles.chips}>
          {options.map((o) => (
            <Chip key={o} label={o} picked={value === o} onPress={() => onChange(value === o ? '' : o)} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.big },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  line: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: space.small },
  name: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  text: { fontFamily: font.text, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
  label: { fontFamily: font.medium, fontSize: 12, color: color.secondary },
  link: { textDecorationLine: 'underline' },
  heading: { fontFamily: font.headline, fontSize: 18, color: color.text },
  input: { height: 36, fontFamily: font.text, fontSize: 15, color: color.text },
  start: { alignItems: 'flex-start' },
  ask: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.small },
  // A field as Account's (Field in account/kit): a 44 frosted pill.
  field: { marginTop: 2, height: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center' },
  fieldText: { height: '100%', fontFamily: font.text, fontSize: 15, color: color.text },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Round, as every control (never squared); Sage once ticked, an element.
  box: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: stoneAt(0.32), alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: color.accent, borderColor: color.accent },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: stoneAt(0.32), alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.accent },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.accent },
});
