// Team invites waiting for this account (GET /me/invites) and accepting one (POST /invites/:id/accept), then the
// account read again so a started role shows in its teams. Welcome lists them; Event Partner's Host tab too, for an
// Admin invited to another host.
import { useLoad } from '@orbit/mobile/load';
import { useState } from 'react';

import { api, refreshMe, useSession } from '../session';

export type Invite = { id: string; hostId: string; hostName: string; role: 'admin' | 'crew'; accepted: boolean };

export function useInvites() {
  const me = useSession()?.me;
  const invites = useLoad<Invite[]>(me ? `invites|${me.id}` : null, () => api.authed<Invite[]>('GET', '/me/invites'));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function accept(i: Invite) {
    setBusy(i.id);
    setError(null);
    const r = await api.authed('POST', `/invites/${i.id}/accept`);
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    invites.reload();
    void refreshMe();
  }
  return { invites, busy, error, accept };
}
