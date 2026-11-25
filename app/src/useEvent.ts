// One event for a screen, read from the API first (GET /public/events/:slug, an old slug too). Only when the API says
// 404 and the slug is a mock event's id does the mock event draw (tickets, saved and history still link to mock events
// until their slices), so a real event can never be taken for a mock one. Offline on a mock link shows the failure.
// `screen` is what to draw while there's no event: the empty ground, Not found, or the failure with Try again.
import { createElement, type ReactNode } from 'react';

import { type Event, eventsApi, type Host, toEvent, toHost } from './events';
import { useLoad } from './load';
import { events as mockEvents, hosts as mockHosts, now as mockNow } from './mock';
import { Failed, NotFound, Waiting } from './rows';
import { api } from './session';

type Found = { e: Event; host: Host; now: number; live: boolean; screen?: undefined };
type Missing = { e?: undefined; host?: undefined; now?: undefined; live?: undefined; screen: ReactNode };

export function useEvent(slug: string): (Found | Missing) & { slug: string } {
  const page = useLoad(`event|${slug}`, () => eventsApi(api).event(slug));
  const mock = page.status === 404 ? mockEvents.find((x) => x.id === slug) : undefined;
  if (mock) return { slug, e: mock, host: mockHosts.find((h) => h.id === mock.hostId)!, now: mockNow, live: false };
  if (page.data) return { slug: page.data.slug, e: toEvent(page.data), host: toHost(page.data.host), now: Date.now(), live: true };
  const screen = page.status === 404 ? createElement(NotFound, { what: 'event' }) : page.error ? createElement(Failed, { message: page.error.message, retry: page.reload }) : createElement(Waiting);
  return { slug, screen };
}
