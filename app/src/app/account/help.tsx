// Help and support: answers to what people ask most, from the flow docs, then a message to Orbit's support queue (the
// Galaxy flow's support form; a reply comes by push, inbox and email, per the Notifications doc).
// ponytail: the message goes nowhere until the API exists.
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { EDGE, Group, PAD, Page, Pill, Row } from '../../account/kit';
import { Glass } from '../../glass';
import { Section } from '../../rows';
import { around, color, font, radius, space } from '../../theme';

const ANSWERS = [
  ['Where’s my ticket?', 'In Account › Tickets, and in the email and WhatsApp message from when you booked. It works offline at the door.'],
  ['How do refunds work?', 'Ask from the ticket. The host decides until their cut-off, then Orbit does. Banks take 5 to 7 working days once it’s sent.'],
  ['I have a new phone number', 'Change it in Sign-in and security with a code sent to the new number. Lost the old SIM? Sign in another way first.'],
  ['Deleting my account', 'Account › Delete account. Every device signs out, and you have 30 days to change your mind.'],
] as const;

export default function Help() {
  const [message, setMessage] = useState('');
  // Questions only, each answer opening under it on a tap (owner, 15 Nov 2026: "keep only titles remove all
  // descriptions").
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Page title="Help and support">
      <Group>
        {ANSWERS.map(([q, a]) => (
          <Row key={q} label={q} note={open === q ? a : undefined} onPress={() => setOpen(open === q ? null : q)} />
        ))}
      </Group>

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
