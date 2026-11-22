// Which sign-in screen follows the API's answer (sign-in take, approved 22 Nov 2026; the Orbit app's own steps, User flow
// doc). Codes only for now: a phone number or email, its code, then "Is this you?" for a phone code on a new phone, a
// WhatsApp number for a new account started by email, About you for a new account, or signed in. Pure, for Node's tests.
import type { AuthStep } from '@orbit/contract';

export type Step =
  | { at: 'contact' } // a phone number or email
  | { at: 'phone'; signup: string } // a new account started by email adds its WhatsApp number
  | { at: 'code'; to: string; shown: string; signup?: string; until: number } // `until`: when Resend opens
  | { at: 'confirm'; ticket: string; name: string; since: number } // `since`: the year the account began
  | { at: 'aboutYou'; signup: string; name: string | null };

// The screen after an answer from /auth/code/verify, /auth/confirm or /auth/signup that isn't signed in yet.
export function stepAfter(s: Exclude<AuthStep, { step: 'signedIn' }>): Step {
  if (s.step === 'confirm') return { at: 'confirm', ticket: s.ticket, name: s.name, since: s.since };
  if (s.step === 'phone') return { at: 'phone', signup: s.signup };
  return { at: 'aboutYou', signup: s.signup, name: s.name };
}

// Where Back goes: from a new account's WhatsApp code to its number again, keeping the sign-up; else to the start.
export const stepBack = (s: Step): Step => (s.at === 'code' && s.signup ? { at: 'phone', signup: s.signup } : { at: 'contact' });

// Whole seconds until Resend opens, never below 0.
export const secondsLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / 1000));
// "0:24".
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// "Is this you?"'s account: the masked name's initials ("A••• R•••" → "AR"), or none when there's no name to show.
export const initialsOf = (masked: string) => {
  const words = masked.trim().split(/\s+/).filter((w) => w.includes('•'));
  return words.length ? words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') : '';
};
