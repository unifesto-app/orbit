// What the sign-in sheet (src/app/login.tsx) reads from what's typed. Pure, so it runs on Node in signin.test.ts. Rules
// from the User flow doc (settled 15 Nov 2026): one field takes a phone number or an email, phones are +91 only
// (decision 11), and the date of birth is asked once, on About you, with no account under 18 (decision 5).

// The contact and age rules are the API's own (@orbit/contract), so the app and the API read a contact the same way.
export { ADULT, ageOn, type Contact, maskName, readContact, readPhone } from '@orbit/contract';

// "+91 98765 43210".
export const showPhone = (e164: string) => `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;

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
