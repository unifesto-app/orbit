// Inbox Settings, from the gear on every host app's Inbox (inbox.tsx): the switches for messages to hosts, on GET/PUT
// /me/notification-settings, as the Orbit app's Notifications (app/src/app/account/notifications.tsx) has them. Host and
// staff messages answer to Your hosts (contract switchOf), pushed and emailed apart; quiet hours are the account's own.
// Each switch shows at once, is sent alone, and flips back with a note if the API says no. Must-sends are listed as
// Always sent, so nobody wonders why one still arrives.
// ponytail: no Push master switch here: it's the account's for every Orbit app, so it stays in the Orbit app.
import type { NotificationSettings, NotificationSettingsBody, SwitchKey } from '@orbit/contract';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Switch, Text } from 'react-native';

import { Card, Note, Row, Section } from '../launch/ui';
import { api } from '../session';
import { Frame, s } from './request';

type Key = SwitchKey | 'quiet';
const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
const valueOf = (x: NotificationSettings, key: Key) => (key === 'quiet' ? x.quiet : x.switches[key]);
const withValue = (x: NotificationSettings, key: Key, v: boolean): NotificationSettings =>
  key === 'quiet' ? { ...x, quiet: v } : { ...x, switches: { ...x.switches, [key]: v } };
const patchFor = (key: Key, v: boolean): NotificationSettingsBody => (key === 'quiet' ? { quiet: v } : { switches: { [key]: v } });

export default function InboxSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void api.authed<NotificationSettings>('GET', '/me/notification-settings').then((r) => live.current && (r.ok ? setSettings(r.data) : setFailed(r.error.message)));
    return () => {
      live.current = false;
    };
  }, []);
  // Only the newest PUT's answer is taken, so answers landing out of order still end on the API's last word.
  const saves = useRef(0);
  const flip = (key: Key) => (v: boolean) => {
    if (!settings) return;
    const was = valueOf(settings, key);
    const at = ++saves.current;
    setSaid(null);
    setSettings((x) => x && withValue(x, key, v));
    void api.authed<NotificationSettings>('PUT', '/me/notification-settings', patchFor(key, v)).then((r) => {
      if (!live.current) return;
      if (r.ok) return void (at === saves.current && setSettings(r.data));
      setSettings((x) => x && withValue(x, key, was));
      setSaid('Couldn’t save that. Try again.');
    });
  };
  const toggle = (key: Key, label: string) => (
    <Row label={label} right={<Switch value={!!settings && valueOf(settings, key)} onValueChange={flip(key)} accessibilityLabel={label} />} />
  );

  return (
    <Frame step={null} onBack={back}>
      <Text style={s.title} accessibilityRole="header">
        Settings
      </Text>
      {!settings ? (
        failed && <Note>{failed}</Note>
      ) : (
        <>
          <Section title="Your hosts" />
          <Card>
            {toggle('push.yourHosts', 'Push')}
            {toggle('email.yourHosts', 'Email')}
          </Card>
          <Note>Messages about your hosts, their events and their team. They always reach this Inbox.</Note>
          <Section title="Quiet hours" />
          <Card>{toggle('quiet', '10 PM to 7 AM')}</Card>
          <Note>Holds pushes that can wait, in every Orbit app.</Note>
          {said && <Note live>{said}</Note>}
          <Section title="Always sent" />
          <Card>
            <Row label="Sign-in codes and account changes" />
            <Row label="Invites to a team" />
            <Row label="Your host’s status, tick and owner" />
            <Row label="Payouts, the bank account and fees" />
            <Row label="Answers to your requests" />
            <Row label="Replies from support" />
          </Card>
        </>
      )}
    </Frame>
  );
}
