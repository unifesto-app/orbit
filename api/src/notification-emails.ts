import { createHmac, timingSafeEqual } from "node:crypto";
import { type Channel, EMAIL_SWITCHES, type EmailSwitch, fillVars, isMust, KINDS, type NoticeKind, WAITLIST_CONTACT, type Wording } from "@orbit/contract";
import type { Db } from "./db/index.ts";
import { notificationTemplates } from "./db/schema.ts";
import type { Tx } from "./http.ts";
import { esc, frame } from "./prelaunch-email.ts";

// What each notification says, by email and in the inbox (notifications build plan, PR 1): the kinds the code calls
// today, plus welcome. One line serves as the email's lead and the inbox row; where there is none, the subject is the
// whole message. A kind with no wording yet still sends, with a plain fallback. Plain sentences, no exclamation marks,
// dates as "26 Nov" in India time, never an id. No links to screens yet. Optional emails (optionalSwitch) carry an
// unsubscribe link (PR 6); Must and the one-off welcome don't. Replies go to the contact address.
// Galaxy can reword a kind per channel (PR 8, notification_templates): its wording, with {name} placeholders from VARS,
// replaces the subject and line here; the rest of the email (the "why", the unsubscribe link) and the inbox's sender stay.

const SITE = "https://heyorbit.in";
type Data = Record<string, unknown>;
type Words = { subject: string; line?: string };

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const day = (v: unknown) => {
  const d = new Date(str(v));
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};
// A slot's start: its day and time.
const dayTime = (v: unknown) => {
  const d = new Date(str(v));
  if (isNaN(d.getTime())) return "";
  return `${day(v)}, ${time(v)}`;
};
const time = (v: unknown) => {
  const d = new Date(str(v));
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
};
const METHOD: Record<string, string> = { email: "email", phone: "phone number", passkey: "passkey", google: "Google", apple: "Apple" };
const THE_METHOD: Record<string, string> = { email: "your email", phone: "your phone number", passkey: "a passkey", google: "Google", apple: "Apple" };
const AUDIT = "See the audit log in Galaxy.";

const WORDS: Partial<Record<NoticeKind, (d: Data) => Words>> = {
  welcome: () => ({ subject: "Welcome to Orbit", line: "You’re in. There’s more to life beyond the usual." }),
  signInMethodChanged: (d) => ({
    subject: "Your Orbit sign-in changed",
    line: `A way to sign in was ${str(d.change)}: ${METHOD[str(d.method)] ?? str(d.method)}. If this wasn’t you, open Sign-in and security and remove it.`,
  }),
  signInMethodChangeHeld: (d) => ({
    subject: "A change to your Orbit sign-in is on hold",
    line: `Someone tried to ${str(d.change)} ${
      d.method === "account" ? "your account" : `${THE_METHOD[str(d.method)] ?? str(d.method)} on your account`
    }. It’s on hold until ${day(d.until)}. If this wasn’t you, nothing has changed.`,
  }),
  phoneMovedAway: (d) => ({
    subject: "Your number moved to another Orbit account",
    line: `The number ending in ${str(d.phone).slice(-4)} now signs in to a different account. Your account is still here; sign in with your email.`,
  }),
  deletionScheduled: (d) => ({ subject: `Your Orbit account will be deleted on ${day(d.dueAt)}`, line: "Sign in before then to keep it." }),
  deletionCancelled: () => ({ subject: "Your Orbit account is staying", line: "The deletion was cancelled." }),
  deletionBlocked: () => ({ subject: "We couldn’t delete your Orbit account yet", line: "Some things need sorting out first. Open Delete account to see them." }),
  accountDeleted: () => ({ subject: "Your Orbit account is deleted", line: "Your details are gone. Thank you for being here." }),
  accountSuspended: (d) => ({
    subject: "Your Orbit account is suspended",
    line: `Reason: ${str(d.reason)}. ${d.until ? `Until ${day(d.until)}.` : "No end date."} Reply to this email to ask about it.`,
  }),
  accountLifted: () => ({ subject: "Your Orbit account is open again", line: "You can sign in as before." }),
  // A fixed subject: the host name is typed by whoever invites, so it stays in the body.
  teamInvite: (d) => ({
    subject: "You’re invited to a team on Orbit",
    line: `${str(d.hostName)} invited you to their team. Sign in to Orbit with this number or email to answer. The invite lasts 14 days.`,
  }),
  teamInviteWithdrawn: (d) => ({ subject: `An invite at ${str(d.hostName)} was withdrawn`, line: `The invite to ${str(d.contact)} is no longer open.` }),
  teamAccepted: (d) => ({ subject: `${str(d.name) || "Someone"} accepted your invite`, line: "Confirm them as Admin to start their role." }),
  teamRoleStarted: (d) => ({ subject: `Your role at ${str(d.hostName)} has started`, line: `You’re on the team as ${str(d.role)}.` }),
  teamRemoved: (d) => ({ subject: `You were removed from ${str(d.hostName)}`, line: "You no longer have access to this team." }),
  teamLeft: (d) => ({ subject: `${str(d.name) || "Someone"} left ${str(d.hostName)}` }),
  hostStatus: (d) => ({ subject: `${str(d.hostName)} is now ${str(d.status)}` }),
  hostVerified: (d) => ({ subject: `${str(d.hostName)} is verified` }),
  hostUnverified: (d) => ({ subject: `${str(d.hostName)} is no longer verified`, line: `Reason: ${str(d.reason)}.` }),
  hostSuspended: (d) => ({ subject: `${str(d.hostName)} is suspended`, line: `Reason: ${str(d.reason)}.` }),
  hostLifted: (d) => ({ subject: `${str(d.hostName)} is open again` }),
  hostParentSet: (d) => ({
    subject: d.parentName ? `${str(d.hostName)} is now part of ${str(d.parentName)}` : `${str(d.hostName)} is no longer part of another host`,
  }),
  eventRequestAnswered: (d) =>
    d.decision === "approved"
      ? { subject: "Your request to host is approved", line: `${str(d.name)} is on Orbit, unverified for now. Open Orbit Event Partner to carry on.` }
      : d.decision === "changes"
        ? { subject: "Your request to host needs a change", line: `What to change: ${str(d.reason)}. Edit your request in Orbit Event Partner and send it again.` }
        : { subject: "Your request to host was declined", line: `Reason: ${str(d.reason)}.` },
  slotReleased: (d) => ({ subject: `Your slot at ${str(d.hostName)} was released`, line: `You didn’t check in for ${dayTime(d.start)}, so the slot was freed.` }),
  hostAnnouncement: (d) => ({ subject: `${str(d.hostName) || "The host"} about ${str(d.title)}`, line: str(d.text) }),
  eventTomorrow: (d) => ({ subject: `Coming up: ${str(d.title)}`, line: `${str(d.title)} starts tomorrow at ${time(d.startsAt)}.` }),
  eventStartingSoon: (d) => ({ subject: `${str(d.title)} starts soon`, line: `${str(d.title)} starts in an hour.` }),
  thanksForComing: (d) => ({ subject: `Thanks for coming to ${str(d.title)}`, line: `Thanks for coming to ${str(d.title)}. Loved it? Say so on the event page.` }),
  // Broadcasts (broadcasts.ts): the staff's own title and text.
  orbitNews: (d) => ({ subject: str(d.title), line: str(d.text) }),
  orbitNotice: (d) => ({ subject: str(d.title), line: str(d.text) }),
  broadcastWaiting: (d) => ({
    subject: "A broadcast is waiting for a second person",
    line: `“${str(d.title)}” to ${str(d.audienceCount)} people. Confirm or cancel it in Galaxy, Notifications, Broadcasts.`,
  }),
  followedHostEvent: (d) => ({ subject: `${str(d.hostName) || "A host you follow"} has a new event`, line: str(d.title) }),
  staffGrantAdded: (d) => ({
    subject: "Staff access was given",
    line: `Features: ${Array.isArray(d.features) ? d.features.join(", ") : str(d.features)}. Reason: ${str(d.reason)}. ${AUDIT}`,
  }),
  staffGrantStarted: (d) => ({ subject: "Staff access started", line: `Feature: ${str(d.feature)}. Reason: ${str(d.reason)}.` }),
  staffGrantEnded: (d) => ({ subject: "Staff access ended", line: `Feature: ${str(d.feature)}. Reason: ${str(d.reason)}.` }),
  staffRiskyAction: (d) => ({ subject: `A staff action was taken: ${str(d.action)}`, line: `Reason: ${str(d.reason)}. ${AUDIT}` }),
  staffHeavyPaging: (d) => ({ subject: "Someone is paging through many people", line: `${str(d.pages)} pages today. ${AUDIT}` }),
  providerFailing: (d) => ({
    subject: `Orbit ${d.channel === "push" ? "push" : "email"} sending is failing`,
    line: `${str(d.failed)} of ${str(d.total)} ${d.channel === "push" ? "pushes" : "emails"} failed in the last hour. See Sentry and the provider’s status page.`,
  }),
};

// The data each kind's wording may use, as {name}, with a sample (Galaxy's preview and test send) and how it's shown
// when the code shows it other than as it is. Read off WORDS: a kind with no entry has no variables.
type Var = [sample: unknown, show?: (v: unknown) => string];
const method = (v: unknown) => METHOD[str(v)] ?? str(v);
const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : str(v));
const H: Record<string, Var> = { hostName: ["Open Mic Club"] };
const R: Record<string, Var> = { reason: ["It broke the house rules"] };
const T: Record<string, Var> = { title: ["Open Mic Night"] };
const SOON = "2026-12-05T13:30:00.000Z"; // 5 Dec, 7:00 pm in India
export const VARS: Partial<Record<NoticeKind, Record<string, Var>>> = {
  signInMethodChanged: { change: ["added"], method: ["passkey", method] },
  signInMethodChangeHeld: { change: ["remove"], method: ["passkey", method], until: [SOON, day] },
  phoneMovedAway: { phone: ["+919876543210", (v) => str(v).slice(-4)] },
  deletionScheduled: { dueAt: [SOON, day] },
  accountSuspended: { ...R, until: [SOON, day] },
  teamInvite: H,
  teamInviteWithdrawn: { ...H, contact: ["riya@example.com"] },
  teamAccepted: { name: ["Riya Kapoor"] },
  teamRoleStarted: { ...H, role: ["admin"] },
  teamRemoved: H,
  teamLeft: { ...H, name: ["Riya Kapoor"] },
  hostStatus: { ...H, status: ["live"] },
  hostVerified: H,
  hostUnverified: { ...H, ...R },
  hostSuspended: { ...H, ...R },
  hostLifted: H,
  hostParentSet: { ...H, parentName: ["City Arts Collective"] },
  eventRequestAnswered: { decision: ["approved"], name: ["Open Mic Club"], ...R },
  slotReleased: { ...H, start: [SOON, dayTime] },
  hostAnnouncement: { ...H, ...T, text: ["Doors open at 6:30, half an hour early."] },
  eventTomorrow: { ...T, startsAt: [SOON, time] },
  eventStartingSoon: T,
  thanksForComing: T,
  followedHostEvent: { ...H, ...T },
  staffGrantAdded: { features: [["people", "platform"], list], ...R },
  staffGrantStarted: { feature: ["people"], ...R },
  staffGrantEnded: { feature: ["people"], ...R },
  staffRiskyAction: { action: ["notifications all email off"], ...R },
  staffHeavyPaging: { pages: [42] },
  providerFailing: { channel: ["push"], failed: [12], total: [40] },
};
export const varsOf = (kind: string) => VARS[kind as NoticeKind] ?? {};
// Variables kept out of a kind's email subject: teamInvite's host name is typed by whoever invites (see WORDS).
export const SUBJECT_OFF: Partial<Record<NoticeKind, readonly string[]>> = { teamInvite: ["hostName"] };
// Channels whose code wording changes with the data (a decision, an end date or none, a fallback name), which one saved
// wording can't follow: edited in code only. Email is the subject + line; push and inbox the line, else the subject.
const ALL: readonly Channel[] = ["email", "push", "inbox"];
const BRANCHES: Partial<Record<NoticeKind, readonly Channel[]>> = {
  signInMethodChangeHeld: ALL,
  accountSuspended: ALL,
  teamAccepted: ["email"],
  teamLeft: ALL,
  hostParentSet: ALL,
  eventRequestAnswered: ALL,
  hostAnnouncement: ["email"],
  followedHostEvent: ["email"],
  providerFailing: ALL,
  orbitNews: ALL, // a broadcast's words are its own title and text
  orbitNotice: ALL,
};
export const branches = (kind: string, channel: Channel) => BRANCHES[kind as NoticeKind]?.includes(channel) ?? false;
export const samplesOf = (kind: string): Data => Object.fromEntries(Object.entries(varsOf(kind)).map(([n, [v]]) => [n, v]));
// `text` with each of the kind's {name} filled from the data, shown as the code shows it.
export const fill = (text: string, vars: Record<string, Var>, data: Data) =>
  fillVars(text, Object.fromEntries(Object.entries(vars).map(([n, [, show = str]]) => [n, show(data[n])])));
const filled = (kind: string, text: string, data: Data) => fill(text, varsOf(kind), data);

// Galaxy's saved wording for (kind, channel), or null for the code's. A test send (Galaxy's "Send test to me", dedupe
// key test:…) carries its draft in the payload instead.
// ponytail: all rows cached per process for 60 s, cleared on save in this process, so the worker reads the table at most
// once a minute and another process sees a save within a minute; LISTEN/NOTIFY on save if it must be instant.
let cache: { until: number; rows: Map<string, Wording> } | null = null;
export const clearWording = () => void (cache = null);
export async function wordingFor(q: Db | Tx, kind: string, channel: Channel, sent?: { dedupeKey: string; payload: Data }) {
  if (sent?.dedupeKey.startsWith("test:")) {
    const draft = sent.payload._draft;
    return draft && typeof draft === "object" ? (draft as Wording) : null;
  }
  if (!cache || cache.until < Date.now()) {
    const rows = await q.select().from(notificationTemplates);
    cache = { until: Date.now() + 60_000, rows: new Map(rows.map((r) => [`${r.kind}:${r.channel}`, r])) };
  }
  return cache.rows.get(`${kind}:${channel}`) ?? null;
}

// The plain line for a kind with no wording yet, so a later slice can call it before its words land.
export const words = (kind: string, d: Data): Words => WORDS[kind as NoticeKind]?.(d) ?? { subject: "A message from Orbit", line: "Open Orbit to see it." };

const WHY = "You’re getting this because it’s about your Orbit account. Account and security emails can’t be switched off.";
const WHY_STAFF = "You’re getting this because you hold staff access on Orbit.";
const WHY_EVENT = "You’re getting this because you have a ticket for this event on Orbit.";

// What each email switch's emails are about, to follow "emails about" (the app's switches,
// app/src/app/account/notifications.tsx).
export const SWITCH_ABOUT: Record<EmailSwitch, string> = {
  reminders: "events you’re going to",
  follows: "hosts you follow",
  announcements: "host announcements",
  orbit: "news from Orbit",
  yourHosts: "your hosts",
};
// An optional email's switch: not Must, not the one-off welcome, and governed by an email switch. Null for the rest,
// and for a kind the catalog doesn't know (a row left from an older build).
export const optionalSwitch = (kind: NoticeKind): EmailSwitch | null => {
  const def = KINDS[kind] as (typeof KINDS)[NoticeKind] | undefined;
  if (!def || def.level === "must" || kind === "welcome") return null;
  return (EMAIL_SWITCHES as readonly string[]).includes(def.switch ?? "") ? (def.switch as EmailSwitch) : null;
};

// The unsubscribe token: {u, s} and its HMAC, keyed apart from every other use of AUTH_SECRET. No expiry, so an old
// email's link still works.
const unsubKey = (secret: string) => createHmac("sha256", secret).update("orbit-unsubscribe-v1").digest();
const mac = (secret: string, payload: string) => createHmac("sha256", unsubKey(secret)).update(payload).digest();
export const unsubscribeToken = (secret: string, u: string, s: EmailSwitch) => {
  const payload = Buffer.from(JSON.stringify({ u, s })).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
};
export const readUnsubscribeToken = (secret: string, t: string): { u: string; s: EmailSwitch } | null => {
  const [payload, sig, extra] = t.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const want = mac(secret, payload);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u?: unknown; s?: unknown };
    return typeof v.u === "string" && (EMAIL_SWITCHES as readonly unknown[]).includes(v.s) ? { u: v.u, s: v.s as EmailSwitch } : null;
  } catch {
    return null;
  }
};

// `unsubscribe`: an optional email's switch and its one-click link, which go in the footer and the List-Unsubscribe
// headers.
// `w`: Galaxy's email wording, if any.
export function emailFor(kind: string, data: Data = {}, site = SITE, unsubscribe?: { s: EmailSwitch; link: string }, w?: Wording | null) {
  const code = words(kind, data);
  const subject = w?.subject ? filled(kind, w.subject, data) : code.subject;
  const line = w ? filled(kind, w.body, data) : (code.line ?? "");
  const group = KINDS[kind as NoticeKind]?.group;
  const why = unsubscribe
    ? `You’re getting this because emails about ${SWITCH_ABOUT[unsubscribe.s]} are on. Stop them: ${unsubscribe.link}`
    : group === "staff"
      ? WHY_STAFF
      : group === "events"
        ? WHY_EVENT
        : WHY;
  let html = frame({ subject, heading: subject, lead: esc(line), why }, site);
  if (unsubscribe) html = html.replace(esc(unsubscribe.link), `<a class="t2" href="${esc(unsubscribe.link)}" style="color:inherit">${esc(unsubscribe.link)}</a>`);
  const text = [subject, ...(line ? ["", line] : []), "", why, `Terms: ${site}/terms · Privacy: ${site}/privacy`, "© 2027 Orbit"].join("\n");
  const headers = unsubscribe && { "List-Unsubscribe": `<${unsubscribe.link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  return { subject, html, text, replyTo: WAITLIST_CONTACT, ...(headers ? { headers } : {}) };
}

// `opens`: the app's Opens shape (app/src/inbox.ts), the catalog's target with its id from the data; null when the id
// isn't there (the row then shows its whole text).
// ponytail: `picture` stays null; real pictures (the event's poster, the host's logo) come with media on the rows.
export function opensFor(kind: NoticeKind, data: Data = {}) {
  const to = KINDS[kind].opens;
  const id = (key: string) => (typeof data[key] === "string" && data[key] ? (data[key] as string) : null);
  switch (to) {
    case null:
      return null;
    case "ticket":
    case "refund":
    case "event":
    case "room": {
      const event = id("eventId");
      return event ? { to, event } : null;
    }
    case "slot": {
      const venue = id("venueId");
      return venue ? { to, venue } : null;
    }
    case "host": {
      const host = id("hostId");
      return host ? { to, host } : null;
    }
    default:
      return { to };
  }
}

// `w`: Galaxy's inbox wording, if any. The sender stays the code's.
export function inboxFor(kind: NoticeKind, data: Data = {}, w?: Wording | null) {
  const { subject, line } = words(kind, data);
  const base: { text: string; fromName: string; opens: ReturnType<typeof opensFor>; title?: string; body?: string } = {
    text: w ? filled(kind, w.body, data) : line || subject,
    fromName: str(data.hostName) || "Orbit",
    opens: opensFor(kind, data),
  };
  // A broadcast's title leads: "Title: text" in the inbox, the push's title.
  if (kind === "orbitNews" || kind === "orbitNotice") return { ...base, text: `${subject}: ${line}`, title: subject, body: line };
  return base;
}

// A push: the sender as its title and the inbox's words (a broadcast: its title and text), or Galaxy's push wording.
export function pushFor(kind: NoticeKind, data: Data = {}, w?: Wording | null) {
  const i = inboxFor(kind, data);
  return { title: w?.title ? filled(kind, w.title, data) : i.title ?? i.fromName, body: w ? filled(kind, w.body, data) : i.body ?? i.text, opens: i.opens };
}
