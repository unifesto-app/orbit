// The note at the bottom of the screen after a save or an unsave (Saved events and lists doc): "Saved" with Add to a
// list for about 4 seconds, Undo for 5. With a screen reader on (or, on Android, any accessibility service, which
// covers Switch Access) it's announced and stays until closed, so nobody loses Undo to a timer. One at a time: a new
// note replaces the last. Mount NoteHost once, at the root (src/app/_layout.tsx).
// On iOS it's drawn in a window of its own over everything, sheets included (react-native-screens' FullWindowOverlay,
// already in the app, so no rebuild), and only while a note shows; not modal, so VoiceOver still reaches the screen.
// ponytail: iOS Switch Control isn't exposed to React Native, so it gets the timer; a native check needs a rebuild.
import { useEffect, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { Glass } from './glass';
import { Icon } from './icons';
import { color, font, space } from './theme';

export type Note = { text: string; action?: { label: string; run: () => void }; ms?: number };

let shown: Note | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let assisted = false; // kept current by NoteHost
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = (next: Note | null) => {
  shown = next;
  for (const fn of listeners) fn();
};

export function showNote(note: Note) {
  clearTimeout(timer);
  emit(note);
  AccessibilityInfo.announceForAccessibility(note.action ? `${note.text}. ${note.action.label}.` : note.text);
  if (!assisted) timer = setTimeout(() => emit(null), note.ms ?? 4000);
}
export function hideNote() {
  clearTimeout(timer);
  emit(null);
}

// Above the tab bar and the event page's ticket pill, so it never covers them.
const LIFT = 96;
const BUTTON = 32;
const PAD = space.small;

export function NoteHost() {
  const note = useSyncExternalStore(subscribe, () => shown);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const android = Platform.OS === 'android';
    void (android ? AccessibilityInfo.isAccessibilityServiceEnabled() : AccessibilityInfo.isScreenReaderEnabled()).then((on) => (assisted = on));
    const sub = AccessibilityInfo.addEventListener(android ? 'accessibilityServiceChanged' : 'screenReaderChanged', (on: boolean) => (assisted = on));
    return () => sub.remove();
  }, []);
  if (!note) return null;

  const body = (
    <View style={[styles.place, { bottom: insets.bottom + LIFT }]} pointerEvents="box-none">
      <View style={styles.note}>
        <Glass style={styles.fill} />
        <View style={[styles.fill, styles.shade]} />
        <Text style={styles.text} numberOfLines={2}>
          {note.text}
        </Text>
        {note.action && (
          <Pressable
            onPress={() => {
              hideNote();
              note.action?.run();
            }}
            accessibilityRole="button"
            hitSlop={6}>
            <Glass style={styles.button}>
              <Text style={styles.buttonText}>{note.action.label}</Text>
            </Glass>
          </Pressable>
        )}
        {/* With assistive tech on there's no timer, so it closes here. */}
        {assisted && (
          <Pressable onPress={hideNote} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
            <Glass style={styles.close}>
              <Icon name="close" size={14} color={color.text} />
            </Glass>
          </Pressable>
        )}
      </View>
    </View>
  );
  return Platform.OS === 'ios' ? <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>{body}</FullWindowOverlay> : body;
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: 20, right: 20 },
  // A frosted pill like the ticket bar, darkened so its white text reads over anything; corners nest round its button.
  note: { minHeight: BUTTON + 2 * PAD, padding: PAD, flexDirection: 'row', alignItems: 'center', gap: space.small },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BUTTON / 2 + PAD },
  shade: { backgroundColor: `${color.ground}80` },
  text: { flex: 1, paddingLeft: 12, fontFamily: font.medium, fontSize: 14, color: color.text },
  button: { height: BUTTON, paddingHorizontal: 14, borderRadius: BUTTON / 2, justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 13, color: color.text },
  close: { width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, alignItems: 'center', justifyContent: 'center' },
});
