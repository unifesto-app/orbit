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
  opens: "security" | "help" | "refunds" | "request" | null;
  vars: readonly string[]; // the data keys the wording may use
};

// `ch`: P push, I inbox, E email always, e email only when the push didn't land.
const k = (
  group: KindDef["group"],
  level: Level,
  ch: string,
  app: InboxApp | "role" | null,
  type: InboxType,
  vars: readonly string[] = [],
  opens: KindDef["opens"] = null,
): KindDef => ({
  group,
  level,
  push: ch.includes("P"),
  inbox: ch.includes("I"),
  email: ch.includes("E") ? "always" : ch.includes("e") ? "fallback" : false,
  app: ch.includes("I") ? app : null,
  type,
  opens,
  vars,
});

const acct = (level: Level, ch: string, vars: readonly string[] = [], opens: KindDef["opens"] = null) => k("account", level, ch, "orbit", "account", vars, opens);
const book = (level: Level, ch: string, type: InboxType = "ticket") => k("booking", level, ch, "orbit", type);
const ev = (level: Level, ch: string, type: InboxType) => k("events", level, ch, "orbit", type);
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
  teamInvite: acct("must", "PIE", ["hostName", "role"]),
  teamInviteWithdrawn: acct("must", "PIE", ["hostName", "contact"]),
  staffDecision: acct("must", "PIE"),
  supportReply: acct("must", "PIE"),
  dataExportReady: acct("must", "IE"),
  eventRequestAnswered: acct("must", "PIE"),
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
  slotFreedAgain: book("normal", "PI"),
  slotCancelledByVenue: book("must", "PIE"),
  slotReleased: k("booking", "must", "PIE", "orbit", "ticket", ["hostName", "start"]),

  // Events you hold a ticket for
  eventTomorrow: ev("normal", "PIe", "reminder"),
  eventStartingSoon: ev("low", "PI", "reminder"),
  eventChanged: ev("must", "PIE", "announcement"),
  eventCancelled: ev("must", "PIE", "announcement"),
  hostAnnouncement: ev("normal", "PIE", "announcement"),
  thanksForComing: ev("normal", "PIe", "thanks"),
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
  followedHostEvent: k("following", "normal", "PIe", "orbit", "follow"),
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
  const app: InboxApp | "role" | null = KINDS[kind].app;
  if (app !== "role") return app;
  return data?.role === "crew" ? "crew" : data?.role === "desk" ? "station" : "launch";
};
