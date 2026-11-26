// The Console's Inbox: Event Partner's (host/src/launch/inbox.ts, inboxStore.ts) on the web, on the same GET /me/inbox
// and POST /me/inbox/read, so a message read here is read in the host app too. The Console is Event Partner on the web,
// so its inbox is app "launch".
// ponytail: launch only; a Desk seat's "station" inbox comes in when the Console knows which seat is signed in.
import { InboxRead } from "@orbit/contract";

export const INBOX_APP = "launch";

// "teamInvite" → "Team invite": the catalog's kind as the row's small grey label.
export const kindLabel = (k: string) => {
  const words = k.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// The count beside Inbox: nothing when there's nothing new, and never wider than two characters.
export const badge = (n: number) => (n <= 0 ? null : n > 9 ? "9+" : String(n));

// "26 Nov, 6:12 pm" in India time, wherever the browser or server is.
const WHEN = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const whenLabel = (at: string) => {
  const t = Date.parse(at);
  return Number.isNaN(t) ? "" : WHEN.format(t);
};

// POST /me/inbox/read's body: those ids, or every message with none. Checked here, since a Server Action takes anything.
export const readBody = (ids?: unknown) => {
  const b = InboxRead.safeParse(ids === undefined ? { app: INBOX_APP } : { app: INBOX_APP, ids });
  return b.success ? b.data : null;
};
