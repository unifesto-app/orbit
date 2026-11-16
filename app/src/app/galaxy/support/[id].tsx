// One support ticket (Galaxy doc, Support; Galaxy canvas, 16 Nov 2026): who sent it and what it's about, its status,
// who has it, the messages, and a reply. Replies go by push, inbox and email (or WhatsApp's account notice when there's no
// email). Not risky: replying, assigning and the status. A ticket sent signed out is Unverified, and staff change nothing
// on an account until the sender proves it's theirs with a code.
// ponytail: the reply box sits at the end of the page rather than pinned over it; Send, Change and Saved replies come
// with the API.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Chips, Field, Group, Note, Page, Pill, Row } from '../../../account/kit';
import { type TicketStatus, tickets } from '../../../galaxy/data';
import { ago, due } from '../../../galaxy/due';
import { StaffNote, gated, opener } from '../../../galaxy/kit';
import { Glass } from '../../../glass';
import { now } from '../../../mock';
import { NotFound, Section } from '../../../rows';
import { useMe } from '../../../session';
import { color, font, space } from '../../../theme';

const STATUSES: readonly TicketStatus[] = ['Open', 'Waiting on the person', 'Resolved'];

export default gated('queues', function SupportTicket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const t = tickets.find((x) => x.id === id);
  const [status, setStatus] = useState<TicketStatus>(t?.status ?? 'Open');
  const [reply, setReply] = useState('');
  if (!t) return <NotFound what="ticket" />;

  // Nobody works their own ticket (Roles doc): it shows, read only, for someone else to take.
  const own = t.accountId === me.id;
  const to = t.accountId ? `Reply to ${t.from.split(' ')[0]}` : 'Reply';
  const clock = status === 'Open' ? due(t.askedAt, now).line.toLowerCase() : status.toLowerCase();
  const messages = t.messages ?? [{ from: t.from, when: ago(t.askedAt, now), text: t.title }];
  return (
    <Page title={t.title}>
      <Note>{`${t.from} · ${clock}`}</Note>
      {!own && (
        <View style={styles.chips}>
          <Chips options={STATUSES} value={status} onChange={setStatus} />
        </View>
      )}

      <Group title="About">
        {t.accountId ? (
          <Row label={t.from} onPress={opener(me, 'people', `/galaxy/person/${t.accountId}`)} />
        ) : (
          <Row label="Unverified" note="Sent signed out" />
        )}
        {t.about?.map((a) => <Row key={a.label} label={a.label} note={a.note} />)}
        <Row label="Assigned" value={own ? 'Someone else' : 'You'} right={own ? undefined : <Pill label="Change" size="small" />} />
      </Group>

      <Section title="Messages" />
      <View style={styles.thread}>
        {messages.map((m, i) => (
          <Glass key={i} style={[styles.rim, m.staff ? styles.mine : styles.theirs]}>
            <View style={[styles.bubble, m.staff && styles.mineFace]}>
              <Text style={styles.who}>
                {m.from}
                <Text style={styles.when}>{` · ${m.when}`}</Text>
              </Text>
              <Text style={styles.text}>{m.text}</Text>
            </View>
          </Glass>
        ))}
      </View>

      {own ? (
        <StaffNote>This is your own ticket, so someone else answers it.</StaffNote>
      ) : (
        <View style={styles.reply}>
          <View style={styles.saved}>
            <Pill label="Saved replies" size="small" />
          </View>
          <Field label={to} placeholder={to} multiline value={reply} onChangeText={setReply} />
          <View style={styles.send}>
            <Pill label="Send" size="small" disabled={!reply.trim()} onPress={() => router.back()} />
          </View>
        </View>
      )}
    </Page>
  );
});

// A message: the card's face inside a 1px frosted rim, the sender's on the left and staff's on the right in the raised
// grey. Never the accent: it's for elements, not for what people say.
const styles = StyleSheet.create({
  chips: { marginHorizontal: 20, marginTop: 24 },
  thread: { marginHorizontal: 20, gap: space.small },
  rim: { maxWidth: '85%', padding: 1, borderRadius: 19 },
  theirs: { alignSelf: 'flex-start' },
  mine: { alignSelf: 'flex-end' },
  bubble: { borderRadius: 18, padding: 12, gap: 4, backgroundColor: color.card },
  mineFace: { backgroundColor: color.raised },
  who: { fontFamily: font.title, fontSize: 13, lineHeight: 18, color: color.text },
  when: { fontFamily: font.text, color: color.secondary },
  text: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.text },
  reply: { marginHorizontal: 20, marginTop: 24, gap: space.small },
  saved: { flexDirection: 'row' },
  send: { alignItems: 'flex-end' },
});
