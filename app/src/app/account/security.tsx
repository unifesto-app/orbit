// Sign-in and security (User doc, "Managing sign-in methods" and "Account security"), on the Orbit API: every way in
// (phone, email, Google, Apple), the passkeys, and the devices signed in, with Sign out everywhere else.
// - Every change asks "Confirm it's you" first unless this phone confirmed in the last 10 minutes (ensureFresh,
//   src/ways.ts), and the account hears of it.
// - The phone can be changed but never removed, and nothing removes the last way in (canRemove here, the API too).
// - For 7 days after "Is this you?" on a new phone, removing a way in waits; the API says until when.
// - Apple is iOS only, as the sign-in sheet; a linked Apple still shows on Android so it can be removed.
// Change number and Add/Change email are Edit profile's screen (src/app/account/contact.tsx), which confirms by code.
// Read again each time the screen comes back (from Confirm it's you, Change number, Rename).
import type { ApiError, Security as Sec } from '@orbit/contract';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Group, Note, Page, Pill, Row } from '../../account/kit';
import { canRemove, day, maskEmail, maskPhone, type Way } from '../../account/rules';
import type { Result } from '../../api';
import { useLoad } from '../../load';
import { api, refreshAccount, useMe } from '../../session';
import { space } from '../../theme';
import { addPasskey, appleHere, appleProof, ensureFresh, type Got, googleProof, passkeysHere } from '../../ways';

const NAMES = { phone: 'Phone', email: 'Email', google: 'Google', apple: 'Apple' } as const;

const confirm = (title: string, message: string, action: string, then: () => void) =>
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: then },
  ]);

export default function Security() {
  const me = useMe();
  const { data: sec, error, reload } = useLoad(`security|${me.id}`, () => api.authed<Sec>('GET', '/me/security'), { keep: true });
  const seen = useRef(false); // the first focus is the first read
  useFocusEffect(
    useCallback(() => {
      if (seen.current) reload();
      seen.current = true;
    }, [reload]),
  );

  // One change at a time; each says what went wrong, then the screen reads again. Null: stopped quietly (closed).
  const working = useRef(false);
  const act = async (change: () => Promise<Result<unknown> | Got<unknown> | null>) => {
    if (working.current) return;
    working.current = true;
    try {
      const r = await change();
      const why: ApiError | null = !r || r.ok ? null : r.error;
      if (why) Alert.alert(why.message);
    } finally {
      working.current = false;
      reload();
    }
  };
  // Confirmed first, then the change.
  const fresh = (change: () => Promise<Result<unknown> | Got<unknown> | null>) => act(async () => ((await ensureFresh()) ? change() : null));

  if (!sec)
    return (
      <Page title="Sign-in and security">
        {error && (
          <View style={styles.failed}>
            <Note>{error.message}</Note>
            <View style={styles.add}>
              <Pill label="Try again" size="small" onPress={reload} />
            </View>
          </View>
        )}
      </Page>
    );

  const ways: Way[] = [
    ...(sec.phone ? (['phone'] as const) : []),
    ...(sec.email ? (['email'] as const) : []),
    ...(sec.google ? (['google'] as const) : []),
    ...(sec.apple ? (['apple'] as const) : []),
    ...sec.passkeys.map(() => 'passkey' as const),
  ];
  const shown = (['phone', 'email', 'google', 'apple'] as const).filter((w) => w !== 'apple' || appleHere || sec.apple);
  const detail = (w: (typeof shown)[number]) => {
    if (w === 'phone') return sec.phone ? maskPhone(sec.phone) : 'Not added';
    if (w === 'email') return sec.email ? maskEmail(sec.email) : 'Not added';
    const linked = sec[w];
    return !linked ? 'Not linked' : linked.email ? maskEmail(linked.email) : 'Linked';
  };
  const remove = (w: 'email' | 'google' | 'apple') =>
    confirm(`Remove ${NAMES[w]}?`, `You won’t be able to sign in with ${NAMES[w]} any more.`, 'Remove', () =>
      fresh(async () => {
        const r = await api.authed('DELETE', `/me/${w}`);
        if (r.ok && w === 'email') void refreshAccount();
        return r;
      }),
    );
  const link = (w: 'google' | 'apple') =>
    fresh(async () => {
      const p = w === 'google' ? await googleProof() : await appleProof();
      return p.ok ? api.authed('POST', `/me/${w}`, p.proof) : p;
    });
  const contact = (way: 'phone' | 'email') => router.push({ pathname: '/account/contact', params: { way } });
  const action = (w: (typeof shown)[number]) => {
    if (w === 'phone') return <Pill label={sec.phone ? 'Change' : 'Add'} size="small" onPress={() => contact('phone')} />;
    const on = w === 'email' ? !!sec.email : !!sec[w];
    if (!on) return <Pill label={w === 'email' ? 'Add' : 'Link'} size="small" onPress={() => (w === 'email' ? contact('email') : void link(w))} />;
    if (w === 'email')
      return (
        <View style={styles.pills}>
          <Pill label="Change" size="small" onPress={() => contact('email')} />
          {canRemove('email', ways) && <Pill label="Remove" size="small" muted onPress={() => remove('email')} />}
        </View>
      );
    return canRemove(w, ways) ? <Pill label="Remove" size="small" onPress={() => remove(w)} /> : undefined;
  };
  const here = passkeysHere();

  return (
    <Page title="Sign-in and security">
      <Group title="Ways in">
        {shown.map((w) => (
          <Row key={w} label={NAMES[w]} note={detail(w)} right={action(w)} />
        ))}
      </Group>

      <Group title="Passkeys">
        {sec.passkeys.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            note={`Added ${day(p.added)}`}
            onPress={() => router.push({ pathname: '/account/passkey-name', params: { id: p.id, name: p.name } })}
            right={
              canRemove('passkey', ways) ? (
                <Pill
                  label="Remove"
                  size="small"
                  onPress={() =>
                    confirm(`Remove ${p.name}?`, 'This passkey stops working for Orbit.', 'Remove', () => fresh(() => api.authed('DELETE', `/me/passkeys/${p.id}`)))
                  }
                />
              ) : undefined
            }
          />
        ))}
        {sec.passkeys.length === 0 && <Row label="No passkeys" />}
      </Group>
      {here !== 'no' && (
        <View style={styles.add}>
          <Pill label="Add a passkey" size="small" onPress={() => fresh(addPasskey)} />
        </View>
      )}

      <Group title="Devices">
        {sec.devices.map((d) => (
          <Row
            key={d.id}
            label={d.name}
            note={`${d.client === 'app' ? 'App' : 'Web'} · ${d.current ? 'This device' : `Active ${day(d.lastActive)}`}`}
            right={
              !d.current && (
                <Pill
                  label="Sign out"
                  size="small"
                  onPress={() => confirm(`Sign out ${d.name}?`, 'It will need to sign in again.', 'Sign out', () => act(() => api.authed('DELETE', `/me/devices/${d.id}`)))}
                />
              )
            }
          />
        ))}
      </Group>
      {sec.devices.length > 1 && (
        <View style={styles.add}>
          <Pill
            label="Sign out everywhere else"
            size="small" // small, like Add a passkey (owner, 15 Nov 2026: "make them small")
            onPress={() =>
              confirm('Sign out everywhere else?', 'Every other phone and browser signs out now. This phone stays signed in.', 'Sign out', () =>
                act(() => api.authed('POST', '/me/devices/signout-others')),
              )
            }
          />
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  add: { marginTop: space.small + 4, alignItems: 'center' },
  pills: { flexDirection: 'row', gap: 6 },
  failed: { gap: space.small },
});
