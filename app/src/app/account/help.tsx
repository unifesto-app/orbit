// Help and support: answers to what people ask most, written by staff in Galaxy's App content (src/content.ts), then a
// message to Orbit's support queue (the Galaxy flow's support form; a reply comes by push, inbox and email, per the
// Notifications doc).
// ponytail: the message goes nowhere until the API exists.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { EDGE, Group, PAD, Page, Pill, Row } from '../../account/kit';
import { useContent } from '../../content';
import { Glass } from '../../glass';
import { Section } from '../../rows';
import { around, color, font, radius, space } from '../../theme';

export default function Help() {
  const answers = useContent().help;
  const [message, setMessage] = useState('');
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
          maxLength={2000}
        />
      </Glass>
      <View style={styles.send}>
        <Pill label="Send" size="wide" disabled={!message.trim()} />
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
});
