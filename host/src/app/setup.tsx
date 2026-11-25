// Venue's sheets (Station take 4), one route for each edit by `what`: a kind (or a new one), a day's hours, how long
// before the start players can cancel, inviting Desk or an Admin, removing someone, withdrawing an invite, and the
// place or desk phone. From the Play and Hosts flow docs:
// - a kind (kindFrom in src/station/venue.ts): name, how many, the price an hour, co-op for two (gaming), one off-peak
//   window inside the opening, games; Orbit sets how it starts and whether it's booked whole. Fewer than are booked is
//   refused, naming the bookings in the way; new prices apply to new bookings only;
// - hours: open or closed for that weekday, opening before closing and at most a day long; today's are refused while
//   bookings fall outside them;
// - invites: Desk starts on Accept and never ends on its own; an Admin starts once you confirm it's them; 14 days.
// Cancelling and refunding a booking by hand is on the web Console (Play: Admins refund a slot by hand). Admins only.
// Each save goes to the API (S5) and the sheet stays up until it answers: a refusal (a 409 naming the bookings in the
// way, a field the contract refuses, no answer) shows here, a success closes it. The API checks bookings in the way
// itself. There's also the first setup (`first`), a kind's Archive, and confirming an accepted Admin.
// ponytail: a station's 4:3 photo waits for uploads.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Text, TextInput, View } from 'react-native';

import { hourWord } from '../station/day';
import { useVenue } from '../station/state';
import { Chip, close, Pill, Round, Sheet, SheetSays, Stepper, styles as ui } from '../station/ui';
import { contactOk, hoursOk, type KindForm, kindFrom, pinFrom } from '../station/venue';
import { variants } from '../../variants';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rupeeText = (paise?: number) => (paise ? String(paise / 100) : '');
const phoneOk = (text: string) => /^\+?[\d\s-]+$/.test(text.trim()) && contactOk(text);

export default function Setup() {
  const p = useLocalSearchParams<{ what: string; type?: string; dow?: string; name?: string; contact?: string; role?: string; key?: string }>();
  const st = useVenue();
  const { role, venue: v, setup: s, now } = st;
  const done = useRef(false);
  const up = useRef(true); // swiped away mid-write: a refusal goes to the Venue tab
  useEffect(() => () => void (up.current = false), []);
  const [busy, setBusy] = useState(false);
  const [arming, setArming] = useState(false); // Archive's first tap; a second within 3 seconds archives
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 3000);
    return () => clearTimeout(t);
  }, [arming]);
  const [why, setWhy] = useState<string>();
  // The person or invite as the sheet opened, so it never turns into the next one while it closes. By seat id.
  const [who] = useState(() => (p.name ? s?.team.find((m) => m.id === p.name) : undefined));
  const [invite] = useState(() => (p.contact ? s?.invites.find((x) => x.id === p.contact) : undefined));
  const t = p.type ? v.types.find((x) => x.id === p.type) : undefined;
  const day = p.dow !== undefined ? s?.week[Number(p.dow)] : null;
  // The form, from what's there now. One state object, so each mode keeps its own fields.
  const [f, setF] = useState(() => ({
    name: t?.name ?? '',
    unit: t?.unit[0] ?? '',
    count: t?.count ?? 1,
    price: rupeeText(t?.price),
    coop: rupeeText(t?.coop),
    op: (t?.offPeak ? (t.offPeak.weekdays ? 'weekdays' : 'every') : 'none') as KindForm['op'],
    opFrom: t?.offPeak?.from ?? v.open[0],
    opTo: t?.offPeak?.to ?? Math.min(v.open[0] + 5, v.open[1], 24),
    opPrice: rupeeText(t?.offPeak?.price),
    games: t?.games ?? '',
    open: day ? 'yes' : 'no',
    from: p.what === 'first' ? 10 : (day?.[0] ?? v.open[0]), // a day that opens at midnight keeps its 0
    to: p.what === 'first' ? 22 : (day?.[1] ?? v.open[1]),
    cutoff: (s?.cutoff ?? 120) / 60,
    role: p.role ?? 'Desk',
    contact: '',
    value: p.key === 'address' ? (s?.address ?? '') : p.key === 'deskPhone' ? (s?.deskPhone ?? '') : '',
    // A first kind says which it is; the first setup and the Place sheet's other fields.
    tile: v.types[0]?.whole ? 'sports' : 'gaming',
    area: s?.area ?? '',
    pin: s?.pin ? `${s.pin.lat}, ${s.pin.lng}` : '',
    phone: '',
  }));
  // A pitch or court is booked whole: a kind keeps what it is; a new one says (starting as the venue's first kind).
  const gaming = t ? !t.whole : f.tile === 'gaming';
  const set = (k: keyof typeof f, val: string | number) => {
    setWhy(undefined);
    setF((x) => ({ ...x, [k]: val }));
  };
  useEffect(() => {
    if (role !== 'admin') close(); // settings are an Admin's
  }, [role]);
  useEffect(() => {
    if (why) AccessibilityInfo.announceForAccessibility(why); // a refusal is heard, not only seen
  }, [why]);
  if (role !== 'admin' || (!s && p.what !== 'first')) return null;

  // One save at a time; the sheet closes once it went in, and says why when it didn't.
  const finish = async (run: () => Promise<string | null>) => {
    if (done.current) return;
    done.current = true;
    setBusy(true);
    const line = await run();
    done.current = false;
    if (!up.current) return void (line && st.tell(line)); // already closed: nothing to close, the tab says it
    setBusy(false);
    if (line) setWhy(line);
    else close();
  };
  const input = (k: 'name' | 'unit' | 'price' | 'coop' | 'opPrice' | 'games' | 'contact' | 'value' | 'area' | 'pin' | 'phone', label: string, placeholder: string, numeric = false) => (
    <View style={ui.field}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        value={String(f[k])}
        onChangeText={(x) => set(k, x)}
        placeholder={placeholder}
        placeholderTextColor={ui.label.color}
        keyboardType={numeric ? 'number-pad' : k === 'contact' ? 'email-address' : k === 'phone' ? 'phone-pad' : 'default'}
        autoCapitalize={k === 'contact' || k === 'pin' ? 'none' : 'sentences'}
        autoCorrect={false}
        accessibilityLabel={label}
        style={ui.input}
      />
    </View>
  );
  const chips = (k: 'op' | 'open' | 'cutoff' | 'role' | 'tile', opts: [string | number, string][]) => (
    <View style={ui.chips}>
      {opts.map(([val, label]) => (
        <Chip key={String(val)} label={label} on={f[k] === val} onPress={() => set(k, val)} />
      ))}
    </View>
  );
  // An hour with − and +, between `min` and `max` (past 24 is the next morning).
  const hour = (k: 'opFrom' | 'opTo' | 'from' | 'to', label: string, min: number, max: number) => (
    <View style={ui.frow}>
      <Text style={ui.label}>{label}</Text>
      <View style={ui.stepper}>
        <Round glyph="−" label={`${label} earlier`} disabled={f[k] <= min} onPress={() => set(k, f[k] - 1)} />
        <Text style={[ui.count, { minWidth: 72 }]}>{hourWord(f[k])}</Text>
        <Round glyph="+" label={`${label} later`} disabled={f[k] >= max} onPress={() => set(k, f[k] + 1)} />
      </View>
    </View>
  );

  if (p.what === 'kind') {
    if (p.type && !t) return null; // a kind that's gone
    const offTo = Math.min(v.open[1], 24);
    return (
      <Sheet title={t ? t.name : 'Add a kind'} note={gaming ? 'Starts every 30 minutes, each one on its own · Orbit sets these' : 'Booked whole, starting on the hour · Orbit sets these'}>
        {!t &&
          chips('tile', [
            ['gaming', 'Gaming'],
            ['sports', 'Sports'],
          ])}
        {input('name', 'Name', gaming ? 'Gaming PC' : '5-a-side football')}
        {!t && input('unit', 'What one is called', gaming ? 'PC' : 'pitch')}
        <View style={ui.frow}>
          <Text style={ui.label}>How many</Text>
          <Stepper n={f.count} min={1} max={200} onChange={(n) => set('count', n)} label={t?.unit[1] ?? 'of them'} />
        </View>
        {input('price', 'Price an hour, ₹', '162', true)}
        {gaming && input('coop', 'Co-op price an hour for two, ₹ (optional)', 'None', true)}
        <View style={ui.field}>
          <Text style={ui.label}>Off-peak price</Text>
          {chips('op', [
            ['none', 'None'],
            ['weekdays', 'Weekdays'],
            ['every', 'Every day'],
          ])}
        </View>
        {f.op !== 'none' && (
          <>
            {hour('opFrom', 'From', v.open[0], f.opTo - 1)}
            {hour('opTo', 'To', f.opFrom + 1, offTo)}
            {input('opPrice', 'Off-peak price an hour, ₹', '120', true)}
          </>
        )}
        {gaming && input('games', 'Games, as people should read them', 'Valorant, CS2')}
        <View style={ui.frow}>
          <Text style={ui.label}>Photo, 4:3</Text>
          <Text style={ui.label}>Comes with photo uploads</Text>
        </View>
        {why && <SheetSays text={why} />}
        <SheetSays text="New prices apply to new bookings only; booked hours keep what was paid." />
        <Pill
          wide
          label={t ? 'Save' : 'Add'}
          disabled={busy}
          onPress={() => {
            const made = kindFrom(f, t, v.open, gaming, `k${Date.now()}`);
            if ('why' in made) return setWhy(made.why);
            void finish(() => st.saveKind(made.kind, gaming ? 'gaming' : 'sports'));
          }}
        />
        {t && (
          <Pill
            wide
            label={arming ? 'Archive? Tap again' : `Archive ${t.name}`}
            disabled={busy}
            onPress={() => (arming ? void finish(() => st.archiveKind(t.id)) : setArming(true))}
          />
        )}
      </Sheet>
    );
  }

  if (p.what === 'day' && p.dow !== undefined) {
    const dow = Number(p.dow);
    const today = new Date(now + 330 * 60_000).getUTCDay(); // today's India calendar day
    return (
      <Sheet title={DAY_NAMES[dow]} note={dow === today ? 'Today' : 'Every week'}>
        {chips('open', [
          ['yes', 'Open'],
          ['no', 'Closed'],
        ])}
        {f.open === 'yes' && (
          <>
            {hour('from', 'Opens', 0, Math.min(f.to - 1, 23))}
            {hour('to', 'Closes', f.from + 1, Math.min(f.from + 24, 30))}
          </>
        )}
        {why && <SheetSays text={why} />}
        <Pill
          wide
          label="Save"
          disabled={busy}
          onPress={() => {
            const open: [number, number] | null = f.open === 'yes' ? [f.from, f.to] : null;
            if (open && !hoursOk(open)) return setWhy('It opens before it closes, for a day at most, closing by 6 AM.');
            void finish(() => st.changeSetup((x) => ({ ...x, week: x.week.map((w, i) => (i === dow ? open : w)) })));
          }}
        />
      </Sheet>
    );
  }

  if (p.what === 'cutoff') {
    return (
      <Sheet title="Players can cancel" note="Their price back, the buyer fee kept">
        {chips('cutoff', [
          [1, '1 hour before'],
          [2, '2 hours'],
          [4, '4 hours'],
          [12, '12 hours'],
          [24, 'A day'],
        ])}
        <SheetSays text="After that the ticket says it starts too soon to cancel; you can still refund by hand from the booking on the web Console." />
        {why && <SheetSays text={why} />}
        <Pill wide label="Save" disabled={busy} onPress={() => void finish(() => st.changeSetup((x) => ({ ...x, cutoff: Math.round(Number(f.cutoff) * 60) })))} />
      </Sheet>
    );
  }

  if (p.what === 'add') {
    const desk = f.role === 'Desk';
    return (
      <Sheet title={desk ? 'Add Desk' : 'Add an Admin'} note={`To ${v.name}`}>
        {chips('role', [
          ['Desk', 'Desk'],
          ['Admin', 'Admin'],
        ])}
        {input('contact', 'Phone or email', '+91 90000 22010')}
        {why && <SheetSays text={why} />}
        <SheetSays
          text={
            desk
              ? `They start when they accept, in ${variants.station.name}: walk-ins, blocks and no-shows, with names, stations and hours. Never money, prices or settings. Desk never ends on its own; remove them here.`
              : 'They start once you confirm it’s them after they accept. Admins see everything.'
          }
        />
        <Pill
          wide
          label="Send invite"
          disabled={busy}
          onPress={() => {
            const contact = f.contact.trim();
            if (!contactOk(contact)) return setWhy('A phone number or an email, please.');
            const key = contact.replace(/[\s-]/g, '').toLowerCase();
            if (s!.invites.some((x) => x.contact.replace(/[\s-]/g, '').toLowerCase() === key)) return setWhy('They’re invited already.');
            void finish(() => st.invite(contact, desk ? 'Desk' : 'Admin'));
          }}
        />
      </Sheet>
    );
  }

  if (p.what === 'member') {
    if (!who || who.you || who.owner) return null;
    return (
      <Sheet title={who.name} note={who.role}>
        <SheetSays text={`Removing ${who.name} ends their ${who.role === 'Desk' ? 'counter' : 'Admin'} role at once.`} />
        {why && <SheetSays text={why} />}
        <Pill wide label={`Remove ${who.name}`} disabled={busy} onPress={() => void finish(() => st.endSeat(who.id))} />
      </Sheet>
    );
  }

  if (p.what === 'invite') {
    if (!invite) return null;
    return (
      <Sheet title={invite.contact} note={invite.role ? `Invited as ${invite.role}` : invite.accepted ? `Accepted by ${invite.acceptedBy ?? 'them'}` : 'Invited'}>
        <SheetSays
          text={
            !invite.accepted
              ? 'It ends by itself after 14 days if they don’t accept.'
              : invite.byYou
                ? 'Their Admin role starts once you confirm it’s them.'
                : `${invite.adder ?? 'The Admin who added them'} confirms it.` // only the adder can (confirmSeatRule)
          }
        />
        {why && <SheetSays text={why} />}
        {invite.accepted && invite.byYou && <Pill wide label="Confirm it’s them" disabled={busy} onPress={() => void finish(() => st.confirmSeat(invite.id))} />}
        <Pill wide label="Withdraw invite" disabled={busy} onPress={() => void finish(() => st.endSeat(invite.id))} />
      </Sheet>
    );
  }

  if (p.what === 'field' && (p.key === 'address' || p.key === 'deskPhone')) {
    const key = p.key;
    return (
      <Sheet title={key === 'address' ? 'Place' : 'Desk phone'} note={key === 'address' ? 'Where people come to play' : 'For players who call the counter'}>
        {input('value', key === 'address' ? 'Address' : 'Phone', '')}
        {key === 'address' && (
          <>
            {input('area', 'Area', 'Gachibowli')}
            {input('pin', 'Map pin', '17.4401, 78.3489')}
          </>
        )}
        {key === 'address' && (
          <SheetSays
            text="For the map pin, press and hold your entrance in Google Maps and paste the numbers it shows. Events whose Where matches can ask to be at your venue."
          />
        )}
        {why && <SheetSays text={why} />}
        <Pill
          wide
          label="Save"
          disabled={busy}
          onPress={() => {
            if (!f.value.trim()) return setWhy(key === 'address' ? 'Where is it?' : 'A phone number, please.');
            if (key === 'deskPhone' && !phoneOk(f.value)) return setWhy('A phone number, please.');
            if (key === 'address') {
              const pin = pinFrom(f.pin);
              if (!f.area.trim()) return setWhy('Which area is it in?');
              if (!pin) return setWhy('Paste the map pin from Google Maps, like 17.4401, 78.3489.');
              return void finish(() => st.changeSetup((x) => ({ ...x, address: f.value.trim(), area: f.area.trim(), pin: { ...pin, placeId: x.pin?.placeId ?? null } })));
            }
            void finish(() => st.changeSetup((x) => ({ ...x, [key]: f.value.trim() })));
          }}
        />
      </Sheet>
    );
  }
  if (p.what === 'first' && !s) {
    // Signed in, a venue with no setup yet: where it is, the desk phone, and one opening for every day (each day can be
    // changed after). Cancelling up to 2 hours before and no walk-in count, as the API starts them.
    return (
      <Sheet title="Set up the venue" note={v.name}>
        {input('value', 'Address', 'Above Inorbit Mall entrance, Gachibowli, Hyderabad')}
        {input('area', 'Area', 'Gachibowli')}
        {input('pin', 'Map pin', '17.4401, 78.3489')}
        <SheetSays text="For the map pin, press and hold your entrance in Google Maps and paste the numbers it shows." />
        {input('phone', 'Desk phone', '+91 90000 11001')}
        {hour('from', 'Opens every day', 0, Math.min(f.to - 1, 23))}
        {hour('to', 'Closes', f.from + 1, Math.min(f.from + 24, 30))}
        {why && <SheetSays text={why} />}
        <Pill
          wide
          label="Save"
          disabled={busy}
          onPress={() => {
            const pin = pinFrom(f.pin);
            if (!f.value.trim()) return setWhy('Where is it?');
            if (!f.area.trim()) return setWhy('Which area is it in?');
            if (!pin) return setWhy('Paste the map pin from Google Maps, like 17.4401, 78.3489.');
            if (!phoneOk(f.phone)) return setWhy('A desk phone number, please.');
            const open: [number, number] = [f.from, f.to];
            if (!hoursOk(open)) return setWhy('It opens before it closes, for a day at most, closing by 6 AM.');
            void finish(() =>
              st.firstSetup({ address: f.value.trim(), area: f.area.trim(), ...pin, placeId: null, deskPhone: f.phone.trim(), week: Array.from({ length: 7 }, () => open), cutoffMinutes: 120, logsWalkIns: false }),
            );
          }}
        />
      </Sheet>
    );
  }
  return null;
}
