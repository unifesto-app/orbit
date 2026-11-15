// What the sign-in sheet (src/app/login.tsx) reads from what's typed. Pure, so it runs on Node in signin.test.ts. Rules
// from the User flow doc (settled 15 Nov 2026): one field takes a phone number or an email, phones are +91 only
// (decision 11), and the date of birth is asked once, on About you, with no account under 18 (decision 5).

export type Contact = { kind: 'phone'; e164: string } | { kind: 'email'; email: string };

// An Indian mobile: 10 digits from 6 to 9, typed bare, with +91 or 91, or with a leading 0. Spaces, dashes and brackets
// are ignored. "abroad" is a number with another country's code, which Orbit doesn't take.
export function readPhone(text: string): string | 'abroad' | null {
  const t = text.replace(/[\s\-()]/g, '');
  if (/^\+(?!91)\d/.test(t)) return 'abroad';
  const m = /^(?:\+91|91(?=\d{10}$)|0(?=\d{10}$))?([6-9]\d{9})$/.exec(t);
  return m ? `+91${m[1]}` : null;
}

// The field's text as a phone or an email, the email lowercased (the doc's identity), else what's wrong with it.
export function readContact(text: string): Contact | 'abroad' | null {
  const t = text.trim();
  if (t.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? { kind: 'email', email: t.toLowerCase() } : null;
  const phone = readPhone(t);
  return phone === 'abroad' || phone === null ? phone : { kind: 'phone', e164: phone };
}

// "+91 98765 43210".
export const showPhone = (e164: string) => `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;

// "R••• K•••": the doc's masked account on "Is this you?", enough for its owner to know it.
export const maskName = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => `${w[0].toUpperCase()}•••`)
    .join(' ');

// The date field as it's typed, digits only, shown as "DD/MM/YYYY".
export function typeDob(text: string) {
  const d = text.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

// "12/03/2004" to "2004-03-12", if it's a real day between 1900 and `now`.
export function readDob(text: string, now: number): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const at = Date.UTC(+yyyy, +mm - 1, +dd);
  const real = new Date(at).getUTCDate() === +dd && new Date(at).getUTCMonth() === +mm - 1;
  return real && +yyyy >= 1900 && at <= now ? `${yyyy}-${mm}-${dd}` : null;
}

const indiaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }); // "2026-11-16"

// Whole years old on `now`'s day in India.
export function ageOn(dob: string, now: number) {
  const [y, m, d] = indiaDay.format(new Date(now)).split('-').map(Number);
  const [by, bm, bd] = dob.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export const ADULT = 18;
