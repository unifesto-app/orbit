// An event's editor in Event Partner (X1), from New event (no `id`: name it, and the draft is made) and a draft's
// Continue or a published card's Edit event (`?id=`): title, category, when and how long, where (typed by hand), about,
// the poster's state, the ticket types (free, or whole rupees), the host's fee pick, then Publish (its 409 listed as
// fixes) and, once published, Cancel with a reason. Saves send only what changed (src/launch/editor.ts), and the
// screen shows the API’s answer, so nothing typed since snaps back. The form parts are the Event Request’s (app/request.tsx).
// ponytail: cancelling cancels the bookings but tells no one yet (eventCancelled is H13.5); the copy says so.
// The 3:4 poster (publishing needs it) and the optional 4:3 are picked from the library, cropped there, and sent to
// PUT /events/:id/poster and /wide, which refuse a wrong shape in words; the event is read again after, so Publish's fixes
// clear. A new event gets them once its draft is made, as it has no id before.
// Details · optional are the picked category's own fields (src/launch/editor.ts), plus the age line for any; With · optional
// lists the other hosts on the event (src/launch/acts.ts), sent whole by Save acts and locked once it starts.
import { categories, type EventCard, FEE_PLANS, type FeePlan, FEST_TYPES, type HostCard, type HostPage, MAX_EVENT_ACTS, PHOTO_MAX_BYTES, type TeamAct, type TeamEvent, type TicketType } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color, radius, space } from '@orbit/mobile/theme';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, Switch, Text, TextInput, View } from 'react-native';

import { actName, actsBody, actsChanged, addAct, moveAct, pickable, removeAct } from '../launch/acts';
import { bodyOf, centreCrop, detailsProblem, fixesOf, type Form, formOf, LASTS, lastsLabel, paiseOf, placeHalf, priceLabel, saveable } from '../launch/editor';
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
  // Only the image links from a picture's re-read: a slower GET mustn't undo a save or the other picture's upload.
  const pictures = (f: TeamEvent) => setAnswer((a) => ({ ...(a ?? load.data!), poster: f.poster, wide: f.wide }));
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
  const started = !!e.startsAt && Date.parse(e.startsAt) <= Date.now();
  const problem = detailsProblem(f);

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
      {!locked && (
        <>
          <Section title="Details · optional" />
          <Details f={f} put={put} started={started && !draft} />
          {problem && <Note live>{problem}</Note>}
        </>
      )}

      <Section title="Poster" />
      <Picture id={id} shape="poster" link={e.poster} locked={locked} onDone={pictures} />
      <Section title="Wide image · optional" />
      <Picture id={id} shape="wide" link={e.wide} locked={locked} onDone={pictures} />

      <Section title="Tickets" />
      <Tickets id={id} list={tickets.data ?? []} published={e.status === 'published'} locked={locked} onChange={tickets.reload} />
      {tickets.error && <Note>{tickets.error.message}</Note>}

      <Section title="With · optional" />
      <Acts id={id} ownHostId={e.hostId} readOnly={locked || started} />

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

// The picked category's own details, then the age line any event can have. Lists are typed one row per line, "A | B".
function Details({ f, put, started }: { f: Form; put: (p: Partial<Form>) => void; started: boolean }) {
  return (
    <View style={s.fields}>
      {f.category === 'comedy' && (
        <>
          <Field label="Language" value={f.language} onChangeText={(language) => put({ language })} placeholder="Hindi and English" maxLength={60} />
          <Field label="Seating" value={f.seating} onChangeText={(seating) => put({ seating })} placeholder="Floor cushions up front, chairs behind" maxLength={120} />
        </>
      )}
      {f.category === 'jams' && (
        <>
          <Field label="Playing" value={f.style} onChangeText={(style) => put({ style })} placeholder="Acoustic, Bollywood and indie" maxLength={120} />
          <Field label="Bring" value={f.bring} onChangeText={(bring) => put({ bring })} placeholder="Your own instrument" maxLength={120} />
          <Field label="There already" value={f.onSite} onChangeText={(onSite) => put({ onSite })} placeholder="A cajon, two guitars and a mic" maxLength={120} />
        </>
      )}
      {f.category === 'hackathons' && (
        <>
          <View style={styles.buttons}>
            <View style={styles.grow}>
              <Field label="Smallest team" value={f.teamMin} onChangeText={(teamMin) => put({ teamMin })} placeholder="1" keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={styles.grow}>
              <Field label="Biggest team" value={f.teamMax} onChangeText={(teamMax) => put({ teamMax })} placeholder="4" keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <Lines label="Tracks" value={f.tracks} onChange={(tracks) => put({ tracks })} placeholder={'AI | Build with open models\nFintech | Payments for small shops'} />
          <Lines label="Prizes" value={f.prizes} onChange={(prizes) => put({ prizes })} placeholder={'First | ₹50,000\nSecond | ₹25,000'} />
          <Lines label="Rounds" value={f.rounds} onChange={(rounds) => put({ rounds })} placeholder={'Ideas | Sat 10 AM\nFinals | Sun 4 PM'} />
          <Lines label="Judged on · weights add up to 100" value={f.criteria} onChange={(criteria) => put({ criteria })} placeholder={'Idea | 40\nBuild | 60'} />
        </>
      )}
      {f.category === 'meetups' && (
        <View>
          <View style={styles.toggle}>
            <Text style={s.opensText}>Let checked-in guests meet</Text>
            <Switch value={f.inRoom} onValueChange={(inRoom) => put({ inRoom })} disabled={started} accessibilityLabel="Let checked-in guests meet" />
          </View>
          <Text style={s.k}>{started ? 'Guests who’ve checked in can see each other in the app. It can’t change once the event starts.' : 'Guests who’ve checked in can see each other in the app.'}</Text>
        </View>
      )}
      {f.category === 'fests' && (
        <>
          <Label text="Kind of fest">
            <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Kind of fest">
              {FEST_TYPES.map((t) => (
                <Chip key={t} label={t} on={f.festType === t} onPress={() => put({ festType: f.festType === t ? null : t })} />
              ))}
            </View>
          </Label>
          <Lines label="What’s on · one per line" value={f.highlights} onChange={(highlights) => put({ highlights })} placeholder={'Battle of the bands\nFood court'} />
        </>
      )}
      <Label text="Age">
        <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="Age">
          {([null, 18, 21] as const).map((a) => (
            <Chip key={a ?? 0} label={a ? `${a}+` : 'None'} on={f.minAge === a} onPress={() => put({ minAge: a })} />
          ))}
        </View>
      </Label>
    </View>
  );
}

// A few lines of text in a glass box, like About.
function Lines({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Label text={label}>
      <Glass style={s.area}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={color.secondary}
          selectionColor={color.accent}
          style={s.areaText}
          multiline
          maxLength={2000}
        />
      </Glass>
    </Label>
  );
}

// The other hosts on the event, in order: Up, Down and Remove, a search that adds one, and Save acts, which sends the
// list whole with the one it started from. If someone changed it since (409 stale) it's read again and the edits go.
function Acts({ id, ownHostId, readOnly }: { id: string; ownHostId: string; readOnly: boolean }) {
  const load = useLoad<TeamAct[]>(`acts|${id}`, () => api.authed<TeamAct[]>('GET', `/events/${id}/acts`));
  const [saved, setSaved] = useState<TeamAct[] | null>(null); // the PUT's answer, over the load
  const [edit, setEdit] = useState<TeamAct[] | null>(null); // the list as changed; null while it isn't
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; hosts: HostCard[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = saved ?? load.data;
  const list = edit ?? loaded ?? [];
  const term = q.trim();
  useEffect(() => {
    if (readOnly || term.length < 2) return;
    let live = true;
    const wait = setTimeout(async () => {
      const r = await api.call<{ events: EventCard[]; hosts: HostCard[] }>('GET', `/public/search?q=${encodeURIComponent(term)}`);
      if (live) setFound({ q: term, hosts: r.ok ? r.data.hosts : [] });
    }, 300);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [term, readOnly]);
  if (!loaded)
    return load.error ? (
      <>
        <Note>{load.error.message}</Note>
        <Pill label="Try again" onPress={load.reload} />
      </>
    ) : null;
  const results = found?.q === term && term.length >= 2 ? pickable(found.hosts, list, ownHostId) : [];
  const change = (next: TeamAct[]) => {
    setEdit(next);
    setError(null);
  };
  const save = async () => {
    setBusy(true);
    const r = await api.authed<TeamAct[]>('PUT', `/events/${id}/acts`, actsBody(loaded, list));
    setBusy(false);
    if (r.ok) {
      setSaved(r.data);
      setEdit(null);
      return setError(null);
    }
    if (r.status === 409 && r.error.error === 'stale') {
      setSaved(null);
      setEdit(null);
      load.reload();
      return setError('Someone changed the acts since you opened them. Here’s the latest; make your changes again.');
    }
    setError(r.error.message);
  };
  return (
    <>
      {list.length > 0 ? (
        <Card>
          {list.map((a, i) => (
            <Row
              key={a.hostId}
              label={actName(a)}
              note={a.shown ? undefined : 'Not public on Orbit right now; only you see it here'}
              right={
                !readOnly && (
                  <>
                    {i > 0 && <Pill label="Up" spoken={`Move ${actName(a)} up`} onPress={busy ? undefined : () => change(moveAct(list, i, -1))} />}
                    {i < list.length - 1 && <Pill label="Down" spoken={`Move ${actName(a)} down`} onPress={busy ? undefined : () => change(moveAct(list, i, 1))} />}
                    <Pill label="Remove" spoken={`Remove ${actName(a)}`} onPress={busy ? undefined : () => change(removeAct(list, i))} />
                  </>
                )
              }
            />
          ))}
        </Card>
      ) : (
        <Note>No other hosts on this event.</Note>
      )}
      {readOnly && <Note>Acts are locked once the event starts.</Note>}
      {!readOnly && list.length < MAX_EVENT_ACTS && (
        <View style={s.fields}>
          <Field label="Find a host on Orbit" value={q} onChangeText={setQ} placeholder="A name" autoCapitalize="none" autoCorrect={false} maxLength={80} />
        </View>
      )}
      {!readOnly && list.length < MAX_EVENT_ACTS && results.length > 0 && (
        <Card>
          {results.map((h) => (
            <Row key={h.id} label={h.name} note={[h.kind, h.city].filter(Boolean).join(' · ') || undefined} onPress={busy ? undefined : () => change(addAct(list, h, ownHostId))} plain spoken={`Add ${h.name}`} />
          ))}
        </Card>
      )}
      {!readOnly && list.length >= MAX_EVENT_ACTS && <Note>{`That’s ${MAX_EVENT_ACTS} acts, the most an event can have.`}</Note>}
      {!readOnly && actsChanged(loaded, list) && (
        <View style={s.fields}>
          <Wide label={busy ? 'Saving…' : 'Save acts'} onPress={() => void save()} disabled={busy} />
        </View>
      )}
      {error && <Note live>{error}</Note>}
    </>
  );
}

// One of the event's two images: what's there, then Add or Change (and Remove for the optional 4:3). The library crops
// it to its shape; the API still checks it (3:4 or 4:3, big enough, 5 MB) and says why in words. After an upload or a
// removal the event is read again, so the page shows its new link and Publish's fixes drop the poster.
function Picture({ id, shape, link, locked, onDone }: { id: string; shape: 'poster' | 'wide'; link: string | null; locked: boolean; onDone: (e: TeamEvent) => void }) {
  const [busy, setBusy] = useState<string | null>(null); // the pill's word while it's out
  const [error, setError] = useState<string | null>(null);
  const picking = useRef(false);
  const poster = shape === 'poster';
  const send = async (word: string, call: () => ReturnType<typeof api.authed>) => {
    setBusy(word);
    setError(null);
    const r = await call();
    if (r.ok) {
      const fresh = await api.authed<TeamEvent>('GET', `/events/${id}`);
      if (fresh.ok) onDone(fresh.data);
    } else setError(r.error.message);
    setBusy(null);
  };
  const choose = async () => {
    if (busy || picking.current) return;
    picking.current = true;
    setError(null);
    try {
      await pick();
    } finally {
      picking.current = false;
    }
  };
  const pick = async () => {
    let picked: ImagePicker.ImagePickerResult;
    try {
      // Android's editor crops to `aspect`; iOS's only crops square, so there the phone cuts the shape (centreCrop) with
      // no editor rather than cutting a square the host just framed.
      const edit = Platform.OS === 'android';
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: edit, aspect: poster ? [3, 4] : [4, 3], quality: 0.85 });
    } catch {
      return setError('Couldn’t open your photos. Try again.');
    }
    const a = picked.canceled ? null : picked.assets[0];
    if (!a) return;
    if (a.fileSize && a.fileSize > PHOTO_MAX_BYTES) return setError('That image is over 5 MB. Choose a smaller one.');
    let uri = a.uri;
    const box = centreCrop(a.width, a.height, shape);
    if (box) {
      setBusy('Preparing…');
      try {
        const cut = await ImageManipulator.manipulate(a.uri).crop(box).renderAsync();
        uri = (await cut.saveAsync({ compress: 0.85, format: SaveFormat.JPEG })).uri;
      } catch {
        setBusy(null);
        return setError('Couldn’t crop that image. Try another.');
      }
    }
    const form = new FormData();
    // As a File: SDK 58's fetch (expo/fetch) sends a part with bytes(), not React Native's { uri, name, type }.
    form.append('image', new File(uri));
    await send('Uploading…', () => api.authed('PUT', `/events/${id}/${shape}`, form));
  };
  const remove = () =>
    Alert.alert('Remove the wide image?', 'The page shows the poster instead.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void send('Removing…', () => api.authed('DELETE', `/events/${id}/wide`)) },
    ]);
  const size = poster ? styles.poster : styles.wide;
  return (
    <>
      <View style={styles.picture}>
        {link ? (
          <Image source={{ uri: link }} style={size} alt={poster ? 'The event’s poster' : 'The event’s wide image'} />
        ) : (
          <View style={[size, styles.blank]}>
            <Text style={s.chipText}>{poster ? '3:4 · needed to publish' : '4:3 · shown instead of the poster'}</Text>
          </View>
        )}
        {!locked && (
          <View style={styles.buttons}>
            <Pill label={busy ?? (link ? 'Change' : poster ? 'Add poster' : 'Add wide image')} onPress={busy ? undefined : () => void choose()} />
            {!poster && link && <Pill label="Remove" onPress={busy ? undefined : remove} />}
          </View>
        )}
      </View>
      {error && <Note live>{error}</Note>}
    </>
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
  grow: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  buttons: { flexDirection: 'row', gap: space.small },
  picture: { marginHorizontal: 20, gap: 12 },
  // Both sides set: a bundled RN Image loses aspectRatio to the file's own height.
  poster: { width: 180, height: 240, borderRadius: radius.sm, backgroundColor: color.raised },
  wide: { width: 240, height: 180, borderRadius: radius.sm, backgroundColor: color.raised },
  blank: { alignItems: 'center', justifyContent: 'center', padding: 12 },
} as const;
