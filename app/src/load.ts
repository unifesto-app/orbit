// A request a screen draws from. It runs when `key` changes (null runs nothing) and again on `reload`. An answer that
// arrives after the key moved on is dropped, so switching host never draws the one before; with `keep`, the last answer
// stays up while the next key loads (`loading` says so). A reload keeps showing what was there until the new answer
// lands.
// ponytail: no cache shared between screens; each opens its own request. TanStack Query, as the plan has it, once more
// of the app reads the API.
import type { ApiError } from '@orbit/contract';
import { useCallback, useEffect, useState } from 'react';

import type { Result } from './api';

type Got<T> = { key: string; data: T | null; error: ApiError | null; status: number };

export function useLoad<T>(key: string | null, run: () => Promise<Result<T>>, { keep = false } = {}) {
  const [got, setGot] = useState<Got<T> | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    void run().then((r) => {
      if (live) setGot(r.ok ? { key, data: r.data, error: null, status: 200 } : { key, data: null, error: r.error, status: r.status });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` and `round` say when to run again
  }, [key, round]);
  const fresh = got !== null && got.key === key;
  return {
    data: fresh ? got.data : keep ? (got?.data ?? null) : null,
    error: fresh ? got.error : null,
    status: fresh ? got.status : 0,
    loading: key !== null && !fresh,
    reload: useCallback(() => setRound((n) => n + 1), []),
  };
}
