// Event Requests: someone with no host asks to host an event, with the host's details and the event's (owner, 16 Nov
// 2026: "It should be Event Request in it add Host Details too", then "Orbit staff approve first"). A request waits for
// staff with Hosts and events (Roles doc: deciding a request needs the feature that owns it). Approved, the host is made
// with the requester as owner and the event lands as a draft; declined comes with a note. Either way they hear by push and email.
// This replaces the Hosts doc's "live at once, Unverified" for people starting their first host from the app.
// ponytail: kept in memory until the API takes requests; it's gone when the app restarts.
import { useSyncExternalStore } from 'react';

export type EventRequest = {
  id: string;
  sent: string; // ISO
  host: { name: string; kind: string; city: string; about: string };
  event: { title: string; category: string; when: string; venue: string; tickets: 'Free' | 'Paid'; size: string };
  status: 'Requested' | 'Approved' | 'Declined';
  note?: string; // staff's reason, on a decline
};

let mine: EventRequest | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

// The viewer's request, if they've sent one.
export const useMyRequest = () => useSyncExternalStore(subscribe, () => mine);

export function sendRequest(r: Pick<EventRequest, 'host' | 'event'>) {
  mine = { ...r, id: `rq_${Date.now().toString(36)}`, sent: new Date().toISOString(), status: 'Requested' };
  for (const fn of listeners) fn();
}
