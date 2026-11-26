"use server";

import type { Broadcast } from "@orbit/contract";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { galaxy } from "../../../../api";
import type { Done } from "../../actions";

// Broadcasts' changes (API: /galaxy/notifications/broadcasts), for holders of Platform. The API checks the feature,
// every field and who may confirm; this only reads the form.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export type Composed = { error?: string; count?: number };

// The segment the form picked: everyone, a city, a host's followers or an event's guests.
const segmentOf = (f: FormData) => {
  const by = text(f, "segment");
  return by === "city" ? { city: text(f, "city") } : by === "host" ? { hostId: text(f, "hostId") } : by === "event" ? { eventId: text(f, "eventId") } : { all: true };
};

// "count": the audience for the segment, shown before Save. "save": written as waiting, then its own page.
// The send time is typed in India's time.
export async function compose(_: Composed, f: FormData): Promise<Composed> {
  const segment = segmentOf(f);
  if (text(f, "intent") === "count") {
    const r = await galaxy<{ audienceCount: number }>("POST", "/galaxy/notifications/broadcasts/count", { segment });
    return r.ok ? { count: r.data.audienceCount } : { error: r.error.message };
  }
  const at = text(f, "sendAt");
  const r = await galaxy<Broadcast>("POST", "/galaxy/notifications/broadcasts", {
    type: text(f, "type"),
    segment,
    channels: f.getAll("channels").map(String),
    title: text(f, "title"),
    text: text(f, "text"),
    ...(text(f, "when") === "later" && at ? { sendAt: new Date(`${at}:00+05:30`).toISOString() } : {}),
  });
  if (!r.ok) return { error: r.error.message };
  redirect(`/notifications/broadcasts/${r.data.id}`);
}

export async function confirmBroadcast(id: string): Promise<Done> {
  const r = await galaxy("POST", `/galaxy/notifications/broadcasts/${encodeURIComponent(id)}/confirm`);
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: Date.now() };
}

export async function cancelBroadcast(_: Done, f: FormData): Promise<Done> {
  const r = await galaxy("POST", `/galaxy/notifications/broadcasts/${encodeURIComponent(text(f, "id"))}/cancel`, { reason: text(f, "reason") });
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: Date.now() };
}
