import type { EditEvent, EventStatus, EventVisibility, Place } from "@orbit/contract";

// The Hosts and Discover flows' rules for events as pure functions: routes load the rows and apply the answer.

type Timed = { status: EventStatus; endsAt: Date | null };
// The columns an edit may be compared with.
type Stored = Timed & {
  category?: string | null; inRoom?: boolean;
  startsAt: Date | null; timezone: string; online: boolean; onlineLink: string | null;
  venue: string | null; address: string | null; area: string | null; city: string | null; lat: number | null; lng: number | null; placeId: string | null;
};

const PLACE = ["venue", "address", "area", "city", "lat", "lng", "placeId"] as const;
const instant = (s: string | null | undefined) => (s ? new Date(s).getTime() : null);

// Which of the date and place fields the patch would change from what's stored (a value sent unchanged isn't a change).
const moved = (e: Stored, p: EditEvent) =>
  ("startsAt" in p && instant(p.startsAt) !== (e.startsAt?.getTime() ?? null)) ||
  ("endsAt" in p && instant(p.endsAt) !== (e.endsAt?.getTime() ?? null)) ||
  ("timezone" in p && p.timezone !== e.timezone) ||
  ("online" in p && p.online !== e.online) ||
  ("onlineLink" in p && p.onlineLink !== e.onlineLink) ||
  ("place" in p && PLACE.some((k) => placeColumns(p.place ?? null)[k] !== e[k]));

// Everything stays editable until the event is cancelled (Hosts flow). Once a published event has ended, its date, place
// and online details can't change; its text can. A draft never locks. A published event's end can't be moved into the
// past by an edit (that would lock it by mistake): "End now" is the way to finish early. Once it has started, the host
// can't turn inRoom on or off (guests may already be meeting); staff can, in Galaxy.
export function editRule(event: Stored, patch: EditEvent, now: number): { ok: true } | { ok: false; error: "cancelled" | "ended" | "endInPast" | "needed" | "started" } {
  if (event.status === "cancelled") return { ok: false, error: "cancelled" };
  if (event.status === "draft") return { ok: true };
  if ("inRoom" in patch && patch.inRoom !== event.inRoom && event.startsAt !== null && event.startsAt.getTime() <= now) return { ok: false, error: "started" };
  const ended = event.endsAt !== null && event.endsAt.getTime() <= now;
  if (ended && moved(event, patch)) return { ok: false, error: "ended" };
  const end = "endsAt" in patch ? instant(patch.endsAt) : null;
  if (!ended && end !== null && end <= now) return { ok: false, error: "endInPast" };
  // What publishing needed stays: no clearing the dates or category, and a place or an online link must remain (H5.3).
  if (patch.startsAt === null || patch.endsAt === null || patch.category === null) return { ok: false, error: "needed" };
  const hasPlace = "place" in patch ? patch.place !== null : event.venue !== null;
  const online = "online" in patch ? patch.online : event.online;
  const link = "onlineLink" in patch ? patch.onlineLink : event.onlineLink;
  if (!hasPlace && !(online && link)) return { ok: false, error: "needed" };
  return { ok: true };
}

// The contract checks start and end only when both come in one request; this checks them as they'd be stored.
export function timesRule(stored: { startsAt: Date | null; endsAt: Date | null }, patch: EditEvent): { ok: true } | { ok: false; error: "endsBeforeStart" } {
  const startsAt = "startsAt" in patch ? (patch.startsAt ? new Date(patch.startsAt) : null) : stored.startsAt;
  const endsAt = "endsAt" in patch ? (patch.endsAt ? new Date(patch.endsAt) : null) : stored.endsAt;
  return startsAt && endsAt && endsAt.getTime() <= startsAt.getTime() ? { ok: false, error: "endsBeforeStart" } : { ok: true };
}

// Private: no public page, and every event link-only (Hosts flow).
export function visibilityRule(hostVisibility: "public" | "private", patch: EditEvent): { ok: true } | { ok: false; error: "linkOnly" } {
  const want: EventVisibility | undefined = patch.visibility;
  return hostVisibility === "private" && want === "public" ? { ok: false, error: "linkOnly" } : { ok: true };
}

// What an event shows as: a private host's events are all link-only, whatever the event stored.
export const effectiveVisibility = (host: "public" | "private", stored: EventVisibility): EventVisibility => (host === "private" ? "link" : stored);

// Drafts, then upcoming and past by the clock: upcoming means endsAt is in the future (Discover flow). A cancelled event
// goes by its time like the rest. GET /hosts/:id/events asks the same in SQL; keep the two alike.
export function stageOf(event: Timed, now: number): "draft" | "upcoming" | "past" {
  if (event.status === "draft") return "draft";
  return event.endsAt && event.endsAt.getTime() <= now ? "past" : "upcoming";
}

// A place is written or cleared whole: writing only some of its columns trips the database's place checks.
export const placeColumns = (place: Place | null) => ({
  venue: place?.venue ?? null,
  address: place?.address ?? null,
  area: place?.area ?? null,
  city: place?.city ?? null,
  lat: place?.lat ?? null,
  lng: place?.lng ?? null,
  placeId: place?.placeId ?? null,
});
