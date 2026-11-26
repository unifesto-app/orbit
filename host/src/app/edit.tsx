// An event's editor in Event Partner (X1), from New event (no `id`: name it, and the draft is made) and a draft's
// Continue or a published card's Edit event (`?id=`): title, category, when and how long, where (typed by hand), about,
// the poster's state, the ticket types (free, or whole rupees), the host's fee pick, then Publish (its 409 listed as
// fixes) and, once published, Cancel with the reason ticket holders get. The form parts are the Event Request's
// (app/request.tsx); the rules and words in src/launch/editor.ts.
// ponytail: no poster or 4:3 upload here: host/ has no image picker, and adding one is a native module (a rebuild).
// Until then a draft can't publish from the phone (its poster is the first fix listed).
import { categories, FEE_PLANS, type FeePlan, type HostPage, type TeamEvent, type TicketType } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color, space } from '@orbit/mobile/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { bodyOf, fixesOf, type Form, formOf, LASTS, paiseOf, placeHalf, priceLabel, saveable } from '../launch/editor';
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
  const host = useHost();
  const load = useLoad<TeamEvent>(`event|${id}`, () => api.authed<TeamEvent>('GET', `/events/${id}`));
  const tickets = useLoad<TicketType[]>(`tickets|${id}`, () => api.authed<TicketType[]>('GET', `/events/${id}/tickets`));
  const page = useLoad<HostPage>(host && `host|${host.id}`, () => api.authed<HostPage>('GET', `/hosts/${host!.id}`));
  const [form, setForm] = useState<Form | null>(null); // what's typed; null until the first change
  const [sheet, setSheet] = useState<'when' | 'city' | null>(null);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<string[]>([]); // the last answer: a refusal, or publish's fixes
  const [reason, setReason] = useState('');
  const e = load.data;
  if (!e) return <Frame step={null} onBack={back}>{load.error && <Note>{load.error.message}</Note>}</Frame>;
  const f = form ?? formOf(e);
  const put = (p: Partial<Form>) => setForm({ ...f, ...p });
  const draft = e.status === 'draft';
  const locked = e.status === 'cancelled';

  // Saves what's typed (when anything is), then runs `then`.
  const go = async (then?: () => Promise<void>) => {
    setBusy(true);
    setSay([]);
    if (form) {
      const r = await api.authed<TeamEvent>('PATCH', `/events/${id}`, bodyOf(form));
      if (!r.ok) {
        setBusy(false);
        return setSay([r.error.message]);
      }
      setForm(null);
    }
    await then?.();
    load.reload();
    setBusy(false);
  };
  const publish = () =>
    go(async () => {
      const r = await api.authed<TeamEvent>('POST', `/events/${id}/publish`);
      if (r.ok) return setSay(['Published. It’s on Orbit now.']);
      const missing = (r.error as { missing?: string[] }).missing;
      setSay(missing ? ['Before it can go out:', ...fixesOf(missing)] : [r.error.message]);
    });
  const cancel = () =>
    Alert.alert('Cancel this event?', 'Every ticket holder gets your reason. This can’t be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel event',
        style: 'destructive',
        onPress: () =>
          void go(async () => {
            const r = await api.authed<TeamEvent>('POST', `/events/${id}/cancel`, { reason: reason.trim() });
            setSay([r.ok ? 'Cancelled. Ticket holders are being told.' : r.error.message]);
          }),
      },
    ]);
  const fee = async (feePlan: FeePlan) => {
    const r = await api.authed<HostPage>('PATCH', `/hosts/${host!.id}`, { feePlan });
    if (!r.ok) return setSay([r.error.message]);
    page.reload();
  };

  return (
    <Frame
      step={null}
      onBack={back}
      foot={
        !locked && (
          <>
            {say.length > 0 && <Note live>{say.join('\n')}</Note>}
            <Wide label={busy ? 'Saving…' : 'Save'} onPress={() => void go()} disabled={busy || !form || !saveable(f)} muted={!draft} />
            {draft && <Wide label="Publish" onPress={() => void publish()} disabled={busy || (!!form && !saveable(f))} />}
          </>
        )
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
              {LASTS.map((h) => (
                <Chip key={h} label={`${h} hr`} on={f.hours === h} onPress={() => put({ hours: h })} />
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
              <Chip key={k} label={FEE_PLANS[k]} on={page.data!.feePlan === k} onPress={() => void fee(k)} />
            ))}
          </View>
          <Note>For every event this host runs. Free tickets pay nothing.</Note>
        </>
      )}

      {e.status === 'published' && (
        <>
          <Section title="Cancel event" />
          <View style={s.fields}>
            <Field label="Reason, sent to every ticket holder" value={reason} onChangeText={setReason} placeholder="The venue closed for repairs" maxLength={500} />
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
function Tickets({ id, list, published, locked, onChange }: { id: string; list: TicketType[]; published: boolean; locked: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null); // the ticket type the form changes; null adds one
  const [name, setName] = useState('');
  const [rupees, setRupees] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paise = paiseOf(rupees);
  const pick = (t: TicketType | null) => {
    setEditing(t?.id ?? null);
    setName(t?.name ?? '');
    setRupees(t && t.pricePaise ? String(t.pricePaise / 100) : '');
    setError(null);
  };
  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), pricePaise: paise };
    const r = editing ? await api.authed('PATCH', `/events/${id}/tickets/${editing}`, body) : await api.authed('POST', `/events/${id}/tickets`, body);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    pick(null);
    onChange();
  };
  const remove = async (t: TicketType) => {
    const r = await api.authed('DELETE', `/events/${id}/tickets/${t.id}`);
    if (!r.ok) return setError(r.error.message);
    if (editing === t.id) pick(null);
    onChange();
  };
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
                    <Pill label="Edit" onPress={() => pick(t)} />
                    <Pill label="Remove" onPress={() => void remove(t)} />
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
          <Field label="Price in rupees · blank for free" value={rupees} onChangeText={setRupees} placeholder="Free" keyboardType="number-pad" maxLength={9} />
          {paise === null && <Text style={s.line}>A price is whole rupees, up to 10,00,000.</Text>}
          <View style={styles.buttons}>
            <Pill label={busy ? 'Saving…' : editing ? 'Save ticket' : 'Add ticket'} onPress={busy || !name.trim() || paise === null ? undefined : () => void save()} />
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
