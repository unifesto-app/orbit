// Notifications: the one screen with every switch (Notifications doc, Settings; defaults accepted 15 Nov 2026). Push
// stops every push but the inbox still fills; each kind has a push switch, and the optional emails their own. Quiet
// hours hold low and normal pushes 10 PM to 7 AM, India time. Must-sends are listed as "Always sent", so nobody wonders
// why a receipt still arrives. Titles only, no descriptions (owner, 15 Nov 2026). inRoom's asks are push only, never
// emailed. No Your hosts switches while the app has no Console: host messages open Console, so they stay out of the app
// (the default shown with the inbox prototype, 19 Nov 2026; src/app/inbox.tsx); they come back with a home for hosts.
// The Push switch follows the phone (src/push.tsx): never asked, turning it on brings up the phone's prompt; refused
// there, it opens Orbit's push-off sheet, whose Open Settings is the only way back (doc: "it opens the phone's settings
// when push is blocked").
// The settings are the API's (GET /me/notification-settings, its defaults: quiet hours on, near only with a city); each
// switch is sent alone as it's flipped, and flips back with a note if the API says no.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { NotificationSettings } from '@orbit/contract';

import { Group, Note, Page, Row, Toggle } from '../../account/kit';
import { showNote } from '../../note';
import { noticesApi, patchFor, type SettingKey, valueOf, withValue } from '../../notices';
import { askPushFromSettings, pushStatus, type PushStatus } from '../../push';
import { api } from '../../session';

const PUSH = [
  ['tickets', 'Tickets'],
  ['reminders', 'Reminders'],
  ['follows', 'From hosts you follow'],
  ['near', 'New events near you'],
  ['announcements', 'Host announcements'],
  ['inRoom', 'inRoom'],
] as const;
const EMAIL = [
  ['reminders', 'Reminders'],
  ['follows', 'From hosts you follow'],
  ['announcements', 'Host announcements'],
] as const;

export default function Notifications() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void noticesApi(api)
      .settings()
      .then((r) => live.current && (r.ok ? setSettings(r.data) : setFailed(true)));
    return () => {
      live.current = false;
    };
  }, []);
  const is = (key: SettingKey) => (settings ? valueOf(settings, key) : false);
  // A flip shows at once. Each PUT answers with the whole settings; only the newest PUT's answer is taken, so answers
  // landing out of order still end on the server's last word. A failed one puts back what that switch was before it.
  const saves = useRef(0);
  const flip = (key: SettingKey) => (v: boolean) => {
    const was = is(key);
    const at = ++saves.current;
    setSettings((s) => s && withValue(s, key, v));
    void noticesApi(api)
      .saveSettings(patchFor(key, v))
      .then((r) => {
        if (!live.current) return;
        if (r.ok) return at === saves.current && setSettings(r.data);
        setSettings((s) => s && withValue(s, key, was));
        showNote({ text: 'Couldn’t save that. Try again.' });
      });
  };
  // The phone's own answer, read again whenever the app comes back (from the phone's settings, say).
  const [phone, setPhone] = useState<PushStatus>('none');
  useEffect(() => {
    const read = () => void pushStatus().then(setPhone);
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => sub.remove();
  }, []);
  // Shown on when the phone allows it and the API's push is on; the phone's prompt said yes turns the API's on too.
  const push = (v: boolean) =>
    phone === 'ask' && v
      ? void askPushFromSettings().then(async (yes) => {
          setPhone(await pushStatus());
          if (yes && !is('push')) flip('push')(true);
        })
      : flip('push')(v);

  if (!settings)
    return <Page title="Notifications">{failed && <Note>Couldn’t load your settings. Try again in a moment.</Note>}</Page>;

  return (
    <Page title="Notifications">
      <Group>
        {phone === 'blocked' ? (
          // Orbit's sheet first, saying only the phone can turn it back on (src/app/allow.tsx; owner, 27 Nov 2026).
          <Row label="Push" value="Off in phone settings" chevron onPress={() => router.push({ pathname: '/allow', params: { kind: 'push-off' } })} />
        ) : (
          <Row label="Push" right={<Toggle label="Push" value={phone !== 'ask' && is('push')} onChange={push} />} />
        )}
      </Group>

      <Group title="Push">
        {PUSH.map(([key, label]) => (
          <Row key={key} label={label} right={<Toggle label={`${label} pushes`} value={is(`push.${key}`)} onChange={flip(`push.${key}`)} />} />
        ))}
      </Group>

      <Group title="Email">
        {EMAIL.map(([key, label]) => (
          <Row key={key} label={label} right={<Toggle label={`${label} email`} value={is(`email.${key}`)} onChange={flip(`email.${key}`)} />} />
        ))}
      </Group>

      <Group title="Quiet hours">
        <Row label="10 PM to 7 AM" right={<Toggle label="Quiet hours" value={is('quiet')} onChange={flip('quiet')} />} />
      </Group>

      <Group title="Always sent">
        <Row label="Sign-in codes and account changes" />
        <Row label="Your tickets, receipts and refunds" />
        <Row label="Changes to an event you’re going to" />
        <Row label="Replies from support" />
      </Group>
    </Page>
  );
}
