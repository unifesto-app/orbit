import { z } from "zod";
import { EventCategory, When } from "./events.ts";
import { CityName, HostKind } from "./roles.ts";
import { Text } from "./text.ts";

// Event Requests (Orbit flows: Hosts, H1.1–H1.7; docs/context/event-partner-api.md 2b): anyone signed in asks to host,
// with the host and its first event; staff approve, ask for changes or decline in Galaxy. One open request per person.

export const REQUEST_STATUSES = ["open", "changes", "approved", "declined", "withdrawn"] as const;
export const RequestStatus = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const RequestHost = z.object({
  name: Text(1, 100),
  kind: HostKind,
  city: CityName,
  about: Text(1, 2000).nullable().default(null),
});
export type RequestHost = z.infer<typeof RequestHost>;

export const RequestEvent = z.object({
  title: Text(1, 120),
  category: EventCategory,
  startsAt: When,
  venue: Text(1, 120).nullable().default(null), // as typed: the place search comes when the draft is edited
  paid: z.boolean(),
  expectedSize: z.number().int().min(1).max(1_000_000).nullable().default(null),
});
export type RequestEvent = z.infer<typeof RequestEvent>;

// Only Venues and Performers may come without an event (Hosts decision 23).
const NO_EVENT_KINDS: readonly string[] = ["venue", "performer"];
// POST /event-requests, and PATCH /me/event-request (the whole request again).
export const NewEventRequest = z
  .object({ host: RequestHost, event: RequestEvent.nullable().default(null) })
  .refine((b) => b.event !== null || NO_EVENT_KINDS.includes(b.host.kind), { message: "Tell us about your first event", path: ["event"] });
export type NewEventRequest = z.infer<typeof NewEventRequest>;

// POST /galaxy/event-requests/:id/approve | changes | decline. For changes and decline, the requester reads it.
export const DecideRequest = z.object({ reason: Text(3, 500) });

// What the API answers: the requester and Galaxy read the same shape (Galaxy adds who sent it).
export type EventRequest = {
  id: string;
  status: RequestStatus;
  note: string | null;
  host: RequestHost;
  event: RequestEvent | null;
  hostId: string | null;
  eventId: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};
// Galaxy: who sent it, contacts masked as on a host's staff page.
export type StaffEventRequest = EventRequest & {
  user: { id: string; name: string | null; phone: string | null; email: string | null };
  decidedBy: string | null;
};
