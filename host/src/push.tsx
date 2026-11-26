// Push for the three host apps (Notifications PR 5), straight to Apple and Google through expo-notifications, the
// people app's way (app/src/push.tsx), with `app` = this app's word on every call. Copied, not shared: the people app's
// module is woven through its own session, inbox store, storage and ask moments, and pulling those out would change it.
// On a build made before the module, everything here does nothing and the inbox still fills.
// - The ask: once per install, on the first screen a signed-in person reaches (Event Partner's Events, Play Partner's
//   Today, Crew's screen), Orbit's line with Yes and Not now; Yes brings up the phone's own prompt. Leaving the screen
//   unanswered lets it ask the next time.
// - The device token, read once push is allowed: at the ask, at each launch, and whenever it rolls; sent to the API
//   (PUT /me/push-device) once per account and token a launch. Signing out sends nothing: the device row goes with the
//   session on the API.
// - A tap on a push marks its inbox message read and opens the Event Request (Event Partner, `{to: 'request'}`) or the
//   Inbox; the app icon's number is the inbox's unread count. Android also needs google-services.json (app.config.ts).
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { type Href, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { refreshInbox, markRead, useInbox } from './launch/inboxStore';
import { pushHref } from './notices';
import { api, kept, PUSH_ASKED, useSession } from './session';
import { thisApp } from './variant';

type Notifications = typeof import('expo-notifications');
let N: Notifications | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: a static import throws on a build without it
  N = require('expo-notifications');
} catch {
  N = null;
}

const app = thisApp.word;

// Whether the phone's prompt can still come up, push is on, or neither.
async function pushStatus(): Promise<'on' | 'ask' | 'off'> {
  if (!N) return 'off';
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted || p.ios?.status === N.IosAuthorizationStatus.PROVISIONAL) return 'on';
    return p.canAskAgain ? 'ask' : 'off';
  } catch {
    return 'off';
  }
}

let me: string | null = null; // the account signed in, as PushHost last saw it
let token: string | null = null; // this install's APNs or FCM token
let sent: { me: string; token: string } | null = null; // as the API last took it
// ponytail: __DEV__ picks the APNs environment, as the people app does; a dev-client build is on sandbox.
const ENV = __DEV__ ? 'sandbox' : 'production';
function sendToken() {
  if (!me || !token || (sent?.me === me && sent.token === token) || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  const mine = { me, token };
  sent = mine; // claimed now, so a second call meanwhile doesn't send it twice
  void api.authed<null>('PUT', '/me/push-device', { app, platform: Platform.OS, env: ENV, token }).then((r) => {
    if (!r.ok && sent === mine) sent = null; // tried again at the next launch, sign-in or roll
  });
}

// Android shows nothing, and from Android 13 never asks, until a channel exists.
async function channel() {
  if (N && Platform.OS === 'android') await N.setNotificationChannelAsync('default', { name: thisApp.name, importance: N.AndroidImportance.HIGH });
}
async function register() {
  if (!N) return;
  try {
    await channel();
    token = (await N.getDevicePushTokenAsync()).data;
    sendToken();
  } catch {
    token = null; // Android without the FCM project yet, or no network: tried again next launch
  }
}

// Orbit's one line on the first signed-in screen, with Yes and Not now, once per install. Either answer ends the ask.
export function PushAsk() {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    let live = true;
    if (N && kept.get(PUSH_ASKED) !== '1') void pushStatus().then((s) => live && setAsking(s === 'ask'));
    return () => {
      live = false;
    };
  }, []);
  if (!asking) return null;
  const answer = async (yes: boolean) => {
    setAsking(false);
    kept.set(PUSH_ASKED, '1');
    if (!yes || !N) return;
    try {
      await channel(); // before the prompt, or Android 13 never shows it
      const p = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
      if (p.granted) await register();
    } catch {
      // no prompt: Settings is the way back
    }
  };
  return (
    <OrbitSays
      text="Turn on notifications to hear about team invites, bookings and your shifts."
      answers={[
        { label: 'Yes', onPress: () => void answer(true) },
        { label: 'Not now', onPress: () => void answer(false) },
      ]}
    />
  );
}

// A push's data names its inbox message (`id`) and what it opens (`opens`); each push opens once.
let opened: string | null = null;
function openPush(n: import('expo-notifications').Notification) {
  if (n.request.identifier === opened) return;
  opened = n.request.identifier;
  const { id, opens } = (n.request.content.data ?? {}) as { id?: unknown; opens?: unknown };
  if (typeof id === 'string' && id) markRead([id]);
  router.push(pushHref(app, opens) as Href);
}

// Mount once at the root (src/app/_layout.tsx): banners while the app is open, a tapped push opens its screen (the one
// that launched the app too), the token at launch, the inbox at sign-in and coming back, and the app icon's number.
export function PushHost() {
  const session = useSession();
  const id = session?.me.id ?? null;
  const { unread } = useInbox();
  // First, so a push that launched the app knows who's signed in. Signed in: the token goes to the API for this
  // account, and the inbox is read, and again whenever the app comes back to the front. Signed out, nothing is sent and
  // the last send is forgotten.
  useEffect(() => {
    me = id;
    if (!id) {
      sent = null;
      return;
    }
    sendToken();
    void refreshInbox(id);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refreshInbox(id));
    return () => sub.remove();
  }, [id]);
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
      sendToken();
    });
    // A push that lands while the app is open is already in the inbox: read it again for the button and the number.
    const landed = n.addNotificationReceivedListener(() => me && void refreshInbox(me));
    void pushStatus().then((s) => (s === 'on' ? register() : undefined));
    return () => {
      tapped.remove();
      rolled.remove();
      landed.remove();
    };
  }, []);
  useEffect(() => {
    N?.setBadgeCountAsync(id ? unread : 0).catch(() => {});
  }, [id, unread]);
  return null;
}
