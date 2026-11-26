// The host apps' inbox and push, the pure parts (Notifications PR 5), so notices.test.ts runs them on Node. Every call
// names the app (`thisApp.word`): the API keeps one inbox per app (api/src/me-notifications.ts).
import type { Variant } from '../variants.ts';

export const inboxPath = (app: Variant) => `/me/inbox?app=${app}`;
// No ids: the whole inbox.
export const readBody = (app: Variant, ids?: readonly string[]) => ({ app, ...(ids && { ids }) });

// Where a tapped push goes. A push's `opens` is the inbox's Opens shape; on Android FCM data values are strings, so it
// may come as JSON text. Event Partner opens its Event Request on `{to: 'request'}`, Play Partner its Today on
// `{to: 'today', host}` (slotBooked, slotCancelled), on that venue's seat (Today switches to it); anything else (most
// host kinds open nothing) opens the Inbox.
export function pushHref(app: Variant, opens: unknown): string {
  let o = opens;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      o = null;
    }
  }
  const { to, host } = o && typeof o === 'object' ? (o as { to?: unknown; host?: unknown }) : {};
  if (app === 'launch' && to === 'request') return '/request';
  if (app === 'station' && to === 'today') return typeof host === 'string' && host ? `/today?host=${encodeURIComponent(host)}` : '/today';
  return '/inbox';
}
