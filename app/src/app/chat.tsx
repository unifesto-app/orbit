// The chat, a full screen over the tabs, opened from the orb beside the tab bar (owner, 19 Nov 2026: "need screen not
// modal for chatbot", "add chat interface"). It opens with the orb's colours spreading from the orb across the whole
// screen, the take the owner picked from https://claude.ai/artifact/MVCwLRogqP8jtw2tFARMW1 ("Wave, Full, 0.5x"): the
// colours roll out from the orb with the chat's 55% Charcoal BAND behind their front, over 3s, and stay behind the
// chat, dimmed and still (owner, 19 Nov 2026: "live movement in bg remove it"). Closing fades the Charcoal and the chat, then draws the colours back into the orb.
// Both are soft discs drawn by scripts/chat-orb.cjs, centred on the orb and scaled up from it: a sweep round its own
// centre looks the same at any scale, so only the soft edge moves, on the native driver. Reduce Motion skips it all.
// The chat: a header with Back on the left and Orbit's name by its orb ("bring header", "instead of cross use back button
// and move left"), Home's glass behind it once the chat scrolls under. Everything in it is a chat bubble ("instead of
// pills, use chat bubbles", "fix the ui of find something and bottom things"): Orbit's welcome on the left, things to ask
// as outlined bubbles on your side that send with a tap, then your messages on the right and Orbit's on the left, each
// with its tail corner. Long-press a message for reactions, double-tap it for a heart ("add reactions to chat", "also
// add double tap"); the one you pick sits on its corner. At the bottom: + for photos ("add attachments"), shown above
// the field until sent, and the field, with the mic while it's empty and Send once there's something to send. The mic
// opens voice mode ("also bring voice chat"), which says it's coming: hearing you needs expo-audio and a rebuild.
// Nothing answers yet ("dont build chatbot"), so Orbit says so, once a message.
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Ellipse, G } from 'react-native-svg';

import { Photo as AccountPhoto } from '../account/profile';
import { BarGlass, Glass, useAccessibility } from '../glass';
import { Icon } from '../icons';
import { SUGGESTIONS } from '../orbitSays';
import { markChatUsed } from '../chatUsed';
import { CircleButton } from '../rows';
import { useSession } from '../session';
import { RINGS } from '../splash/motion';
import { BAR, orbCentre } from '../tabBar';
import { color, font, groundAt, space, stoneAt } from '../theme';

const BAND = 240; // how far the chat's Charcoal follows behind the colours' front
const SOLID = 0.8; // the discs are solid to this much of their radius, then fade out (SOLID in scripts/chat-orb.cjs)
const OPEN_MS = 3000; // the prototype's 1.5s wave at 0.5x
const FADE_MS = 520;
const DRAW_MS = 1300;
const MAX = 500; // characters in a message
const BUTTON = 44; // the back circle (CircleButton)
const HEAD_TOP = 12; // the header's room above and below the back circle (owner, 19 Nov 2026: "add height to header")
const HEAD_BOTTOM = 16;

const DOUBLE_MS = 300; // two taps within this are a double tap
// Orbit's replies don't land whole (owner, 19 Nov 2026: "instead of direct send, add typing effect"): typing dots for
// THINK_MS, then the words typed out TYPE_STEP characters every TYPE_MS.
const THINK_MS = 900;
const TYPE_MS = 24;
const TYPE_STEP = 2;
const ORB = 112; // voice mode's colour orb on the card
// Its round card hugs it like the tab bar's ring round its orb, with room for its breath (owner, 19 Nov 2026: "reduce
// ring size and also card size", "now adjust the card size"; was 260, then 200).
const CARD = ORB + 20;
// The splash's ring radii (screen widths) in the orb's 100 units: the widest stays inside its solid colour (80% of its
// radius, SOLID), even turned.
const RING = 46;
const PHOTOS = 4; // photos in one message
// The + and the field: Charcoal-tinted glass, as the tab bar (owner, 19 Nov 2026: "make it charcoal tintd", then "add
// glass to plus and chat field"); without Liquid Glass, the Charcoal fill with the glass rim.
const FIELD = groundAt(0.6);

const NOT_YET = "I can't answer yet. Chat is coming soon; for now, Search finds events and places near you.";

// The reactions in Orbit's 3D look, each in its own colours (owner, 19 Nov 2026: "in reaction bring 3d symbols",
// "instead of star, plus, peral bring thumbsup and any two useful ones", "adjust sizes and make heart straight and give
// them original colors"): a red heart, yellow thumbs up and down (an answer missed) and fire (something to be excited
// about), all drawn alike by scripts/icons.mjs, so one size fits them all.
const REACTIONS = [
  { key: 'heart', label: 'Love', art: require('../../assets/reactions/heart.png') },
  { key: 'up', label: 'Thumbs up', art: require('../../assets/reactions/thumbsUp.png') },
  { key: 'down', label: 'Thumbs down', art: require('../../assets/reactions/thumbsDown.png') },
  { key: 'fire', label: 'Fire', art: require('../../assets/reactions/fire.png') },
] as const;
type Reaction = (typeof REACTIONS)[number]['key'];

type Photo = { uri: string; width: number; height: number };
// `fresh`: a reply still to be typed out; it's false once typed, so it shows whole if its bubble mounts again.
type Message = { id: number; from: 'you' | 'orbit'; text: string; photos?: Photo[]; fresh?: boolean };
// A held message's frame on screen, for placing the reactions by it.
type Held = { id: number; mine: boolean; x: number; y: number; w: number; h: number };

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const still = useAccessibility('reduceMotionChanged');
  const { x, y } = orbCentre(width, height, insets.bottom, Platform.OS === 'ios');
  // The discs' radius at full size: the Charcoal, BAND inside the colours, still covers the far corner solidly.
  const rim = Math.hypot(x, y) / SOLID + BAND;
  const from = BAR / 2 / rim; // the colours start as big as the orb
  const front = (BAND - BAR / 2) / (rim - BAR / 2); // how far the front has gone when the Charcoal sets off
  const [go] = useState(() => new Animated.Value(0)); // the front, from the orb (0) to past the far corner (1)
  const [shade] = useState(() => new Animated.Value(1)); // the Charcoal's and the chat's opacity, for closing
  const [closing, setClosing] = useState(false);
  // Touchable only once the wave is in and until closing starts: before, the chat is still clear, and a second tap on
  // the orb would land on the mic under it.
  const [live, setLive] = useState(false);
  const [about, setAbout] = useState(false); // the (i)'s card
  const [scrollY] = useState(() => new Animated.Value(0)); // the chat's scroll, for the glass behind the header

  useEffect(() => {
    Animated.timing(go, { toValue: 1, duration: still ? 0 : OPEN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
      ({ finished }) => finished && setLive(true),
    );
  }, [go, still]);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    Keyboard.dismiss(); // the tab bar and its orb hide under a keyboard, and the colours go back into the orb
    const k = still ? 0 : 1;
    Animated.sequence([
      Animated.timing(shade, { toValue: 0, duration: FADE_MS * k, useNativeDriver: true }),
      Animated.timing(go, { toValue: 0, duration: DRAW_MS * k, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]).start(() => (router.canGoBack() ? router.back() : router.replace('/')));
  }, [closing, go, shade, still]);

  // Android's back plays the same way out.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const disc = { left: x - rim, top: y - rim, width: 2 * rim, height: 2 * rim };
  const colours = {
    transform: [
      { scale: go.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) },
    ],
  };
  const charcoal = {
    opacity: shade,
    transform: [{ scale: go.interpolate({ inputRange: [0, front, 1], outputRange: [0.001, 0.001, (rim - BAND) / rim], extrapolate: 'clamp' }) }],
  };
  // The chat comes in as the wave finishes and goes first on the way out.
  const chrome = Animated.multiply(go.interpolate({ inputRange: [0.6, 1], outputRange: [0, 1], extrapolate: 'clamp' }), shade);

  return (
    <View style={styles.screen}>
      <Animated.Image source={require('../../assets/orb-field.png')} style={[styles.disc, disc, colours]} />
      <Animated.Image source={require('../../assets/orb-shade.png')} style={[styles.disc, disc, charcoal]} />
      <Animated.View style={[styles.screen, { opacity: chrome }]} pointerEvents={live && !closing ? 'auto' : 'none'}>
        <Chat
          top={insets.top + HEAD_TOP + BUTTON + HEAD_BOTTOM + space.small}
          bottom={Math.max(insets.bottom, space.small)}
          scrollY={scrollY}
          details={about && !closing}
          onDetailsClose={() => setAbout(false)}
        />
      </Animated.View>
      <Animated.View style={[styles.head, { paddingTop: insets.top + HEAD_TOP, opacity: chrome }]} pointerEvents={live && !closing ? 'auto' : 'none'}>
        <BarGlass scrollY={scrollY} />
        <CircleButton icon="back" label="Back" onPress={close} />
        <Image source={require('../../assets/orb.png')} style={styles.mark} />
        <Text style={styles.name}>Orbit</Text>
        <View style={styles.grow} />
        <CircleButton icon="info" label={about ? 'Close chat info' : 'Chat info'} onPress={() => setAbout((on) => !on)} />
      </Animated.View>
    </View>
  );
}

// The conversation and the message bar, which rises with the keyboard; or voice mode in their place.
function Chat({
  top,
  bottom,
  scrollY,
  details,
  onDetailsClose,
}: {
  top: number;
  bottom: number;
  scrollY: Animated.Value;
  details: boolean;
  onDetailsClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  // A question from another screen (Search's Ask Orbit, src/orbitSays.tsx) arrives typed in the field, for you to send:
  // any link can open the chat, so it never speaks for you without a tap. A repeated param comes as a list.
  const ask = useLocalSearchParams<{ ask?: string | string[] }>().ask;
  const [draft, setDraft] = useState(() => (Array.isArray(ask) ? ask[0] : ask)?.trim().slice(0, MAX) ?? '');
  const [photos, setPhotos] = useState<Photo[]>([]); // picked, not sent yet
  const [note, setNote] = useState(''); // why the photos didn't open
  const [reactions, setReactions] = useState<Record<number, Reaction | undefined>>({});
  const [held, setHeld] = useState<Held | null>(null);
  const [voice, setVoice] = useState(false);
  const nextId = useRef(0);
  const choosing = useRef(false);
  const list = useRef<ComponentRef<typeof ScrollView>>(null);
  const ready = draft.trim() !== '' || photos.length > 0;

  const send = (text: string, sent: Photo[] = []) => {
    const said = text.trim();
    if (!said && sent.length === 0) return;
    markChatUsed(); // the orb's bubble has done its job
    const you: Message = { id: nextId.current++, from: 'you', text: said, photos: sent };
    const orbit: Message = { id: nextId.current++, from: 'orbit', text: NOT_YET, fresh: true };
    setMessages((all) => [...all, you, orbit]);
    setDraft('');
    setPhotos([]);
    setNote('');
  };

  const attach = async () => {
    if (choosing.current || photos.length >= PHOTOS) return;
    choosing.current = true;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: PHOTOS - photos.length,
        quality: 0.8,
      });
      if (!picked.canceled) {
        setPhotos((all) => [...all, ...picked.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, PHOTOS));
        setNote('');
      }
    } catch {
      setNote('Couldn’t open your photos. Try again.');
    } finally {
      choosing.current = false;
    }
  };

  // A reply has finished typing out.
  const typed = useCallback((id: number) => setMessages((all) => all.map((m) => (m.id === id ? { ...m, fresh: false } : m))), []);

  // One reaction a message: picking the one it has takes it off.
  const react = (id: number, key: Reaction) => {
    setReactions((all) => ({ ...all, [id]: all[id] === key ? undefined : key }));
    setHeld(null);
  };

  // A new chat: the conversation, its reactions and anything waiting to send, gone.
  const newChat = () => {
    setMessages([]);
    setReactions({});
    setDraft('');
    setPhotos([]);
    setNote('');
    setHeld(null);
    onDetailsClose();
  };

  const card = details && (
    <Info
      top={top - space.small}
      photos={messages.flatMap((m) => m.photos ?? [])}
      empty={messages.length === 0}
      onNewChat={newChat}
      onDismiss={onDetailsClose}
    />
  );

  if (voice)
    return (
      <View style={styles.screen}>
        <Voice top={top} bottom={bottom} onEnd={() => setVoice(false)} />
        {card}
      </View>
    );

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.ScrollView
          ref={list}
          style={styles.screen}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.list, { paddingTop: top }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        >
          <Welcome onPick={messages.length === 0 ? (s) => send(s, photos) : undefined} />
          {messages.map((m) => (
            <Bubble key={m.id} message={m} reaction={reactions[m.id]} onHold={setHeld} onDouble={(id) => react(id, 'heart')} onTyped={typed} />
          ))}
        </Animated.ScrollView>
        <View style={[styles.foot, { paddingBottom: bottom }]}>
          {photos.length > 0 && (
            <View style={styles.tray}>
              {photos.map((p, i) => (
                <View key={p.uri}>
                  <Image source={{ uri: p.uri }} style={styles.trayPhoto} accessibilityLabel={`Photo ${i + 1}`} />
                  <Pressable
                    onPress={() => setPhotos((all) => all.filter((q) => q.uri !== p.uri))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${i + 1}`}
                    hitSlop={8}
                    style={styles.trayRemove}
                  >
                    <Icon name="close" size={10} color={color.text} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {note !== '' && <Text style={styles.note}>{note}</Text>}
          <View style={styles.row}>
            <Pressable
              onPress={attach}
              disabled={photos.length >= PHOTOS}
              accessibilityRole="button"
              accessibilityLabel="Add photos"
              accessibilityState={{ disabled: photos.length >= PHOTOS }}
            >
              <Glass tint={FIELD} style={styles.round}>
                <Icon name="plus" size={18} color={photos.length >= PHOTOS ? color.secondary : color.text} />
              </Glass>
            </Pressable>
            <Glass tint={FIELD} style={styles.field}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => send(draft, photos)}
                placeholder="Ask about events near you"
                placeholderTextColor={color.secondary}
                selectionColor={color.accent}
                maxLength={MAX}
                returnKeyType="send"
                submitBehavior="submit"
                accessibilityLabel="Message"
                style={styles.input}
              />
              {ready ? (
                <Pressable onPress={() => send(draft, photos)} accessibilityRole="button" accessibilityLabel="Send" style={[styles.inner, styles.sendOn]}>
                  <Icon name="send" size={18} color={color.ground} />
                </Pressable>
              ) : (
                <Pressable onPress={() => setVoice(true)} accessibilityRole="button" accessibilityLabel="Voice chat" style={styles.inner}>
                  <Icon name="mic" size={20} color={color.text} />
                </Pressable>
              )}
            </Glass>
          </View>
        </View>
      </KeyboardAvoidingView>
      {held && <Picker held={held} chosen={reactions[held.id]} minTop={top} onPick={(key) => react(held.id, key)} onDismiss={() => setHeld(null)} />}
      {card}
    </View>
  );
}

// The (i)'s card under the header: what a chat with an assistant needs (owner, 19 Nov 2026: "also add info ( i ) to
// right on header", "its about chat id etc kind thinsg", then "instead, bring what chat actually needs"). Who you're
// talking to, that it can be wrong, the photos you've shared here, a new chat, and privacy and terms (the Legal sheet).
// Over a backdrop that closes it, as the (i) again does.
function Info({
  top,
  photos,
  empty,
  onNewChat,
  onDismiss,
}: {
  top: number;
  photos: Photo[];
  empty: boolean;
  onNewChat: () => void;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  return (
    <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Close chat info">
      <Glass tint={groundAt(0.8)} style={[styles.about, { top, width: Math.min(360, width - 32) }]} accessibilityViewIsModal>
        <View style={styles.who}>
          <Image source={require('../../assets/orb.png')} style={styles.whoMark} />
          <View style={styles.grow}>
            <Text style={styles.welcomeTitle}>Orbit</Text>
            <Text style={styles.aboutLine}>Your guide to events and places near you</Text>
          </View>
        </View>
        <Text style={styles.aboutLine}>Orbit can get things wrong. Check the time and price on the event page before you book.</Text>
        {photos.length > 0 && (
          <View style={styles.shared}>
            <Text style={styles.aboutLabel}>Photos in this chat</Text>
            <View style={styles.sharedPhotos}>
              {photos.map((p, i) => (
                <Image key={p.uri} source={{ uri: p.uri }} style={styles.sharedPhoto} accessibilityLabel={`Photo ${i + 1}`} />
              ))}
            </View>
          </View>
        )}
        <View style={styles.actions}>
          <Pressable
            onPress={onNewChat}
            disabled={empty}
            accessibilityRole="button"
            accessibilityState={{ disabled: empty }}
            style={styles.action}
          >
            <Text style={[styles.actionText, empty && styles.actionOff]}>New chat</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onDismiss();
              router.push('/legal');
            }}
            accessibilityRole="button"
            style={[styles.action, styles.actionLine]}
          >
            <Text style={styles.actionText}>Privacy and terms</Text>
            <Icon name="chevron" size={14} color={color.secondary} />
          </Pressable>
        </View>
      </Glass>
    </Pressable>
  );
}

// Orbit's welcome, the first bubble, and things to ask as outlined bubbles on your side, sent with a tap; they go once
// you've said something (`onPick` unset).
function Welcome({ onPick }: { onPick?: (text: string) => void }) {
  return (
    <>
      <Said mine={false}>
        <View style={[styles.bubble, styles.theirs]}>
          <Text style={styles.welcomeTitle}>Find something to do</Text>
          <Text style={styles.bubbleText}>Ask about events, places to play and hosts near you.</Text>
        </View>
      </Said>
      {onPick && (
        <View style={styles.asks}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => onPick(s)} accessibilityRole="button" style={[styles.bubble, styles.ask]}>
              <Text style={styles.bubbleText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

// A message: yours on the right, Orbit's on the left, with the tail corner on its own side and its reaction, if any,
// on the far top corner. Long-press for reactions, double-tap for a heart.
function Bubble({
  message: m,
  reaction,
  onHold,
  onDouble,
  onTyped,
}: {
  message: Message;
  reaction?: Reaction;
  onHold: (h: Held) => void;
  onDouble: (id: number) => void;
  onTyped: (id: number) => void;
}) {
  const mine = m.from === 'you';
  // A fresh reply: dots first, then its words typed out, then it tells the chat it's done.
  const [thinking, setThinking] = useState(!!m.fresh);
  const [shown, setShown] = useState(m.fresh ? 0 : m.text.length);
  useEffect(() => {
    if (!m.fresh) return;
    let typing: ReturnType<typeof setInterval> | undefined;
    const wait = setTimeout(() => {
      setThinking(false);
      let n = 0;
      typing = setInterval(() => {
        n = Math.min(m.text.length, n + TYPE_STEP);
        setShown(n);
        if (n >= m.text.length) {
          clearInterval(typing);
          onTyped(m.id);
        }
      }, TYPE_MS);
    }, THINK_MS);
    return () => {
      clearTimeout(wait);
      if (typing) clearInterval(typing);
    };
  }, [m.fresh, m.id, m.text, onTyped]);
  const ref = useRef<ComponentRef<typeof View>>(null);
  const lastTap = useRef(0);
  const picked = REACTIONS.find((r) => r.key === reaction);
  const hold = () => ref.current?.measureInWindow((x, y, w, h) => onHold({ id: m.id, mine, x, y, w, h }));
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_MS) {
      lastTap.current = 0;
      onDouble(m.id);
    } else lastTap.current = now;
  };
  const said = m.text || `${m.photos?.length ?? 0} photos`;
  return (
    <Said mine={mine}>
      <Pressable
        ref={ref}
        onPress={tap}
        onLongPress={hold}
        delayLongPress={300}
        accessibilityLabel={picked ? `${said}. ${picked.label}` : said}
        accessibilityHint="Double-tap and hold for reactions"
        accessibilityActions={[{ name: 'react', label: 'React' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'react' && hold()}
        style={[styles.bubble, mine ? styles.mine : styles.theirs]}
      >
        {m.photos && m.photos.length > 0 && (
          <View style={styles.photos}>
            {m.photos.map((p) => (
              <Image key={p.uri} source={{ uri: p.uri }} style={m.photos!.length === 1 ? [styles.photoOne, { aspectRatio: p.width / p.height || 1 }] : styles.photo} />
            ))}
          </View>
        )}
        {thinking ? <Dots /> : m.text !== '' && <Text style={styles.bubbleText}>{m.text.slice(0, shown)}</Text>}
        {picked && (
          <Glass tint={groundAt(0.8)} style={[styles.badge, mine ? styles.badgeMine : styles.badgeTheirs]}>
            <Image source={picked.art} style={styles.badgeArt} accessibilityIgnoresInvertColors />
          </Glass>
        )}
      </Pressable>
    </Said>
  );
}

// Who said it, by the bubble's foot (owner, 19 Nov 2026: "in chatbot add profile. for bot and user"): Orbit's orb on
// the left, your photo (Account's, or your initials) on the right, or the person glyph while you're signed out.
const FACE = 28;
function Said({ mine, children }: { mine: boolean; children: ReactNode }) {
  return (
    <View style={[styles.said, mine ? styles.saidMine : styles.saidTheirs]}>
      {mine ? children : <Image source={require('../../assets/orb.png')} style={styles.face} accessibilityIgnoresInvertColors />}
      {mine ? <You /> : children}
    </View>
  );
}
function You() {
  const me = useSession()?.me;
  return me ? (
    <AccountPhoto me={me} size={FACE - 2} />
  ) : (
    <Glass style={[styles.face, styles.faceEmpty]}>
      <Icon name="user" size={14} color={color.text} />
    </Glass>
  );
}

// Orbit typing: three dots brightening in turn.
function Dots() {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const lit = [
    [1, 0.3, 0.3, 1],
    [0.3, 1, 0.3, 0.3],
    [0.3, 0.3, 1, 0.3],
  ];
  return (
    <View style={styles.dots} accessibilityLabel="Orbit is typing">
      {lit.map((outputRange, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: t.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange }) }]} />
      ))}
    </View>
  );
}

// The reactions, in a glass bar above the held message (below it near the top), over a backdrop that closes them.
const PICK = 40;
const PICK_W = REACTIONS.length * PICK + (REACTIONS.length - 1) * 4 + 8;
function Picker({ held, chosen, minTop, onPick, onDismiss }: { held: Held; chosen?: Reaction; minTop: number; onPick: (key: Reaction) => void; onDismiss: () => void }) {
  const { width } = useWindowDimensions();
  const left = Math.min(Math.max(held.mine ? held.x + held.w - PICK_W : held.x, 16), width - 16 - PICK_W);
  const above = held.y - PICK - 8 - space.small;
  const top = above < minTop ? held.y + held.h + space.small : above;
  return (
    <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Close reactions">
      <Glass tint={groundAt(0.8)} style={[styles.picker, { left, top }]}>
        {REACTIONS.map((r) => (
          <Pressable
            key={r.key}
            onPress={() => onPick(r.key)}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityState={{ selected: chosen === r.key }}
            style={[styles.pick, chosen === r.key && styles.pickOn]}
          >
            <Image source={r.art} style={styles.pickArt} accessibilityIgnoresInvertColors />
          </Pressable>
        ))}
      </Glass>
    </Pressable>
  );
}

// Voice mode: the colours as a breathing orb on a round Charcoal-tinted glass card like the tab bar's orb, the splash's
// orbits round it (owner, 19 Nov 2026: "add charcoal tinted glass card to glyph", "add orbits too", "rounded same as in
// tab nav"). It can't hear you yet, and says so.
function Voice({ top, bottom, onEnd }: { top: number; bottom: number; onEnd: () => void }) {
  const still = useAccessibility('reduceMotionChanged');
  const [beat] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (still) return;
    // 3s in, 3s out: a calm breath (owner, 19 Nov 2026: "make the voice orb breathe slower", from 1.6s).
    const breathe = (toValue: number) => Animated.timing(beat, { toValue, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([breathe(1), breathe(0)]));
    loop.start();
    return () => loop.stop();
  }, [beat, still]);
  return (
    <View style={[styles.voice, { paddingTop: top, paddingBottom: bottom }]}>
      <View style={styles.voiceMiddle}>
        <Glass tint={groundAt(0.6)} style={styles.voiceCard}>
          {/* The orbits on the orb itself, breathing with it (owner, 19 Nov 2026: "orbits inside the orb only"). */}
          <Animated.View style={[styles.voiceOrb, { transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }]}>
            <Image source={require('../../assets/orb-field.png')} style={styles.voiceOrb} accessibilityIgnoresInvertColors />
            <Svg width={ORB} height={ORB} viewBox="0 0 100 100" style={styles.voiceRings}>
              <G fill="none" stroke={color.text} strokeWidth={1}>
                {RINGS.map((g) => (
                  <Ellipse
                    key={g.turn}
                    cx={50}
                    cy={50}
                    rx={g.r * RING}
                    ry={g.r * RING * Math.cos((g.tilt * Math.PI) / 180)}
                    rotation={g.turn}
                    originX={50}
                    originY={50}
                    strokeOpacity={g.opacity + 0.15}
                  />
                ))}
              </G>
            </Svg>
          </Animated.View>
        </Glass>
        <Text style={styles.welcomeTitle}>Voice chat</Text>
        <Text style={[styles.bubbleText, styles.voiceLine]}>Talking with Orbit is coming soon. Type for now.</Text>
      </View>
      <Pressable onPress={onEnd} accessibilityRole="button" style={styles.end}>
        <Text style={styles.endText}>Back to typing</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  disc: { position: 'absolute' },
  head: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: HEAD_BOTTOM, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 28, height: 28, borderRadius: 14, marginLeft: 2 },
  name: { fontFamily: font.title, fontSize: 17, color: color.text },
  grow: { flex: 1 },
  about: { position: 'absolute', right: 16, padding: 16, gap: space.small, borderRadius: 22 },
  aboutLine: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.secondary },
  aboutLabel: { fontFamily: font.medium, fontSize: 13, color: color.secondary },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whoMark: { width: 40, height: 40, borderRadius: 20 },
  shared: { gap: space.small },
  sharedPhotos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sharedPhoto: { width: 52, height: 52, borderRadius: 10 },
  actions: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: stoneAt(0.12), overflow: 'hidden' },
  action: { minHeight: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: stoneAt(0.08) },
  actionText: { fontFamily: font.medium, fontSize: 15, color: color.text },
  actionOff: { color: color.secondary },
  list: { paddingHorizontal: 16, paddingBottom: space.big, gap: 12, flexGrow: 1, justifyContent: 'flex-end' },
  // Bubbles: 20 round with a 6 tail corner on the speaker's side (the app's corner), yours lighter, Orbit's Charcoal.
  bubble: {
    flexShrink: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  mine: { borderBottomRightRadius: 6, backgroundColor: stoneAt(0.14), borderColor: stoneAt(0.24) },
  theirs: { borderBottomLeftRadius: 6, backgroundColor: groundAt(0.6), borderColor: stoneAt(0.12) },
  ask: { alignSelf: 'flex-end', maxWidth: '80%', borderBottomRightRadius: 6, borderColor: stoneAt(0.32) },
  asks: { gap: space.small, alignItems: 'flex-end', paddingRight: FACE + space.small }, // in line with your bubbles
  // A bubble and its speaker's face, the face at the bubble's foot.
  said: { flexDirection: 'row', alignItems: 'flex-end', gap: space.small, maxWidth: '88%' },
  saidMine: { alignSelf: 'flex-end' },
  saidTheirs: { alignSelf: 'flex-start' },
  face: { width: FACE, height: FACE, borderRadius: FACE / 2 },
  faceEmpty: { alignItems: 'center', justifyContent: 'center' },
  bubbleText: { fontFamily: font.text, fontSize: 16, lineHeight: 22, color: color.text },
  dots: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: color.text },
  welcomeTitle: { fontFamily: font.title, fontSize: 18, lineHeight: 24, color: color.text },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginHorizontal: -8, marginTop: -4 },
  photo: { width: 104, height: 104, borderRadius: 14 },
  photoOne: { width: 216, borderRadius: 14 },
  badge: { position: 'absolute', top: -10, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  badgeMine: { left: -10 },
  badgeTheirs: { right: -10 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: groundAt(0.3) },
  picker: { position: 'absolute', height: PICK + 8, padding: 4, gap: 4, borderRadius: (PICK + 8) / 2, flexDirection: 'row' },
  pick: { width: PICK, height: PICK, borderRadius: PICK / 2, alignItems: 'center', justifyContent: 'center' },
  pickOn: { backgroundColor: stoneAt(0.14) },
  pickArt: { width: 32, height: 32 }, // each PNG is padded for its shadow, so the glyph shows about 20pt
  badgeArt: { width: 20, height: 20 },
  // The bottom: photos waiting to go, then + and the field on one row.
  foot: { paddingHorizontal: 16, paddingTop: space.small, gap: space.small },
  tray: { flexDirection: 'row', gap: space.small, paddingLeft: BAR + space.small },
  trayPhoto: { width: 56, height: 56, borderRadius: 12 },
  trayRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: stoneAt(0.24),
  },
  note: { fontFamily: font.text, fontSize: 13, color: color.secondary, paddingLeft: BAR + space.small },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  round: { width: BAR, height: BAR, borderRadius: BAR / 2, alignItems: 'center', justifyContent: 'center' },
  field: { flex: 1, height: BAR, borderRadius: BAR / 2, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 4 },
  input: { flex: 1, height: BAR, fontFamily: font.text, fontSize: 16, color: color.text },
  inner: { width: BAR - 8, height: BAR - 8, borderRadius: (BAR - 8) / 2, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: color.text },
  voice: { flex: 1, paddingHorizontal: 16, alignItems: 'center' },
  voiceMiddle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.small },
  voiceCard: { width: CARD, height: CARD, borderRadius: CARD / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: space.big },
  voiceOrb: { width: ORB, height: ORB },
  voiceRings: { position: 'absolute', top: 0, left: 0 },
  voiceLine: { color: color.secondary, textAlign: 'center' },
  end: {
    height: BAR,
    paddingHorizontal: 24,
    borderRadius: BAR / 2,
    justifyContent: 'center',
    backgroundColor: groundAt(0.6),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: stoneAt(0.24),
  },
  endText: { fontFamily: font.medium, fontSize: 15, color: color.text },
});
