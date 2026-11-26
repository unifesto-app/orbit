import { z } from "zod";

// The notification kinds (Orbit notifications build plan, Claude Doc 39zppEh4XSQhFe33NRCBnS; approved 26 Nov 2026): what
// each message is, how much it matters, the ways it may go and whose inbox it lands in. Read by the API now and the apps
// and Galaxy later. The catalog is code, so the database holds only what changes at run time (switches, wording).
// Galaxy can switch a kind's channels off and reword it, but never change its level.

export const APPS = ["orbit", "launch", "station", "crew"] as const; // people app, Orbit Event Partner, Orbit Play Partner, Orbit Crew
export type InboxApp = (typeof APPS)[number];

export const CHANNELS = ["email", "push", "inbox"] as const; // never WhatsApp: it carries sign-in codes only (owner, 26 Nov 2026)
export type Channel = (typeof CHANNELS)[number];

// Must ignores switches, quiet hours and caps. Normal: push and inbox. Low: push and inbox, held in quiet hours, counted
// in the 5 a day cap.
export type Level = "must" | "normal" | "low";

// The inbox row's icon (app/src/inbox.ts).
export type InboxType = "announcement" | "reminder" | "follow" | "near" | "ticket" | "refund" | "inRoom" | "thanks" | "account";

// The person's switches (app/src/app/account/notifications.tsx): push one per area; email only for the optional emails
// (tickets, near and inRoom never email). Must kinds have none.
export const PUSH_SWITCHES = ["tickets", "reminders", "follows", "near", "announcements", "inRoom", "orbit", "yourHosts"] as const;
export type PushSwitch = (typeof PUSH_SWITCHES)[number];
export const EMAIL_SWITCHES = ["reminders", "follows", "announcements", "orbit", "yourHosts"] as const satisfies readonly PushSwitch[];
export type EmailSwitch = (typeof EMAIL_SWITCHES)[number];
// Stored and sent as "push.near", "email.follows".
export type SwitchKey = `push.${PushSwitch}` | `email.${EmailSwitch}`;
export const SWITCH_KEYS = [...PUSH_SWITCHES.map((s) => `push.${s}` as const), ...EMAIL_SWITCHES.map((s) => `email.${s}` as const)] as [SwitchKey, ...SwitchKey[]];

export type KindDef = {
  group: "account" | "booking" | "events" | "following" | "host" | "staff";
  level: Level;
  push: boolean;
  inbox: boolean;
  email: "always" | "fallback" | false; // "fallback": only when the push didn't land
  // Whose inbox it lands in; null with no inbox. "role": the role's app, from data.role (crew → crew, desk → station,
  // anything else → launch).
  app: InboxApp | "role" | null;
  type: InboxType;
  // The screen it opens in the people app (app/src/inbox.ts Opens); the API fills the id from the data (eventId,
  // venueId, hostId) and leaves it null when that id is missing. Host-app kinds open nothing yet: those apps' inboxes
  // have their own screens, which come with them.
  opens: Target | null;
  vars: readonly string[]; // the data keys the wording may use
  switch: PushSwitch | null; // the person's switch that governs it; null for Must kinds
};

export type Target = "security" | "help" | "refunds" | "request" | "ticket" | "refund" | "event" | "room" | "slot" | "host";

// Where a kind opens when the catalog doesn't say: a booking its ticket (a refund its refund), an event you hold a
// ticket for the ticket (inRoom its room, Thanks the event page, for Loved it), a followed host's or nearby event its
// page. Account, From Orbit, host and staff kinds name theirs or open nothing.
const targetOf = (group: KindDef["group"], type: InboxType): Target | null => {
  if (group === "booking") return type === "refund" ? "refund" : "ticket";
  if (group === "events") return type === "inRoom" ? "room" : type === "thanks" ? "event" : "ticket";
  if (group === "following") return type === "announcement" ? null : "event";
  return null;
};

// The plan's "Switch" column, by area: tickets for booking, Your hosts for the host apps, From Orbit for the account's
// optional email; events and following by what the message is.
const switchOf = (group: KindDef["group"], level: Level, type: InboxType): PushSwitch | null => {
  if (level === "must") return null;
  if (group === "booking") return "tickets";
  if (group === "host" || group === "staff") return "yourHosts";
  if (group === "account") return "orbit";
  if (type === "reminder") return "reminders";
  if (type === "inRoom") return "inRoom";
  if (type === "follow") return "follows";
  if (type === "near") return "near";
  return group === "following" ? "orbit" : "announcements"; // orbitNews; the hosts' event messages
};

// `ch`: P push, I inbox, E email always, e email only when the push didn't land.
const k = (
  group: KindDef["group"],
  level: Level,
  ch: string,
  app: InboxApp | "role" | null,
  type: InboxType,
  vars: readonly string[] = [],
  opens?: KindDef["opens"],
): KindDef => ({
  group,
  level,
  push: ch.includes("P"),
  inbox: ch.includes("I"),
  email: ch.includes("E") ? "always" : ch.includes("e") ? "fallback" : false,
  app: ch.includes("I") ? app : null,
  type,
  opens: opens === undefined ? targetOf(group, type) : opens,
  vars,
  switch: switchOf(group, level, type),
});

const acct = (level: Level, ch: string, vars: readonly string[] = [], opens: KindDef["opens"] = null) => k("account", level, ch, "orbit", "account", vars, opens);
const slot = (level: Level, ch: string, vars: readonly string[] = []) => k("booking", level, ch, "orbit", "ticket", vars, "slot");
const book = (level: Level, ch: string, type: InboxType = "ticket") => k("booking", level, ch, "orbit", type);
const ev = (level: Level, ch: string, type: InboxType, vars: readonly string[] = []) => k("events", level, ch, "orbit", type, vars);
const host = (level: Level, ch: string, app: InboxApp | "role" | null = "launch", vars: readonly string[] = []) => k("host", level, ch, app, "account", vars);
const staff = (vars: readonly string[] = []) => k("staff", "must", "E", null, "account", vars);

const HOST = ["hostName"] as const;

export const KINDS = {
  // Account (people app)
  welcome: acct("normal", "E", ["name"]),
  signInMethodChanged: acct("must", "PIE", ["method", "change"], "security"),
  signInMethodChangeHeld: acct("must", "E", ["method", "change", "until"]),
  phoneMovedAway: acct("must", "E", ["phone"]),
  deletionScheduled: acct("must", "PIE", ["dueAt"], "security"),
  deletionCancelled: acct("must", "PIE", [], "security"),
  deletionBlocked: acct("must", "PIE", ["blockers"], "security"),
  accountDeleted: acct("must", "PIE", [], "security"),
  accountSuspended: acct("must", "E", ["until", "reason"]),
  accountLifted: acct("must", "E"),
  teamInvite: acct("must", "PIE", ["hostName", "role"], "host"),
  teamInviteWithdrawn: acct("must", "PIE", ["hostName", "contact"], "host"),
  staffDecision: acct("must", "PIE"),
  supportReply: acct("must", "PIE"),
  dataExportReady: acct("must", "IE"),
  // Lands in the app it was asked from: a Venue's in Play Partner, the rest in Event Partner (`inboxApp`, by `kind`).
  // `name`, not hostName: the inbox row is from Orbit, not the host.
  eventRequestAnswered: k("account", "must", "PIE", "launch", "account", ["decision", "name", "reason", "kind"], "request"),
  inRoomCardRemoved: acct("must", "PIE"),
  inRoomBarred: acct("must", "PIE"),

  // Booking and tickets
  bookingConfirmed: book("must", "PIE"),
  paymentReceipt: book("must", "PIE"),
  paymentFailed: book("must", "PIE"),
  soldOutWhilePaying: book("must", "PIE"),
  paidTwice: book("must", "PIE"),
  refundApproved: book("must", "PIE", "refund"),
  refundDeclined: book("must", "PIE", "refund"),
  refundFailed: book("must", "PIE", "refund"),
  refundSent: book("must", "PIE", "refund"),
  bookingCancelled: book("must", "PIE"),
  seatTakenBack: book("must", "PIE"),
  finishBooking: book("low", "PI"),
  seatForYou: book("must", "E"),
  seatClaimed: book("normal", "PIe"),
  seatUnclaimed: book("normal", "PIe"),
  leadHandover: book("normal", "PIe"),
  ticketPassed: book("must", "PIE"),
  ticketMoveConfirm: book("must", "PIE"),
  waitlistSeatsFree: book("normal", "PIe"),
  slotFreedAgain: slot("normal", "PI"),
  slotCancelledByVenue: slot("must", "PIE"),
  slotReleased: slot("must", "PIE", ["hostName", "start"]),

  // Events you hold a ticket for
  eventTomorrow: ev("normal", "PIe", "reminder", ["eventId", "title", "hostName", "startsAt"]),
  eventStartingSoon: ev("low", "PI", "reminder", ["eventId", "title", "hostName", "startsAt"]),
  eventChanged: ev("must", "PIE", "announcement"),
  eventCancelled: ev("must", "PIE", "announcement"),
  hostAnnouncement: ev("normal", "PIE", "announcement", ["eventId", "title", "hostName", "text"]),
  thanksForComing: ev("normal", "PIe", "thanks", ["eventId", "title", "hostName", "startsAt"]),
  inRoomAsk: ev("normal", "PI", "inRoom"),
  inRoomConnected: ev("normal", "PI", "inRoom"),
  inRoomRemoved: ev("normal", "I", "inRoom"),
  hackRoundOpen: ev("normal", "PIe", "announcement"),
  hackDeadline: ev("normal", "PIe", "reminder"),
  hackEntry: ev("normal", "PIe", "announcement"),
  hackLateEntry: ev("normal", "PIe", "announcement"),
  hackNeedsOne: ev("normal", "PIe", "announcement"),
  hackResults: ev("normal", "PIE", "announcement"),
  hackChanged: ev("must", "PIE", "announcement"),

  // Following, discovering, from Orbit
  followedHostEvent: k("following", "normal", "PIe", "orbit", "follow", ["hostId", "hostName", "eventId", "title"]), // hostId: the per-host cap
  savedEventOpens: k("following", "normal", "PIe", "orbit", "reminder"),
  nearYou: k("following", "low", "PI", "orbit", "near"),
  orbitNews: k("following", "normal", "PIE", "orbit", "announcement"),
  orbitNotice: k("following", "must", "PIE", "orbit", "announcement"),

  // Host apps
  teamAccepted: host("must", "PIE", "launch", ["name"]),
  teamRoleStarted: host("normal", "PIE", "role", ["hostName", "role"]),
  teamRemoved: host("normal", "PIE", "role", HOST),
  teamLeft: host("normal", "PIE", "launch", ["hostName", "name"]),
  hostStatus: host("must", "PIE", "launch", ["hostName", "status"]),
  // Not in the plan's tables, which fold them into hostStatus; the code calls them (default D1).
  hostVerified: host("must", "PIE", "launch", HOST),
  hostUnverified: host("must", "PIE", "launch", ["hostName", "reason"]),
  hostSuspended: host("must", "PIE", "launch", ["hostName", "reason"]),
  hostLifted: host("must", "PIE", "launch", HOST),
  hostParentSet: host("must", "PIE", "launch", ["hostName", "parentName"]),
  refundRequested: host("normal", "PIE"),
  payoutPaid: host("must", "PIE"),
  payoutCancelled: host("must", "PIE"),
  bankChecked: host("must", "PIE"),
  bankChanged: host("must", "PIE"),
  disputeHold: host("must", "PIE"),
  feeChange: host("must", "PIE"),
  eventTakenDown: host("must", "PIE"),
  ownerChange: host("must", "PIE"),
  seriesDateKept: host("normal", "PIE"),
  seriesDatesAdded: host("normal", "PIE"),
  eventSummary: host("normal", "PIE"),
  linkAsked: host("normal", "PIE"),
  linkAnswered: host("normal", "PIE"),
  linkRemoved: host("normal", "PIE"),
  loveSummary: host("normal", "PIE"),
  loveRemoved: host("normal", "PIE"),
  slotBooked: host("normal", "PI", "station"),
  slotCancelled: host("normal", "PI", "station"),
  judgeReady: host("normal", "E", null),
  judgeDue: host("normal", "E", null),

  // Galaxy staff: email only, no inbox
  staffGrantAdded: staff(["features", "reason"]),
  staffGrantStarted: staff(["feature", "reason"]),
  staffGrantEnded: staff(["feature", "reason"]),
  staffRiskyAction: staff(["action", "reason"]),
  staffHeavyPaging: staff(["pages"]),
  broadcastWaiting: staff(),
  providerFailing: staff(),
} as const satisfies Record<string, KindDef>;

export type NoticeKind = keyof typeof KINDS;

export const isMust = (kind: NoticeKind) => KINDS[kind].level === "must";

// The inbox a kind lands in for this notice; null when it has none.
export const inboxApp = (kind: NoticeKind, data?: Record<string, unknown>): InboxApp | null => {
  if (kind === "eventRequestAnswered") return data?.kind === "venue" ? "station" : "launch";
  const app: InboxApp | "role" | null = KINDS[kind].app;
  if (app !== "role") return app;
  return data?.role === "crew" ? "crew" : data?.role === "desk" ? "station" : "launch";
};

// ---------- The person's routes (/me, build plan PR 2) ----------

// The phone's push token for this sign-in. A token moves with its latest PUT.
export const PushDevice = z.object({
  app: z.enum(APPS),
  platform: z.enum(["ios", "android"]),
  env: z.enum(["sandbox", "production"]),
  token: z.string().min(1).max(512),
});
export type PushDevice = z.infer<typeof PushDevice>;

// One inbox row, as the app's InboxItem (app/src/inbox.ts) but with the catalog's kind.
export type InboxRow = { id: string; at: string; from: string; kind: NoticeKind; type: InboxType; text: string; picture: unknown; opens: unknown; read: boolean };
export const INBOX_PAGE = 30;
// Newest first; `next` is the cursor for the page after, null on the last. `unread`: that app's whole inbox.
export type InboxPage = { items: InboxRow[]; unread: number; next: string | null };

// With no ids: everything in that app's inbox.
export const InboxRead = z.object({ app: z.enum(APPS), ids: z.array(z.uuid()).max(100).optional() });

// Every key filled in. Defaults: all on but push.near, which is on only with a city set; quiet hours on.
export type NotificationSettings = { push: boolean; quiet: boolean; switches: Record<SwitchKey, boolean> };
export const NotificationSettingsBody = z.object({
  push: z.boolean().optional(),
  quiet: z.boolean().optional(),
  switches: z.partialRecord(z.enum(SWITCH_KEYS), z.boolean()).optional(),
});
export type NotificationSettingsBody = z.infer<typeof NotificationSettingsBody>;

export const FollowNotify = z.object({ notify: z.enum(["all", "off"]) });

// ---------- Galaxy's Notifications (build plan PR 7) ----------

// A kill switch that is off: who, when, why. No row means on.
export type KillSwitch = { by: string | null; at: string; reason: string };
// One kind as Galaxy's Kinds tab shows it. `channels`: the ways it can go; `off`: those switched off.
export type GalaxyKind = { kind: NoticeKind; group: KindDef["group"]; level: Level; app: KindDef["app"]; channels: Channel[]; off: Partial<Record<Channel, KillSwitch>> };
// `all`: the whole-channel switches (kind *), which stop Must kinds too.
export type GalaxyKinds = { kinds: GalaxyKind[]; all: Partial<Record<Channel, KillSwitch>> };
export const SwitchBody = z.object({ off: z.boolean(), reason: z.string().trim().min(3).max(500) });

// One send in the delivery log. `to`: the email masked (a***@x.com), a device as "ios · orbit", else null; never a token.
export type DeliveryRow = { id: string; kind: string; channel: Channel; status: string; reason: string | null; to: string | null; tries: number; createdAt: string; sentAt: string | null };
export const DELIVERY_LOG_MAX = 100;
// `person`: the account found; null when only a contact matched (a notice to an address with no account).
export type DeliveryLog = { person: { id: string; name: string | null } | null; deliveries: DeliveryRow[] };
