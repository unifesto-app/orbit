// Edit host, from Event Partner's Host tab (Edit host, and Finish your page's Say what you do), for the host's Admins:
// its name, what it does, its website, its city and whether it has a public page, as PATCH /hosts/:id (EditHost) takes
// them. Only what changed is sent (launch/hostEdit.ts: a website without https:// gets it, an http:// one is refused
// under the field); a new name loses the verified tick (Hosts flow), so Save says so first. The API's word shows under
// the fields.
// ponytail: the link (slug), the kind and the fee plan aren't here: no host pages on the web to link to yet, a Venue's
// kind is locked by its counter, and the fee plan is picked on Earnings.
import type { HostPage } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';

import { useHost } from '../launch/host';
import { type HostForm, hostChanges } from '../launch/hostEdit';
import { Field, Note, Pill, Wide } from '../launch/ui';
import { api, refreshMe } from '../session';
import { Chip, CitySheet, Frame, Label, Opens, s } from './request';

const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
const formOf = (p: HostPage): HostForm => ({ name: p.name, about: p.about ?? '', website: p.website ?? '', city: p.city, visibility: p.visibility });

export default function EditHost() {
  const host = useHost();
  const page = useLoad<HostPage>(host ? `host|${host.id}` : null, () => api.authed<HostPage>('GET', `/hosts/${host!.id}`));
  if (!host) return null;
  return page.data ? (
    <Edit key={host.id} id={host.id} page={page.data} />
  ) : (
    <Frame step={null} onBack={back}>
      <Text style={s.title} accessibilityRole="header">
        Edit host
      </Text>
      {page.error && (
        <>
          <Note>{page.error.message}</Note>
          <View style={s.retry}>
            <Pill label="Try again" onPress={page.reload} />
          </View>
        </>
      )}
    </Frame>
  );
}

function Edit({ id, page }: { id: string; page: HostPage }) {
  const [was] = useState(() => formOf(page));
  const [f, setF] = useState(was);
  const [city, setCity] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const put = (p: Partial<HostForm>) => setF((x) => ({ ...x, ...p }));

  const { changes, why } = hostChanges(was, f);
  const some = Object.keys(changes).length > 0;
  const ok = some && !why && !!f.name.trim() && !busy;

  const send = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setProblem(null);
    const r = await api.authed<HostPage>('PATCH', `/hosts/${id}`, changes);
    working.current = false;
    setBusy(false);
    if (!r.ok) return setProblem(r.error.message);
    void refreshMe(); // the name in the switcher
    back();
  };
  const save = () =>
    changes.name !== undefined && page.verified
      ? Alert.alert('Change the name?', 'A new name loses the verified tick till Orbit checks it again.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Change it', onPress: () => void send() },
        ])
      : void send();

  return (
    <Frame step={null} onBack={back} foot={<Wide label={busy ? 'Saving…' : 'Save'} disabled={!ok} onPress={save} />}>
      <Text style={s.title} accessibilityRole="header">
        Edit host
      </Text>
      <View style={s.fields}>
        <Field label="Name" value={f.name} onChangeText={(name) => put({ name })} maxLength={100} autoCapitalize="words" />
        <Label text="What you do" optional>
          <Glass style={s.area}>
            <TextInput
              accessibilityLabel="What you do"
              value={f.about}
              onChangeText={(about) => put({ about })}
              placeholder="A few lines about you"
              placeholderTextColor={color.secondary}
              selectionColor={color.accent}
              style={s.areaText}
              multiline
              maxLength={2000}
            />
          </Glass>
        </Label>
        <Field label="Website · optional" value={f.website} onChangeText={(website) => put({ website })} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={200} />
        {why && <Note live>{why}</Note>}
        <Label text="City">
          <Opens label="City" value={f.city} placeholder="Pick your city" onPress={() => setCity(true)} />
        </Label>
        <Label text="Page">
          <View style={s.chips} accessibilityRole="radiogroup">
            <Chip label="Public" on={f.visibility === 'public'} onPress={() => put({ visibility: 'public' })} />
            <Chip label="Link only" on={f.visibility === 'private'} onPress={() => put({ visibility: 'private' })} />
          </View>
        </Label>
      </View>
      {problem && <Note live>{problem}</Note>}
      {city && (
        <CitySheet
          chosen={f.city}
          onPick={(c) => {
            put({ city: c });
            setCity(false);
          }}
          onClose={() => setCity(false)}
        />
      )}
    </Frame>
  );
}
