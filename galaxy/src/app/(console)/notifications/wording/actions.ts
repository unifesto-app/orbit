"use server";

import { refresh } from "next/cache";
import { galaxy } from "../../../../api";

// Wording's three changes and its test send (API: /galaxy/notifications/templates/:kind/:channel). The API checks
// Platform, the fields, the lengths and the variables, and logs each.
export type Draft = { subject?: string; title?: string; body: string };
export type Answer = { error?: string; note?: string; updatedAt?: string | null };

const path = (kind: string, channel: string) => `/galaxy/notifications/templates/${encodeURIComponent(kind)}/${encodeURIComponent(channel)}`;

// `readAt`: the saved row's time as the page read it, so a save over someone else's since is refused.
export async function saveWording(kind: string, channel: string, draft: Draft, readAt: string | null): Promise<Answer> {
  const r = await galaxy<{ updatedAt: string }>("PUT", path(kind, channel), { ...draft, readAt });
  if (!r.ok) return { error: r.error.message, updatedAt: readAt };
  refresh();
  return { note: "Saved. It goes out within a minute.", updatedAt: r.data.updatedAt };
}

export async function resetWording(kind: string, channel: string): Promise<Answer> {
  const r = await galaxy("DELETE", path(kind, channel));
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { note: "Back to the wording in code.", updatedAt: null };
}

export async function testWording(kind: string, channel: string, draft: Draft): Promise<Answer> {
  const r = await galaxy<{ sent: number }>("POST", `${path(kind, channel)}/test`, draft);
  return r.ok ? { note: `Sent to you${r.data.sent > 1 ? ` on ${r.data.sent} phones` : ""}.` } : { error: r.error.message };
}
