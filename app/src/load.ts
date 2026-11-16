// A request a screen draws from. It runs when `key` changes (null runs nothing) and again on `reload`. An answer that
// arrives after the key moved on is dropped, so switching host never draws the one before; with `keep`, the last good
// answer stays up while the next key loads (`loading` says so). A failed answer never wipes good data: `error` says what
// went wrong and the screen decides whether to show it over what's there.
// ponytail: no cache shared between screens; each opens its own request. TanStack Query, as the plan has it, once more
// of the app reads the API.
import type { ApiError } from '@orbit/contract';
import { useCallback, useEffect, useState } from 'react';

import type { Result } from './api.ts';

// The last good answer, and the latest answer of any kind, each with the key it was for.
export type Got<T> = { good: { key: string; data: T } | null; last: { key: string; error: ApiError | null; status: number } | null };
export const nothing: Got<never> = { good: null, last: null };

export const settle = <T>(g: Got<T>, key: string, r: Result<T>): Got<T> =>
  r.ok ? { good: { key, data: r.data }, last: { key, error: null, status: 200 } } : { good: g.good, last: { key, error: r.error, status: r.status } };

export const view = <T>(g: Got<T>, key: string | null, keep: boolean) => ({
  data: g.good && (g.good.key === key || keep) ? g.good.data : null,
  error: g.last?.key === key ? g.last.error : null,
  status: g.last?.key === key ? g.last.status : 0,
  loading: key !== null && g.last?.key !== key,
});

export function useLoad<T>(key: string | null, run: () => Promise<Result<T>>, { keep = false } = {}) {
  const [got, setGot] = useState<Got<T>>(nothing);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    void run().then((r) => live && setGot((g) => settle(g, key, r)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` and `round` say when to run again
  }, [key, round]);
  return { ...view(got, key, keep), reload: useCallback(() => setRound((n) => n + 1), []) };
}
