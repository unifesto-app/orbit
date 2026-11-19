// Hosts from the Orbit API (api/src/hosts, live 17 Nov 2026): the public host page and follows. Pure, so it runs on Node
// in hosts.test.ts; screens pass it `api` from session.ts. The rest of the app still draws from the mock (src/mock.ts)
// until events reach the API.
// ponytail: the follows answer is typed here, not in @orbit/contract; move it there when the web reads it too.
import { HOST_KINDS, type PublicHost } from '@orbit/contract';

import type { makeApi } from './api.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'call' | 'authed'>;

// Until logos upload, a real host draws as a monogram: its initials on one of the mock hosts' colours, picked from its
// id so it keeps the same one everywhere.
const PALETTE: readonly [string, string][] = [
  ['#F2C14E', '#141414'],
  ['#166534', '#FFFFFF'],
  ['#B5532E', '#FFFFFF'],
  ['#FF3D7F', '#FFFFFF'],
  ['#C6F432', '#0A0F1F'],
  ['#12002B', '#22D3EE'],
  ['#7598FF', '#0A0F1F'],
  ['#099268', '#FFFFFF'],
];
export function markOf(h: { id: string; name: string }) {
  const words = h.name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const initials = words.slice(0, 2).map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, '')][0]!.toUpperCase()).join('') || '?';
  let n = 0;
  for (const ch of h.id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[n % PALETTE.length]!;
  return { initials, bg, fg };
}

export const kindLabel = (kind: string) => HOST_KINDS[kind as keyof typeof HOST_KINDS] ?? 'Host';

export type Followed = { id: string; slug: string; name: string; city: string; verified: boolean; logo: string | null };

export function hostsApi(api: Api) {
  return {
    // Anyone may read it; signed in, the answer also says whether they follow it. Signed out it never touches the
    // session, so a visitor's read can't end one.
    publicHost: (slug: string, signedIn: boolean) => {
      const path = `/public/hosts/${encodeURIComponent(slug)}`;
      return signedIn ? api.authed<PublicHost>('GET', path) : api.call<PublicHost>('GET', path);
    },
    follow: (id: string, on: boolean) => api.authed<unknown>(on ? 'POST' : 'DELETE', `/hosts/${id}/follow`),
    follows: () => api.authed<Followed[]>('GET', '/me/follows'),
  };
}
