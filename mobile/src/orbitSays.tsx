// Orbit talking on a page, as it does in the chat (owner, 19 Nov 2026: "Both" from the Home and Search mockup, its
// Orbit speaks take): the orb beside Orbit's bubble on the left, then your answers as outlined bubbles on your side,
// sent with a tap. Home's Thanks for coming, What do you like? and location notices, and Search's Ask Orbit and
// Nothing here yet. The bubbles are the chat's (src/app/chat.tsx): 20 round with the 6 tail corner on the speaker's
// side, Orbit's Charcoal, yours lighter, answers outlined. Shared with the host apps (Orbit Station's Today) since 22 Nov
// 2026; askOrbit, which opens the people app's chat, stays in app/src/orbitSays.tsx.
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font, groundAt, space, stoneAt } from './theme';

/** Orbit's orb: the gradient disc with the splash's orbits (app/scripts/chat-orb.cjs), for every app's own use. */
export const ORB = require('../assets/orb.png');

// `picked` makes an answer a choice that stays (an interest), with the accent's dot when on.
export type Answer = { label: string; onPress: () => void; picked?: boolean };

// `then` is what was said since: your answer and Orbit's reply (Loved it). `top` is the gap above it.
export function OrbitSays({
  title,
  text,
  answers = [],
  then,
  top = space.big,
}: {
  title?: string; // none for a single line, as the push ask (src/push.tsx)
  text: string;
  answers?: Answer[];
  then?: { mine: string; reply: string };
  top?: number;
}) {
  return (
    <View style={[styles.says, { marginTop: top }]}>
      <Said>
        {title && <Text style={styles.title}>{title}</Text>}
        <Text style={styles.text}>{text}</Text>
      </Said>
      {then && (
        <>
          <View style={[styles.bubble, styles.mine]}>
            <Text style={styles.text}>{then.mine}</Text>
          </View>
          <Said>
            <Text style={styles.text}>{then.reply}</Text>
          </Said>
        </>
      )}
      {answers.length > 0 && (
        <View style={styles.answers}>
          {answers.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              accessibilityRole="button"
              accessibilityState={a.picked === undefined ? undefined : { selected: a.picked }}
              hitSlop={4} // a 38pt bubble, 46 to the finger
              style={({ pressed }) => [styles.bubble, styles.answer, pressed && styles.pressed]}>
              {a.picked && <View style={styles.dot} />}
              <Text style={styles.answerText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// One of Orbit's bubbles, the orb at its foot.
function Said({ children }: { children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Image source={ORB} style={styles.orb} accessible accessibilityRole="image" accessibilityLabel="Orbit" />
      <View style={[styles.bubble, styles.theirs]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // On the 20 margins, `top` below what's above it.
  says: { marginHorizontal: 20, gap: space.small },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.small },
  orb: { width: 28, height: 28, borderRadius: 14 },
  bubble: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  theirs: { borderBottomLeftRadius: 6, backgroundColor: groundAt(0.6), borderColor: stoneAt(0.12) },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6, backgroundColor: stoneAt(0.14), borderColor: stoneAt(0.24) },
  answers: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space.small },
  answer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomRightRadius: 6, borderColor: stoneAt(0.32) },
  pressed: { opacity: 0.7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  title: { fontFamily: font.title, fontSize: 18, lineHeight: 24, color: color.text },
  text: { fontFamily: font.text, fontSize: 16, lineHeight: 22, color: color.text },
  answerText: { fontFamily: font.text, fontSize: 15, lineHeight: 20, color: color.text },
});
