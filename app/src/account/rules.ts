// What the Account screens work out from the account's data. Pure, so it runs on Node in rules.test.ts; the screens in
// src/app/account only draw what this returns. Rules: the User, Booking and Money flow docs (defaults accepted 15 Nov
// 2026).

export type Way = 'phone' | 'email' | 'google' | 'apple' | 'passkey';
// The Booking doc's refund statuses, word for word.
export type RefundStatus = 'Requested' | 'With the host' | 'With Orbit' | 'Refunded' | 'Declined' | 'Refund failed, retrying';

const DAY = 86_400_000;
const india = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const indiaYear = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' });

// "20 Nov", in India time.
export const day = (at: string | number) => india.format(new Date(at));
// "2025", in India time.
export const year = (at: string | number) => indiaYear.format(new Date(at));

// "+91 98••• ••210": enough to recognise your own number, not enough to read someone else's.
export function maskPhone(e164: string) {
  const local = e164.replace(/^\+91/, '');
  return `+91 ${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}

// "k•••@example.com".
export function maskEmail(email: string) {
  const at = email.indexOf('@');
  return at < 1 ? email : `${email[0]}•••${email.slice(at)}`;
}

// Sign-in and security: the phone can be changed but never removed, and nothing removes the last way in. Passkeys are
// ways in too (User flow, Managing sign-in methods).
export const canRemove = (way: Way, ways: readonly Way[]) => way !== 'phone' && ways.length > 1;

// A refund still being decided or sent.
export const isOpen = (s: RefundStatus) => s !== 'Refunded' && s !== 'Declined';

// The day a deletion asked for now runs: 30 days later.
export const deletesOn = (now: number) => day(now + 30 * DAY);

// What a ticket offers after booking (Booking doc, After booking): a paid one, a refund request until the event ends,
// one open at a time; a free one, Cancel until it starts.
// ponytail: events carry no end time yet, so "until it ends" reads as "until it starts" too.
export function ticketActions({ paid, startsAt, refundOpen, now }: { paid: boolean; startsAt: string; refundOpen: boolean; now: number }) {
  const ahead = Date.parse(startsAt) > now;
  return { refund: paid && ahead && !refundOpen, cancel: !paid && ahead };
}

// "OM7Q 2M9X": the 8-character code in two halves, easier to read out at the gate.
export const spacedCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

// A Google Calendar link for an event: it opens in the browser or the Calendar app, with no permission to ask and no
// native module (expo-calendar would need a rebuild).
// ponytail: events carry no end time yet, so the entry runs 2 hours.
export function calendarLink({ title, startsAt, place }: { title: string; startsAt: string; place: string }) {
  const start = Date.parse(startsAt);
  const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = (s: string) => encodeURIComponent(s);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q(title)}&dates=${stamp(start)}/${stamp(start + 2 * 3_600_000)}&location=${q(place)}`;
}

// What Edit profile's Save sends to PATCH /me: only what changed, the name trimmed. Null when nothing changed or the
// name is empty, which the API refuses (a name can't be cleared; gender can, with null).
export function profileChanges(was: { name: string | null; gender: string | null }, form: { name: string; gender: string | null }) {
  const name = form.name.trim();
  if (!name) return null;
  const changes = { ...(name !== was.name && { name }), ...(form.gender !== was.gender && { gender: form.gender }) };
  return Object.keys(changes).length ? changes : null;
}

// Changing your number or email (User flow; api/src/auth/security.ts): what comes first, from GET /me/security.
// - 'new': this phone confirmed it's you in the last 10 minutes and no hold stands, so straight to the new one.
// - 'prove': a code to one of your own first. In the 7 days after "Is this you?" an email change needs your email's,
//   which lifts the hold only if that email was on the account before then; the phone is never held.
// - 'wait': the hold stands even after your email's code (an email added since), until `until`.
// `provedByEmail` is whether this screen just had your email's code.
export type Security = { phone: string | null; email: string | null; fresh: boolean; heldUntil: string | null };
export function changeStart(way: 'phone' | 'email', s: Security, provedByEmail: boolean) {
  const held = way === 'email' ? s.heldUntil : null; // the API sends none without an email
  if (held && provedByEmail) return { next: 'wait' as const, until: held };
  if (s.fresh && !held) return { next: 'new' as const };
  const via = s.email && (held || !s.phone) ? ('email' as const) : s.phone ? ('phone' as const) : null;
  return via && { next: 'prove' as const, via, to: via === 'email' ? s.email! : s.phone! };
}
