// Help and support: answers to what people ask most, written by staff in Galaxy's App content (src/content.ts), then
// Write to us, which sends to Orbit's support inbox (POST /me/support, X16). Staff answer in Galaxy's Support; a reply
// comes by push, inbox and email (supportReply opens this screen) and shows here, above the box, with the person's own
// messages: the latest thread from GET /me/support?app=orbit. Signed out, Send asks to sign in first.
import { SUPPORT_BODY_MAX, type MySupport, type SupportThread } from '@orbit/contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from 'react-native';

import { EDGE, Group, PAD, Page, Pill, Row } from '../../account/kit';
import { useContent } from '../../content';
import { Glass } from '../../glass';
import { Section } from '../../rows';
import { api, needsAccount, useSession } from '../../session';
import { around, color, font, radius, space } from '../../theme';

export default function Help() {
  const answers = useContent().help;
  const [message, setMessage] = useState('');
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const out = useRef(false); // one send at a time, even from a second tap
  const me = useSession()?.me.id;

  const load = useCallback(async () => {
    const r = await api.authed<MySupport>('GET', '/me/support?app=orbit');
    if (r.ok) setThread(r.data.thread);
  }, []);
  useEffect(() => {
    setThread(null);
    if (me) void load();
  }, [me, load]);

  async function send() {
    const body = message.trim();
    if (!body || out.current) return;
    out.current = true;
    setBusy(true);
    setProblem(null);
    const r = await api.authed<{ threadId: string }>('POST', '/me/support', { app: 'orbit', body });
    out.current = false;
    setBusy(false);
    if (r.ok) {
      setMessage('');
      await load();
      AccessibilityInfo.announceForAccessibility('Sent');
      return;
    }
    const p = r.status === 429 ? 'You’ve sent a lot today. Try again tomorrow.' : r.error.message;
    setProblem(p);
    AccessibilityInfo.announceForAccessibility(p);
  }
  // Questions only, each answer opening under it on a tap (owner, 15 Nov 2026: "keep only titles remove all
  // descriptions").
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Page title="Help and support">
      {/* Staff may clear every answer; then only Write to us shows, never an empty card. */}
      {answers.length > 0 && (
        <Group>
          {answers.map(({ q, a }) => (
            <Row key={q} label={q} note={open === q ? a : undefined} onPress={() => setOpen(open === q ? null : q)} />
          ))}
        </Group>
      )}

      {/* The conversation, oldest first: what you wrote and Orbit's replies, as plain text rows. */}
      {thread && thread.messages.length > 0 && (
        <Group title="Your messages">
          {thread.messages.map((m) => (
            <Row key={m.id} label={m.body} note={m.from === 'person' ? 'You' : m.name && m.name !== 'Orbit' ? `${m.name} from Orbit` : 'Orbit'} />
          ))}
        </Group>
      )}

      <Section title="Write to us" />
      <Glass style={styles.rim}>
        <TextInput
          style={styles.box}
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder="What happened? Name the event if it’s about one."
          placeholderTextColor={color.secondary}
          keyboardAppearance="dark"
          accessibilityLabel="Message to support"
          maxLength={SUPPORT_BODY_MAX}
          editable={!busy}
        />
      </Glass>
      {problem && <Text style={styles.problem}>{problem}</Text>}
      <View style={styles.send}>
        <Pill label={busy ? 'Sending…' : 'Send'} size="wide" disabled={!message.trim() || busy} onPress={() => needsAccount(() => void send())} />
      </View>
    </Page>
  );
}

const FACE = around(radius.sm, PAD); // the card padding every Account card has
const styles = StyleSheet.create({
  rim: { marginHorizontal: 20, padding: EDGE, borderRadius: around(FACE, EDGE) },
  box: {
    minHeight: 120,
    borderRadius: FACE,
    backgroundColor: color.card,
    padding: PAD,
    fontFamily: font.text,
    fontSize: 15,
    lineHeight: 21,
    color: color.text,
    textAlignVertical: 'top',
  },
  send: { marginTop: space.small + 4 },
  problem: { marginTop: space.small, marginHorizontal: 20, fontFamily: font.medium, fontSize: 14, color: color.secondary },
});
