"use server";

import { AUDIENCES, type AutoMessages } from "@orbit/contract";
import { revalidatePath } from "next/cache";
import { call } from "../../../../api";

// An event's announcements and automatic messages (notifications PR 10). The API checks the text, the audience, who
// may and today's 3; these only pass the form on and say what it answered.
export type Sent = { error?: string; ok?: boolean; text?: string }; // text: kept on a refusal, as React clears the form

export async function announce(eventId: string, _: Sent, form: FormData): Promise<Sent> {
  const audience = AUDIENCES.find((a) => a === form.get("audience")) ?? "everyone";
  const text = String(form.get("text") ?? "");
  const r = await call("POST", `/events/${encodeURIComponent(eventId)}/announcements`, { text, audience });
  if (!r.ok) return { error: r.error.message, text };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export async function saveAuto(eventId: string, _: Sent, form: FormData): Promise<Sent> {
  const on = (k: keyof AutoMessages) => form.get(k) === "on";
  const r = await call("PUT", `/events/${encodeURIComponent(eventId)}/auto-messages`, { tomorrow: on("tomorrow"), startingSoon: on("startingSoon"), thanks: on("thanks") });
  if (!r.ok) return { error: r.error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}
