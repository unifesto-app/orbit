// Hosts from the Orbit API (api/src/hosts, live 17 Nov 2026): the public host page, follows, the team's own view in
// Console, and Galaxy's host tools. Pure, so it runs on Node in hosts.test.ts; screens pass it `api` from session.ts.
// The rest of the app still draws from the mock (src/mock.ts) until events reach the API, so a host is real when its id
// is a UUID, as the API's are, and a mock one otherwise. Each screen asks `isReal` in one place and keeps its mock path.
// ponytail: the team, staff page, follows and find answers are typed here, not in @orbit/contract; move them there when
// the web reads them too.
import { HOST_KINDS, type HostPage, type PublicHost } from '@orbit/contract';

import type { makeApi } from './api.ts';

type Api = Pick<ReturnType<typeof makeApi>, 'call' | 'authed'>;

export const isReal = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

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

// A host the team works on, in the shape Console's screens draw (the mock host's fields they read, plus its status).
export type DrawHost = ReturnType<typeof drawHost>;
export const drawHost = (p: HostPage) => ({
  ...markOf(p),
  id: p.id,
  slug: p.slug,
  name: p.name,
  verified: p.verified,
  kind: kindLabel(p.kind),
  area: p.city,
  followers: p.followers,
  status: p.status,
  suspendReason: p.suspendReason,
  owner: p.owner,
});

export type Followed = { id: string; slug: string; name: string; city: string; verified: boolean; logo: string | null };
export type TeamList = {
  members: { id: string; userId: string; name: string | null; role: 'admin'; owner: boolean }[];
  invites: { id: string; contact: string; accepted: boolean; acceptedBy: string | null; addedBy: string }[]; // Admins only
};
export type Found = { id: string; slug: string; name: string; city: string; status: HostPage['status']; verified: boolean };
export type StaffHost = Omit<HostPage, 'verified' | 'owner' | 'parent' | 'clubs'> & {
  parent: { id: string; slug: string; name: string } | null;
  verified: { at: string; by: string } | null;
  clubs: { id: string; slug: string; name: string; status: HostPage['status'] }[];
  team: { userId: string; name: string | null; role: 'admin'; owner: boolean }[];
  owner: { id: string; name: string | null; phone: string | null; email: string | null };
};
export type StatusAction = 'pause' | 'resume' | 'archive' | 'restore';

// What the owner may do from each status (the API's statusRule): a suspended host is staff's to lift.
export const ownerMoves: Record<HostPage['status'], StatusAction[]> = {
  live: ['pause', 'archive'],
  paused: ['resume', 'archive'],
  archived: ['restore'],
  suspended: [],
};

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
    page: (id: string) => api.authed<HostPage>('GET', `/hosts/${id}`),
    team: (id: string) => api.authed<TeamList>('GET', `/hosts/${id}/team`),
    move: (id: string, action: StatusAction) => api.authed<{ id: string; status: HostPage['status'] }>('POST', `/hosts/${id}/${action}`),
    find: (q: string) => api.authed<Found[]>('GET', `/galaxy/hosts?q=${encodeURIComponent(q)}`),
    staffPage: (id: string) => api.authed<StaffHost>('GET', `/galaxy/hosts/${id}`),
    // The name staff saw goes with the verify, so the tick never lands on a name nobody checked.
    verify: (id: string, reason: string, name: string) => api.authed<unknown>('POST', `/galaxy/hosts/${id}/verify`, { reason, name }),
    unverify: (id: string, reason: string) => api.authed<unknown>('DELETE', `/galaxy/hosts/${id}/verify`, { reason }),
    suspend: (id: string, reason: string) => api.authed<unknown>('POST', `/galaxy/hosts/${id}/suspend`, { reason }),
    lift: (id: string, reason: string) => api.authed<unknown>('POST', `/galaxy/hosts/${id}/lift`, { reason }),
  };
}
