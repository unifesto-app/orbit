// Hosts from the Orbit API (api/src/hosts, live 17 Nov 2026): the public host page and follows. Pure, so it runs on Node
// in hosts.test.ts; screens pass it `api` from session.ts. The rest of the app still draws from the mock (src/mock.ts)
// until events reach the API.
// ponytail: the follows answer is typed here, not in @orbit/contract; move it there when the web reads it too.
import { HOST_KINDS, type PublicHost } from '@orbit/contract';

import type { makeApi } from './api.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'call' | 'authed'>;

// Until logos upload, a real host draws as a monogram (shared with the host apps, @orbit/mobile/mark).
export { markOf } from '@orbit/mobile/mark';

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
