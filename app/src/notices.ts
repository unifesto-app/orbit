// Notifications from the Orbit API (api/src/me-notifications.ts, build plan PR 2): the inbox, its read state, the
// person's settings, this phone's push token and each followed host's All or Off. Pure, so notices.test.ts runs it on
// Node; the store is src/inboxStore.ts, the screens src/app/inbox.tsx and src/app/account/notifications.tsx.
import { type InboxPage, type InboxRow, type InboxType, KINDS, type NotificationSettings, type NotificationSettingsBody, type PushDevice, type SwitchKey } from '@orbit/contract';

import type { makeApi } from './api.ts';
import { hrefFor, inAppPath, type InboxItem, type Opens } from './inbox.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'authed'>;
export const noticesApi = (api: Api) => ({
  inbox: (before?: string) => api.authed<InboxPage>('GET', `/me/inbox?app=orbit${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  // No ids: the whole inbox.
  read: (ids?: readonly string[]) => api.authed<null>('POST', '/me/inbox/read', { app: 'orbit', ...(ids && { ids }) }),
  settings: () => api.authed<NotificationSettings>('GET', '/me/notification-settings'),
  saveSettings: (patch: NotificationSettingsBody) => api.authed<NotificationSettings>('PUT', '/me/notification-settings', patch),
  device: (body: PushDevice) => api.authed<null>('PUT', '/me/push-device', body),
  hostNotify: (hostId: string, notify: 'all' | 'off') => api.authed<null>('PUT', `/me/follows/${hostId}/notify`, { notify }),
});

// What a row says it is, above its text. A kind with no line of its own takes its type's.
const BY_TYPE: Record<InboxType, string> = {
  announcement: 'Announcement',
  reminder: 'Reminder',
  follow: 'New event',
  near: 'Near you',
  ticket: 'Ticket',
  refund: 'Refund',
  inRoom: 'inRoom',
  thanks: 'Thanks for coming',
  account: 'Account',
};
const BY_KIND: Partial<Record<keyof typeof KINDS, string>> = {
  signInMethodChanged: 'Sign-in',
  deletionScheduled: 'Account deletion',
  deletionCancelled: 'Account deletion',
  deletionBlocked: 'Account deletion',
  accountDeleted: 'Account deletion',
  teamInvite: 'Team invite',
  supportReply: 'Support',
  dataExportReady: 'Your data',
  bookingConfirmed: 'You’re going',
  paymentReceipt: 'Receipt',
  paymentFailed: 'Payment failed',
  refundSent: 'Refund sent',
  refundApproved: 'Refund approved',
  refundDeclined: 'Refund declined',
  refundFailed: 'Refund failed',
  bookingCancelled: 'Booking cancelled',
  eventTomorrow: 'Tomorrow',
  eventStartingSoon: 'Starting soon',
  eventChanged: 'Event changed',
  eventCancelled: 'Event cancelled',
  savedEventOpens: 'Booking opens',
  orbitNews: 'From Orbit',
  orbitNotice: 'From Orbit',
};
const TYPES = Object.keys(BY_TYPE) as InboxType[];
const isType = (t: unknown): t is InboxType => TYPES.includes(t as InboxType);

export type Message = InboxItem & { unread: boolean; href: string | null };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
// `opens` is unknown on the wire: only the shapes hrefFor knows pass, anything else is null (the row shows its whole text).
export function opensOf(v: unknown): Opens {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o.to) {
    case 'ticket':
    case 'refund':
    case 'event':
    case 'book':
    case 'room':
      return str(o.event) ? { to: o.to, event: o.event } : null;
    case 'slot':
      return str(o.venue) ? { to: 'slot', venue: o.venue } : null;
    case 'host':
      return str(o.host) ? { to: 'host', host: o.host } : null;
    case 'refunds':
    case 'security':
    case 'help':
    case 'request':
      return { to: o.to };
    default:
      return null;
  }
}
const pictureOf = (v: unknown): InboxItem['picture'] => {
  const p = v as Record<string, unknown> | null;
  return p && typeof p === 'object' ? (str(p.event) ? { event: p.event } : str(p.host) ? { host: p.host } : null) : null;
};

// An API row as the inbox draws it. A kind this build doesn't know (a newer API) still shows, with its type's label or
// a plain one.
export function toMessage(row: InboxRow, ticketOf: (eventId: string) => string | undefined): Message {
  const def = (KINDS as Record<string, { type: InboxType } | undefined>)[row.kind];
  const type = def?.type ?? (isType(row.type) ? row.type : 'account');
  const opens = opensOf(row.opens);
  const href = hrefFor(opens, ticketOf);
  return {
    id: row.id,
    at: row.at,
    from: row.from,
    kind: BY_KIND[row.kind] ?? (def || isType(row.type) ? BY_TYPE[type] : 'Notification'),
    type,
    text: row.text,
    picture: pictureOf(row.picture),
    opens,
    read: row.read,
    unread: !row.read,
    href: inAppPath(href) ? href : null,
  };
}

// A refresh of the first page keeps the older pages already read in (newest first): the page, then whatever was loaded
// older than its last row. With no page after it, the page is the whole inbox.
export function mergeFirst(had: readonly InboxRow[], hadNext: string | null, page: InboxPage): { items: InboxRow[]; next: string | null } {
  const last = page.items.at(-1);
  if (!page.next || !last) return { items: page.items, next: page.next };
  const ids = new Set(page.items.map((x) => x.id));
  const older = had.filter((x) => !ids.has(x.id) && (x.at < last.at || (x.at === last.at && x.id < last.id)));
  return older.length ? { items: [...page.items, ...older], next: hadNext } : { items: page.items, next: page.next };
}

// The host's newest announcement for an event, shown on top of its ticket.
export const announcementOf = <T extends Pick<InboxRow, 'kind' | 'at' | 'opens'>>(rows: readonly T[], eventId: string) =>
  rows
    .filter((x) => {
      const o = opensOf(x.opens);
      return x.kind === 'hostAnnouncement' && !!o && 'event' in o && o.event === eventId;
    })
    .reduce<T | undefined>((newest, x) => (!newest || Date.parse(x.at) > Date.parse(newest.at) ? x : newest), undefined);

// The token goes to the API once per account and token this launch: a launch, a sign-in or a rolled token sends it.
export type Sent = { user: string; token: string } | null;
export const needsSend = (last: Sent, user: string | undefined, token: string | null): token is string =>
  !!user && !!token && (last?.user !== user || last.token !== token);

// One switch on Account › Notifications as the PUT's body: just that key. `push` and `quiet` are the settings' own;
// anything else is a switch ("push.near", "email.follows").
export type SettingKey = 'push' | 'quiet' | SwitchKey;
export const patchFor = (key: SettingKey, v: boolean): NotificationSettingsBody =>
  key === 'push' ? { push: v } : key === 'quiet' ? { quiet: v } : { switches: { [key]: v } };
export const valueOf = (s: NotificationSettings, key: SettingKey) => (key === 'push' || key === 'quiet' ? s[key] : s.switches[key]);
export const withValue = (s: NotificationSettings, key: SettingKey, v: boolean): NotificationSettings =>
  key === 'push' || key === 'quiet' ? { ...s, [key]: v } : { ...s, switches: { ...s.switches, [key]: v } };
