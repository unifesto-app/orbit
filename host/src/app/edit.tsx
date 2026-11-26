// An event's editor in Event Partner (X1), from New event (no `id`: name it, and the draft is made) and a draft's
// Continue or a published card's Edit event (`?id=`): title, category, when and how long, where (typed by hand), about,
// the poster's state, the ticket types (free, or whole rupees), the host's fee pick, then Publish (its 409 listed as
// fixes) and, once published, Cancel with a reason. Saves send only what changed (src/launch/editor.ts), and the
// screen shows the API’s answer, so nothing typed since snaps back. The form parts are the Event Request’s (app/request.tsx).
// ponytail: cancelling cancels the bookings but tells no one yet (eventCancelled is H13.5); the copy says so.
// ponytail: no poster or 4:3 upload here: host/ has no image picker, and adding one is a native module (a rebuild).
// Until then a draft can't publish from the phone (its poster is the first fix listed).
import { categories, FEE_PLANS, type FeePlan, type HostPage, type TeamEvent, type TicketType } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color, space } from '@orbit/mobile/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { bodyOf, fixesOf, type Form, formOf, LASTS, lastsLabel, paiseOf, placeHalf, priceLabel, saveable } from '../launch/editor';
import { useHost } from '../launch/host';
import { whenLabel } from '../launch/request';
import { Card, Field, Note, Pill, Row, Section, Wide } from '../launch/ui';
import { api } from '../session';
import { Chip, CitySheet, Frame, Label, Opens, s, WhenSheet } from './request';

const MAX_TICKETS = 20; // the API's cap
const back = () => (router.canGoBack() ? router.back() : router.replace('/events'));

export default function Edit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return id ? <Editor key={id} id={id} /> : <Create />;
}

// New event: a draft starts from its name.
function Create() {
  const host = useHost();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true);
    const r = await api.authed<TeamEvent>('POST', `/hosts/${host!.id}/events`, { title: title.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    router.setParams({ id: r.data.id });
  };
  return (
    <Frame step={null} onBack={back} foot={<Wide label={busy ? 'Making…' : 'Make the draft'} onPress={make} disabled={busy || !host || !title.trim()} />}>
      <Text style={s.title} accessibilityRole="header">
        New event
      </Text>
      <Text style={s.line}>Name it first. Everything else can come later.</Text>
      <View style={s.fields}>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Open Mic Friday" autoCapitalize="words" maxLength={120} autoFocus />
      </View>
      {error && <Note live>{error}</Note>}
    </Frame>
  );
}

function Editor({ id }: { id: string }) {
  const load = useLoad<TeamEvent>(`event|${id}`, () => api.authed<TeamEvent>('GET', `/events/${id}`));
  const [answer, setAnswer] = useState<TeamEvent | null>(null); // the API's latest answer (save, publish, cancel), over the load
  const e = answer ?? load.data;
  const hostId = e?.hostId;
  const tickets = useLoad<TicketType[]>(`tickets|${id}`, () => api.authed<TicketType[]>('GET', `/events/${id}/tickets`));
  const page = useLoad<HostPage>(hostId ? `host|${hostId}` : null, () => api.authed<HostPage>('GET', `/hosts/${hostId}`));
  const [form, setForm] = useState<Form | null>(null); // what's typed; null while nothing is
  const [sheet, setSheet] = useState<'when' | 'city' | null>(null);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string[]>([]); // the last answer: a refusal, or publish's fixes
  const [reason, setReason] = useState('');
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeSay, setFeeSay] = useState<string | null>(null);
  if (!e) return <Frame step={null} onBack={back}>{load.error && <Note>{load.error.message}</Note>}</Frame>;
  const was = formOf(e);
  const f = form ?? was;
  const put = (p: Partial<Form>) => setForm({ ...f, ...p });
  const draft = e.status === 'draft';
  const locked = e.status === 'cancelled';
  const ended = !!e.endsAt && Date.parse(e.endsAt) <= Date.now();

  // Sends what changed, if anything; false on a refusal. What's typed while it's out stays.
  const save = async () => {
    if (!form) return true;
    const sent = form;
    const r = await api.authed<TeamEvent>('PATCH', `/events/${id}`, bodyOf(sent, was));
    if (!r.ok) {
      setSay([r.error.message]);
      return false;
    }
    setAnswer(r.data);
    setForm((cur) => (cur === sent ? null : cur));
    return true;
  };
  const run = async (step: () => Promise<unknown>) => {
    setBusy(true);
    setSay([]);
    await step();
    setBusy(false);
  };
  const publish = () =>
    run(async () => {
      if (!(await save())) return;
      const r = await api.authed<TeamEvent>('POST', `/events/${id}/publish`);
      if (r.ok) {
        setAnswer(r.data);
        return setSay(['Published. It’s on Orbit now.']);
      }
      const missing = (r.error as { missing?: string[] }).missing;
      setSay(missing ? ['Before it can go out:', ...fixesOf(missing)] : [r.error.message]);
    });
  // Cancel goes as it is: unsaved edits aren't sent first.
  const cancel = () =>
    Alert.alert('Cancel this event?', 'Its bookings are cancelled. Orbit doesn’t tell ticket holders yet, so tell them yourself. This can’t be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel event',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            const r = await api.authed<TeamEvent>('POST', `/events/${id}/cancel`, { reason: reason.trim() });
            if (!r.ok) return setSay([r.error.message]);
            setAnswer(r.data);
            setForm(null);
            setSay(['Cancelled, with its bookings. Tell your ticket holders yourself for now.']);
          }),
      },
    ]);
  const fee = (feePlan: FeePlan) => {
    if (feeBusy || feePlan === page.data?.feePlan) return;
    Alert.alert('Change Orbit’s fee?', `${FEE_PLANS[feePlan]}, on paid tickets for every event this host runs.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Change',
        onPress: async () => {
          setFeeBusy(true);
          const r = await api.authed<HostPage>('PATCH', `/hosts/${e.hostId}`, { feePlan });
          setFeeBusy(false);
          setFeeSay(r.ok ? null : r.error.message);
          if (r.ok) page.reload();
        },
      },
    ]);
  };

  return (
    <Frame
      step={null}
      onBack={back}
      foot={
        <>
          {say.length > 0 && <Note live>{say.join('\n')}</Note>}
          {!locked && <Wide label={busy ? 'Saving…' : 'Save'} onPress={() => void run(save)} disabled={busy || !saveable(f, was)} muted={!draft} />}
          {draft && <Wide label="Publish" onPress={() => void publish()} disabled={busy || (!!form && !saveable(f, was))} />}
        </>
      }
    >
      <Text style={s.title} accessibilityRole="header">
        {e.title}
      </Text>
      <Text style={s.line}>{draft ? 'Draft' : locked ? `Cancelled: ${e.cancelReason ?? ''}` : 'Published'}</Text>

      {!locked && (
        <View style={s.fields}>
          <Field label="Title" value={f.title} onChangeText={(title) => put({ title })} autoCapitalize="words" maxLength={120} />
          <Label text="Category">
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Category">
              {categories.map((c) => (
                <Chip key={c.slug} label={c.label} on={f.category === c.slug} onPress={() => put({ category: c.slug })} />
              ))}
            </View>
          </Label>
          <Label text="When">
            <Opens label="When" value={f.startsAt && whenLabel(f.startsAt)} placeholder="Pick a day and time" onPress={() => setSheet('when')} />
          </Label>
          <Label text="Lasts">
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Lasts">
              {(f.minutes && !LASTS.includes(f.minutes) ? [f.minutes, ...LASTS] : LASTS).map((m) => (
                <Chip key={m} label={lastsLabel(m)} on={f.minutes === m} onPress={() => put({ minutes: m })} />
              ))}
            </View>
          </Label>
          <Field label="Venue" value={f.venue} onChangeText={(venue) => put({ venue })} placeholder="The Comedy Room" maxLength={120} />
          <Field label="Address" value={f.address} onChangeText={(address) => put({ address })} placeholder="Road 36, Jubilee Hills" maxLength={300} />
          <Field label="Area" value={f.area} onChangeText={(area) => put({ area })} placeholder="Jubilee Hills" maxLength={80} />
          <Label text="City">
            <Opens label="City" value={f.city} placeholder="Pick the city" onPress={() => setSheet('city')} />
          </Label>
          {placeHalf(f) && <Text style={s.line}>Add the venue, address, area and city, or leave all of them blank.</Text>}
          <Label text="About" optional>
            <Glass style={s.area}>
              <TextInput
                accessibilityLabel="About"
                value={f.about}
                onChangeText={(about) => put({ about })}
                placeholder="What happens, who it's for"
                placeholderTextColor={color.secondary}
                selectionColor={color.accent}
                style={s.areaText}
                multiline
                maxLength={5000}
              />
            </Glass>
          </Label>
        </View>
      )}

      <Section title="Poster" />
      <Card>
        <Row label="3:4 poster" value={e.poster ? 'Added' : 'Not yet'} strong={!!e.poster} />
        <Row label="4:3 wide · optional" value={e.wide ? 'Added' : 'Not yet'} strong={!!e.wide} />
      </Card>
      <Note>Uploads come with a later app update.</Note>

      <Section title="Tickets" />
      <Tickets id={id} list={tickets.data ?? []} published={e.status === 'published'} locked={locked} onChange={tickets.reload} />
      {tickets.error && <Note>{tickets.error.message}</Note>}

      {page.data && (
        <>
          <Section title="Orbit’s fee on paid tickets" />
          <View style={[s.chips, styles.margin]} accessibilityRole="radiogroup" accessibilityLabel="Orbit’s fee">
            {(Object.keys(FEE_PLANS) as FeePlan[]).map((k) => (
              <Chip key={k} label={FEE_PLANS[k]} on={page.data!.feePlan === k} onPress={() => fee(k)} />
            ))}
          </View>
          <Note live={!!feeSay}>{feeSay ?? (feeBusy ? 'Saving…' : 'For every event this host runs. Free tickets pay nothing.')}</Note>
        </>
      )}

      {e.status === 'published' && !ended && (
        <>
          <Section title="Cancel event" />
          <View style={s.fields}>
            <Field label="Reason, kept on the event" value={reason} onChangeText={setReason} placeholder="The venue closed for repairs" maxLength={500} />
            <Wide label="Cancel event" onPress={cancel} disabled={busy || !reason.trim()} muted />
          </View>
        </>
      )}

      {sheet === 'when' && (
        <WhenSheet
          startsAt={f.startsAt}
          onDone={(startsAt) => {
            put({ startsAt });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'city' && (
        <CitySheet
          chosen={f.city}
          onPick={(city) => {
            put({ city });
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </Frame>
  );
}

// The ticket types: each with its price and Edit or Remove, and one form that adds a new one or changes the one picked.
// The API holds the rules (20 at most, a booked ticket's price, a published event's last one) and says them in words.
// An edit sends the price only when it's retyped, so a renamed ticket keeps a price the rupee box can't hold (₹49.50).
function Tickets({ id, list, published, locked, onChange }: { id: string; list: TicketType[]; published: boolean; locked: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null); // the ticket type the form changes; null adds one
  const [name, setName] = useState('');
  const [rupees, setRupees] = useState('');
  const [start, setStart] = useState(''); // the price as the edit began
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepPrice = !!editing && rupees === start;
  const paise = paiseOf(rupees);
  const pick = (t: TicketType | null) => {
    const was = t && t.pricePaise ? (t.pricePaise % 100 ? (t.pricePaise / 100).toFixed(2) : String(t.pricePaise / 100)) : '';
    setEditing(t?.id ?? null);
    setName(t?.name ?? '');
    setRupees(was);
    setStart(was);
    setError(null);
  };
  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), ...(keepPrice ? {} : { pricePaise: paise }) };
    const r = editing ? await api.authed('PATCH', `/events/${id}/tickets/${editing}`, body) : await api.authed('POST', `/events/${id}/tickets`, body);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    pick(null);
    onChange();
  };
  const remove = (t: TicketType) =>
    Alert.alert(`Remove ${t.name}?`, undefined, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const r = await api.authed('DELETE', `/events/${id}/tickets/${t.id}`);
          setBusy(false);
          if (!r.ok) return setError(r.error.message);
          if (editing === t.id) pick(null);
          onChange();
        },
      },
    ]);
  const full = !editing && list.length >= MAX_TICKETS;
  return (
    <>
      {list.length > 0 && (
        <Card>
          {list.map((t) => (
            <Row
              key={t.id}
              label={t.name}
              value={priceLabel(t.pricePaise)}
              strong
              right={
                !locked && (
                  <>
                    <Pill label="Edit" onPress={busy ? undefined : () => pick(t)} />
                    <Pill label="Remove" onPress={busy ? undefined : () => remove(t)} />
                  </>
                )
              }
            />
          ))}
        </Card>
      )}
      {list.length === 0 && <Note>{published ? 'No ticket types.' : 'No ticket types yet. Publishing needs one.'}</Note>}
      {!locked && !full && (
        <View style={s.fields}>
          <Field label={editing ? 'Ticket name' : 'New ticket name'} value={name} onChangeText={setName} placeholder="General" maxLength={60} />
          <Field label="Price in rupees · blank for free" value={rupees} onChangeText={setRupees} placeholder="Free" keyboardType="number-pad" maxLength={10} />
          {!keepPrice && paise === null && <Text style={s.line}>A price is whole rupees, up to 10,00,000.</Text>}
          <View style={styles.buttons}>
            <Pill label={busy ? 'Saving…' : editing ? 'Save ticket' : 'Add ticket'} onPress={busy || !name.trim() || (!keepPrice && paise === null) ? undefined : () => void save()} />
            {editing && <Pill label="Stop editing" onPress={() => pick(null)} />}
          </View>
        </View>
      )}
      {full && <Note>{`That’s ${MAX_TICKETS} ticket types, the most an event can have.`}</Note>}
      {error && <Note live>{error}</Note>}
    </>
  );
}

const styles = {
  margin: { marginHorizontal: 20 },
  buttons: { flexDirection: 'row', gap: space.small },
} as const;
