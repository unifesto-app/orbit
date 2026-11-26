// A host's money from the API (GET /hosts/:id/money; X4), for its Admins in both host apps: Event Partner's Money tab,
// Play Partner's Money tab and the payout sheet. Read again each time the screen comes back into view, so an ask or
// an account sent from a sheet shows once it closes.
import type { HostMoney } from '@orbit/contract';
import { useLoad } from '@orbit/mobile/load';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

import { api } from './session';

export function useHostMoney(hostId: string | null | undefined) {
  const m = useLoad<HostMoney>(hostId ? `money|${hostId}` : null, () => api.authed<HostMoney>('GET', `/hosts/${hostId}/money`));
  const seen = useRef(false);
  const { reload } = m;
  useFocusEffect(
    useCallback(() => {
      if (seen.current) reload(); // the first view is the load itself
      seen.current = true;
    }, [reload]),
  );
  return m;
}
