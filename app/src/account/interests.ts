// Interests and Interested kept by the API (api/src/interests.ts, orbit-pm X13): the read at sign-in and launch, and the
// taps. Pure, so interests.test.ts runs on Node; the session (src/session.ts) gives it the calls, its state and its queue.
// - Every write goes on the session's queue, in tap order, and is never sent for an account that has since left.
// - A read waits for the writes still out, and goes again if a tap landed while it was out, so it never draws an answer
//   older than a tap (signing in from I'm interested taps before the first read lands).
// - Until a read has landed for this sign-in (`status` ready), the picks aren't known: Home doesn't ask and the picker
//   waits, so a "Not now" or one tap can never send a list that wipes the server's picks.
// - A refused write is put back only if no later tap has changed the same thing since.
import type { CategorySlug, MyInterested, MyInterests } from '@orbit/contract';

import type { Result } from '../api.ts';

export type Mine = { who: string; interests?: readonly CategorySlug[]; interested?: readonly string[] };
export type InterestsStatus = 'loading' | 'ready' | 'failed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIES = 3;

export function interestsSync(d: {
  mine: () => Mine | null; // the signed-in account's, or null signed out
  apply: (patch: Partial<Omit<Mine, 'who'>>) => void;
  serial: <T>(send: () => Promise<T>) => Promise<T>; // the session's queue
  get: () => Promise<Result<MyInterests>>;
  getInterested: () => Promise<Result<MyInterested>>;
  put: (interests: readonly CategorySlug[]) => Promise<Result<unknown>>;
  mark: (eventId: string, on: boolean) => Promise<Result<unknown>>;
  alert: (title: string, message: string) => void;
  changed: () => void; // the status moved
}) {
  let status: InterestsStatus = 'loading';
  let epoch = 0; // bumped by every tap
  let lastPut = 0; // the epoch of the latest interests write
  const lastMark = new Map<string, number>(); // each event's latest Interested tap
  const setStatus = (s: InterestsStatus) => {
    if (s !== status) (status = s), d.changed();
  };
  // Sent in turn, and only while the same account is in.
  const send = <T>(who: string, run: () => Promise<Result<T>>) =>
    d.serial(() => (d.mine()?.who === who ? run() : Promise.resolve<Result<T>>({ ok: true, data: undefined as T })));

  function putInterests(next: readonly CategorySlug[], quiet = false) {
    const m = d.mine();
    if (!m) return;
    const before = m.interests;
    const mine = (lastPut = ++epoch);
    d.apply({ interests: next });
    void send(m.who, () => d.put(next)).then((r) => {
      if (r.ok || d.mine()?.who !== m.who || mine !== lastPut) return; // a later list says what's wanted now
      d.apply({ interests: before });
      if (!quiet) d.alert('Couldn’t save your interests', r.error.message);
    });
  }

  return {
    status: () => status,
    // A new account, or none: nothing is known until it reads.
    reset() {
      epoch++;
      setStatus('loading');
    },
    // The whole list. Does nothing until the read has landed (the picker and Home's ask wait for it too).
    setInterests(next: readonly CategorySlug[]) {
      if (status === 'ready') putInterests(next);
    },
    setInterested(eventId: string, on: boolean) {
      const m = d.mine();
      if (!m) return;
      const turned = (o: boolean) => [...(d.mine()?.interested ?? []).filter((x) => x !== eventId), ...(o ? [eventId] : [])];
      d.apply({ interested: turned(on) });
      if (!UUID.test(eventId)) return; // the old mock's events stay on the phone
      const mine = ++epoch;
      lastMark.set(eventId, mine);
      void send(m.who, () => d.mark(eventId, on)).then((r) => {
        if (r.ok || d.mine()?.who !== m.who || lastMark.get(eventId) !== mine) return;
        d.apply({ interested: turned(!on) });
        d.alert('Couldn’t change that', r.error.message);
      });
    },
    // Picks this phone kept from before the API had them (null there) go up once, quietly (a failure tries again next
    // launch); otherwise the server's win. The old mock's Interested stay on the phone.
    // ponytail: Interested on real events tapped before X13 stayed on the phone and are dropped here; carry them up too
    // if anyone misses theirs.
    async load() {
      const who = d.mine()?.who;
      if (!who) return;
      if (status === 'failed') setStatus('loading');
      for (let tries = 0; tries < TRIES; tries++) {
        const at = epoch;
        const [mine, events] = await d.serial(() => Promise.all([d.get(), d.getInterested()])); // behind the writes out
        const now = d.mine();
        if (now?.who !== who) return;
        if (at !== epoch) continue; // a tap since: read again after it
        if (!mine.ok || !events.ok) break;
        d.apply({ interested: [...(now.interested ?? []).filter((x) => !UUID.test(x)), ...events.data.events] });
        setStatus('ready');
        if (mine.data.interests === null && now.interests !== undefined) putInterests(now.interests, true);
        else d.apply({ interests: mine.data.interests ?? undefined });
        return;
      }
      if (status !== 'ready') setStatus('failed');
    },
  };
}
