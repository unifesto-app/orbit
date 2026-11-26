// Help and support in Event Partner and Play Partner (X16), from the Help row on Host (team.tsx) and Venue (venue.tsx),
// and from a supportReply message or push (notices.ts pushHref). The conversation with Orbit's support (GET
// /me/support?app=, the latest thread from this app) as plain text rows, oldest first, then Write to us (POST
// /me/support). Staff answer in Galaxy's Support. Crew has no Help: opened there anyway (a link), it says so and sends
// nothing, never filing a crew message as another app's.
// Laid out as the Event Request's steps (request.tsx Frame): the back circle, the title, the box, Send at the foot.
import { type MySupport, SUPPORT_BODY_MAX, type SupportApp } from '@orbit/contract';
import { Glass } from '@orbit/mobile/glass';
import { useLoad } from '@orbit/mobile/load';
import { color } from '@orbit/mobile/theme';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, Text, TextInput, View } from 'react-native';

import { Card, Note, Row, Section, Wide } from '../launch/ui';
import { api, useSession } from '../session';
import { thisApp } from '../variant';
import { Frame, Label, s } from './request';

const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function Help() {
  if (thisApp.word === 'crew') {
    return (
      <Frame step={null} onBack={back}>
        <Text style={s.title} accessibilityRole="header">
          Help and support
        </Text>
        <Text style={s.line}>Ask the event’s lead, or write to Orbit from the Orbit app’s Help.</Text>
      </Frame>
    );
  }
  return <Conversation app={thisApp.word} />;
}

function Conversation({ app }: { app: SupportApp }) {
  const me = useSession()?.me.id;
  const load = useLoad<MySupport>(me ? `support|${me}|${app}` : null, () => api.authed<MySupport>('GET', `/me/support?app=${app}`));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const out = useRef(false); // one send at a time, even from a second tap
  const messages = load.data?.thread?.messages ?? [];

  const send = async () => {
    const body = message.trim();
    if (!body || out.current) return;
    out.current = true;
    setBusy(true);
    setProblem(null);
    const r = await api.authed<{ threadId: string }>('POST', '/me/support', { app, body });
    out.current = false;
    setBusy(false);
    if (r.ok) {
      setMessage('');
      load.reload();
      AccessibilityInfo.announceForAccessibility('Sent');
      return;
    }
    setProblem(r.status === 429 ? 'You’ve sent a lot today. Try again tomorrow.' : r.error.message);
  };

  return (
    <Frame step={null} onBack={back} foot={<Wide label={busy ? 'Sending…' : 'Send'} onPress={() => void send()} disabled={busy || !message.trim()} />}>
      <Text style={s.title} accessibilityRole="header">
        Help and support
      </Text>
      <Text style={s.line}>Write to us about anything. Orbit replies here, and tells you when it does.</Text>
      {load.error && <Note>{load.error.message}</Note>}
      {messages.length > 0 && (
        <>
          <Section title="Your messages" />
          <Card>
            {messages.map((m) => (
              <Row key={m.id} label={m.body} note={m.from === 'person' ? 'You' : m.name && m.name !== 'Orbit' ? `${m.name} from Orbit` : 'Orbit'} />
            ))}
          </Card>
        </>
      )}
      <View style={s.fields}>
        <Label text="Write to us">
          <Glass style={s.area}>
            <TextInput
              accessibilityLabel="Message to support"
              value={message}
              onChangeText={setMessage}
              placeholder="What happened? Name the event or the day if it’s about one."
              placeholderTextColor={color.secondary}
              selectionColor={color.accent}
              style={s.areaText}
              editable={!busy}
              multiline
              maxLength={SUPPORT_BODY_MAX}
            />
          </Glass>
        </Label>
      </View>
      {problem && <Note live>{problem}</Note>}
    </Frame>
  );
}
