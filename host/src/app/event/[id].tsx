// An event's messages to its ticket holders, from Messages on its card in Events (notifications PR 10): Announce (the
// text, who it goes to, Send, how many are left of today's 3), what was sent, and the switches for the three automatic
// messages. Pushed over the tabs with the Inbox's back circle. From GET /events/:id/announcements; Send is POST, a
// switch is PUT /events/:id/auto-messages.
// ponytail: "Only those not checked in" reaches everyone until the door records check-ins (Crew slice).
import { ANNOUNCEMENTS_A_DAY, type Announcement, type AutoMessages, type EventAnnouncements } from '@orbit/contract';
import { DARK_TINT, Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color, font, space } from '@orbit/mobile/theme';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { timeLabel } from '../../launch/inbox';
import { dayLabel, istDate } from '../../launch/money';
import { Card, Note, Row, Section, Wide, styles as ui } from '../../launch/ui';
import { api } from '../../session';

const BACK = require('../../../assets/tabs/chevron.png');
const back = () => (router.canGoBack() ? router.back() : router.replace('/events'));
const SWITCHES: { key: keyof AutoMessages; label: string; note: string }[] = [
  { key: 'tomorrow', label: 'A day before', note: 'When and where, the day before' },
  { key: 'startingSoon', label: 'An hour before', note: 'Starting soon' },
  { key: 'thanks', label: 'After it ends', note: 'Thanks for coming' },
];

export default function EventMessages() {
  const insets = useSafeAreaInsets();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const load = useLoad<EventAnnouncements>(id ? `announcements|${id}` : null, () => api.authed<EventAnnouncements>('GET', `/events/${id}/announcements`));
  const [text, setText] = useState('');
  const [notIn, setNotIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoMessages | null>(null); // shown at once, back as it was on a refusal
  const left = load.data?.left ?? ANNOUNCEMENTS_A_DAY;
  const switches = auto ?? load.data?.autoMessages;

  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await api.authed<Announcement>('POST', `/events/${id}/announcements`, { text, audience: notIn ? 'notCheckedIn' : 'everyone' });
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setText('');
    load.reload();
  };
  const flip = async (key: keyof AutoMessages, on: boolean) => {
    const was = switches!;
    setAuto({ ...was, [key]: on });
    const r = await api.authed<AutoMessages>('PUT', `/events/${id}/auto-messages`, { [key]: on });
    setAuto(r.ok ? r.data : was);
    if (!r.ok) setError(r.error.message);
  };

  return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + space.big }} keyboardShouldPersistTaps="handled">
        <View style={styles.bar}>
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" hitSlop={4} style={({ pressed }) => pressed && ui.pressed}>
            <Glass tint={DARK_TINT} style={styles.backCircle}>
              <Image source={BACK} style={styles.backMark} />
            </Glass>
          </Pressable>
        </View>
        <Text style={ui.pageTitle} accessibilityRole="header">
          Messages
        </Text>
        {title ? <Note>{title}</Note> : null}
        {load.error && <Note>{load.error.message}</Note>}

        <Section title="Announce" />
        <Card>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Doors open at 7. Bring your ID."
            placeholderTextColor={color.secondary}
            selectionColor={color.accent}
            multiline
            maxLength={500}
            accessibilityLabel="Announcement"
            style={styles.input}
          />
          <Row label="Only those not checked in" right={<Switch value={notIn} onValueChange={setNotIn} accessibilityLabel="Only those not checked in" />} />
        </Card>
        <View style={styles.send}>
          <Wide label={busy ? 'Sending…' : 'Send to ticket holders'} onPress={send} disabled={busy || !text.trim() || left === 0} />
        </View>
        <Note live={!!error}>{error ?? (left === 0 ? 'That’s all 3 for today. More tomorrow.' : `${left} of ${ANNOUNCEMENTS_A_DAY} left today. Each goes by push, inbox and email.`)}</Note>

        {switches && (
          <>
            <Section title="Automatic messages" />
            <Card>
              {SWITCHES.map((s) => (
                <Row key={s.key} label={s.label} note={s.note} right={<Switch value={switches[s.key]} onValueChange={(on) => void flip(s.key, on)} accessibilityLabel={s.label} />} />
              ))}
            </Card>
          </>
        )}

        {!!load.data?.items.length && (
          <>
            <Section title="Sent" />
            <View style={styles.sent}>
              {load.data.items.map((a) => (
                <Card key={a.id}>
                  <Text style={styles.text}>{a.text}</Text>
                  <Text style={styles.meta}>
                    {`${dayLabel(istDate(Date.parse(a.createdAt)))} · ${timeLabel(a.createdAt)} · ${a.audience === 'everyone' ? 'Everyone' : 'Not checked in'} · ${a.reached} reached`}
                  </Text>
                </Card>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backMark: { width: 18, height: 18, tintColor: color.text, transform: [{ scaleX: -1 }] },
  input: { minHeight: 96, fontFamily: font.text, fontSize: 15, lineHeight: 20, color: color.text, textAlignVertical: 'top' },
  send: { marginTop: space.big, marginHorizontal: 20 },
  sent: { gap: space.small },
  text: { fontFamily: font.title, fontSize: 15, lineHeight: 20, color: color.text },
  meta: { marginTop: 4, fontFamily: font.text, fontSize: 13, lineHeight: 18, color: color.secondary },
});
