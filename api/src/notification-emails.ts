import { KINDS, type NoticeKind, WAITLIST_CONTACT } from "@orbit/contract";
import { esc, frame } from "./prelaunch-email.ts";

// What each notification says, by email and in the inbox (notifications build plan, PR 1): the kinds the code calls
// today, plus welcome. One line serves as the email's lead and the inbox row; where there is none, the subject is the
// whole message. A kind with no wording yet still sends, with a plain fallback. Plain sentences, no exclamation marks,
// dates as "26 Nov" in India time, never an id. No links to screens yet and no unsubscribe link (every kind here is
// must or one-off). Replies go to the contact address.
// ponytail: Galaxy's rewording (notification_templates) isn't read yet; its slice defines the placeholders.

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
  return `${day(v)}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}`;
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
  followedHostEvent: (d) => ({ subject: `${str(d.hostName) || "A host you follow"} has a new event`, line: str(d.title) }),
  staffGrantAdded: (d) => ({
    subject: "Staff access was given",
    line: `Features: ${Array.isArray(d.features) ? d.features.join(", ") : str(d.features)}. Reason: ${str(d.reason)}. ${AUDIT}`,
  }),
  staffGrantStarted: (d) => ({ subject: "Staff access started", line: `Feature: ${str(d.feature)}. Reason: ${str(d.reason)}.` }),
  staffGrantEnded: (d) => ({ subject: "Staff access ended", line: `Feature: ${str(d.feature)}. Reason: ${str(d.reason)}.` }),
  staffRiskyAction: (d) => ({ subject: `A staff action was taken: ${str(d.action)}`, line: `Reason: ${str(d.reason)}. ${AUDIT}` }),
  staffHeavyPaging: (d) => ({ subject: "Someone is paging through many people", line: `${str(d.pages)} pages today. ${AUDIT}` }),
};

// The plain line for a kind with no wording yet, so a later slice can call it before its words land.
const words = (kind: string, d: Data): Words => WORDS[kind as NoticeKind]?.(d) ?? { subject: "A message from Orbit", line: "Open Orbit to see it." };

const WHY = "You’re getting this because it’s about your Orbit account. Account and security emails can’t be switched off.";
const WHY_STAFF = "You’re getting this because you hold staff access on Orbit.";

export function emailFor(kind: string, data: Data = {}, site = SITE) {
  const { subject, line = "" } = words(kind, data);
  const why = KINDS[kind as NoticeKind]?.group === "staff" ? WHY_STAFF : WHY;
  const html = frame({ subject, heading: subject, lead: esc(line), why }, site);
  const text = [subject, ...(line ? ["", line] : []), "", why, `Terms: ${site}/terms · Privacy: ${site}/privacy`, "© 2027 Orbit"].join("\n");
  return { subject, html, text, replyTo: WAITLIST_CONTACT };
}

// `opens`: the app's Opens shape (app/src/inbox.ts).
export function inboxFor(kind: NoticeKind, data: Data = {}) {
  const { subject, line } = words(kind, data);
  const opens = KINDS[kind].opens;
  return { text: line || subject, fromName: str(data.hostName) || "Orbit", opens: opens ? { to: opens } : null };
}
