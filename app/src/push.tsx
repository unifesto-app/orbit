// Push (Notifications doc: Channels, "Push permission and devices"), straight to Apple and Google through
// expo-notifications, a native module added 19 Nov 2026 (owner: "Yes, add it"). On a build made before it, the module
// isn't there: everything here then does nothing and the inbox still fills, as session.ts does with expo-secure-store.
// - The ask: once per install, at the first moment it obviously helps, with one line saying why, never at launch or
//   sign-up. That moment's screen shows Orbit's line (PushAsk) with Yes and Not now; Yes brings up the phone's own
//   prompt. Whichever moment is answered first asks and the rest don't (one left unanswered lets the next one ask);
//   after that, Account › Notifications' Push switch is the way back.
// - The device token, read once push is allowed: at the ask, at each launch, and whenever it rolls.
// - A tap on a push opens its own screen and marks its inbox message read; the app icon's number is the unread count.
// ponytail: the token stays on the phone until the API takes it (PM P20.3); Android also needs the FCM project (P20.8).
import { type Href, router } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Linking, Platform } from 'react-native';

import { inAppPath, type PushStatus, pushStatusOf } from './inbox';
import { useUnreadCount } from './inboxStore';
import { OrbitSays } from './orbitSays';
import { markRead, useSignedIn } from './session';

export type { PushStatus };

type Notifications = typeof import('expo-notifications');
let N: Notifications | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: a static import throws on a build without it
  N = require('expo-notifications');
} catch {
  N = null;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!N) return 'none';
  try {
    const p = await N.getPermissionsAsync();
    return pushStatusOf({ ...p, provisional: p.ios?.status === N.IosAuthorizationStatus.PROVISIONAL }, Platform.OS);
  } catch {
    return 'none';
  }
}

// Push turned off in the phone's settings comes back only there (Notifications doc: the Push switch "opens the
// phone's settings when push is blocked there").
export const openPushSettings = () => Linking.openSettings();

// Whether this install has had its one ask, kept with the phone rather than the account, so signing out and in again
// never asks twice.
const ASKED = 'orbit.pushAsked';
const askedHere = () => {
  try {
    return Storage.getItemSync(ASKED) === '1';
  } catch {
    return false;
  }
};
const markAsked = () => {
  try {
    Storage.setItemSync(ASKED, '1');
  } catch {
    // unreadable storage: it may ask once more another day
  }
};

let token: string | null = null; // this install's APNs or FCM token
export const pushToken = () => token;

// Android shows nothing, and from Android 13 never asks, until a channel exists.
async function channel() {
  if (N && Platform.OS === 'android') await N.setNotificationChannelAsync('default', { name: 'Orbit', importance: N.AndroidImportance.HIGH });
}
async function register() {
  if (!N) return;
  try {
    await channel();
    token = (await N.getDevicePushTokenAsync()).data;
  } catch {
    token = null; // Android without the FCM project yet, or no network: tried again next launch
  }
}
// The phone's own prompt, then the token if allowed. True when push is on.
async function prompt() {
  if (!N) return false;
  try {
    await channel(); // before the prompt, or Android 13 never shows it
    const p = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
    if (p.granted) await register();
    return p.granted;
  } catch {
    return false;
  }
}

// The moment asking right now, and the moments whose screen is showing a PushAsk.
let offer: string | null = null;
const shown = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// A moment that may ask happened: it asks if its screen is still showing, nothing has asked on this install before,
// and the phone's prompt can still come up.
export async function offerPush(moment: string) {
  if (!N || offer || askedHere()) return;
  const status = await pushStatus();
  if (status !== 'ask' || offer || askedHere() || !shown.has(moment)) return; // checked again: time passed
  offer = moment;
  emit();
}

// Yes or Not now. Either way nothing asks again on this install; Yes brings up the phone's prompt. A tap that already
// says what it wants (Hear if it frees up) calls this with yes at once.
export async function answerPush(yes: boolean) {
  offer = null;
  emit();
  if (!N || askedHere()) return;
  markAsked();
  if (yes && (await pushStatus()) === 'ask') await prompt();
}

// The Push switch in Account › Notifications, when the phone's prompt can still come up: it asks at once.
export async function askPushFromSettings() {
  markAsked();
  return prompt();
}

// Orbit's one line at the moment that asked, with Yes and Not now: Orbit's chat bubble, as the prototype the owner
// picked from drew it. Nothing shows for any other moment, or once answered; leaving the screen unanswered lets the
// next moment ask instead.
export function PushAsk({ moment, line, top }: { moment: string; line: string; top?: number }) {
  const asking = useSyncExternalStore(subscribe, () => offer === moment);
  useEffect(() => {
    shown.add(moment);
    return () => {
      shown.delete(moment);
      if (offer === moment) {
        offer = null;
        emit();
      }
    };
  }, [moment]);
  if (!asking) return null;
  return (
    <OrbitSays
      text={line}
      top={top}
      answers={[
        { label: 'Yes', onPress: () => void answerPush(true) },
        { label: 'Not now', onPress: () => void answerPush(false) },
      ]}
    />
  );
}

// A push's data names its inbox message (`id`) and the screen it opens (`href`, the inbox's own rule, src/inbox.ts).
// Only a path inside the app is followed (inAppPath), and each push opens once.
let opened: string | null = null;
function openPush(n: import('expo-notifications').Notification) {
  if (n.request.identifier === opened) return;
  opened = n.request.identifier;
  const { id, href } = (n.request.content.data ?? {}) as { id?: unknown; href?: unknown };
  if (typeof id === 'string') markRead([id]);
  if (inAppPath(href)) router.push(href as Href);
}

// Mount once at the root, with the screens (src/app/_layout.tsx): banners while the app is open, a tapped push opens
// its screen (the one that launched the app too), the token at launch, and the app icon's number.
export function PushHost() {
  const signedIn = useSignedIn();
  const unread = useUnreadCount();
  useEffect(() => {
    if (!N) return;
    const n = N;
    // The app keeps the icon's number itself (below), so a push's own badge never fights it.
    n.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const tapped = n.addNotificationResponseReceivedListener((r) => openPush(r.notification));
    try {
      const launched = n.getLastNotificationResponse();
      if (launched) openPush(launched.notification);
      n.clearLastNotificationResponse();
    } catch {
      // nothing launched the app
    }
    const rolled = n.addPushTokenListener((t) => {
      token = t.data;
    });
    void pushStatus().then((s) => (s === 'on' ? register() : undefined));
    return () => {
      tapped.remove();
      rolled.remove();
    };
  }, []);
  // The app badge counts what the inbox shows unread (Notifications doc); a signed-out phone shows none.
  // ponytail: the mock inbox's count until the API's inbox lands.
  useEffect(() => {
    N?.setBadgeCountAsync(signedIn ? unread : 0).catch(() => {});
  }, [signedIn, unread]);
  return null;
}
