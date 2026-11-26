// Report an event or a host (X15), from Report in its page's menu: a reason, an optional note and Send (POST /reports).
// Opened signed in only (reportIt in src/rows.tsx asks to sign in first), and only for a real event or host. Staff with
// Queues read it in Galaxy's Reports. A full modal with the field near the top, as New list, so the keyboard clears it.
import { REPORT_NOTE_MAX, REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason } from '@orbit/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Field, Group, Pill, Row } from '../account/kit';
import { showNote } from '../note';
import { Sheet } from '../rows';
import { api } from '../session';
import { color, font, space } from '../theme';

export default function Report() {
  const { event, host, name } = useLocalSearchParams<{ event?: string; host?: string; name?: string }>();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sent = useRef(false); // one send, even from a second tap while the first is out

  async function send() {
    if (!reason || sent.current) return;
    sent.current = true;
    setBusy(true);
    setProblem(null);
    const r = await api.authed<{ id: string }>('POST', '/reports', { ...(event ? { eventId: event } : { hostId: host }), reason, note: note.trim() || undefined });
    setBusy(false);
    if (r.ok) {
      router.back();
      showNote({ text: 'Thanks. We’ll look at it.' });
      return;
    }
    sent.current = false;
    const p = r.status === 429 ? 'You’ve sent too many reports today. Try again tomorrow.' : r.error.message;
    setProblem(p);
    AccessibilityInfo.announceForAccessibility(p);
  }

  return (
    <Sheet title={event ? 'Report event' : 'Report host'} note={name} full>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Group title="What’s wrong?">
          {REPORT_REASONS.map((x) => (
            <Row key={x} label={REPORT_REASON_LABELS[x]} picked={x === reason} onPress={() => setReason(x)} />
          ))}
        </Group>
        <Field
          label="Anything to add? (optional)"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={REPORT_NOTE_MAX}
          autoCapitalize="sentences"
        />
        {problem && <Text style={styles.problem}>{problem}</Text>}
        {/* A wide pill brings its own page margins; the sheet already has them. */}
        <View style={styles.bleed}>
          <Pill label={busy ? 'Sending…' : 'Send'} size="wide" disabled={!reason || busy} onPress={() => void send()} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.big },
  bleed: { marginHorizontal: -20 },
  problem: { fontFamily: font.medium, fontSize: 14, color: color.secondary },
});
