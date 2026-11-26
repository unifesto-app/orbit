"use server";

import type { DeliveryLog } from "@orbit/contract";
import { refresh } from "next/cache";
import { galaxy } from "../../../api";
import type { Done } from "../actions";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// A kill switch off or back on (API: PUT /galaxy/notifications/switches/:kind/:channel). The API checks Platform, the
// kind, the channel and the reason, logs it and emails everyone with Platform.
export async function setSwitch(_: Done, f: FormData): Promise<Done> {
  const path = `/galaxy/notifications/switches/${encodeURIComponent(text(f, "kind"))}/${encodeURIComponent(text(f, "channel"))}`;
  const r = await galaxy("PUT", path, { off: text(f, "off") === "true", reason: text(f, "reason") });
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: Date.now() };
}

// The delivery log for one person. A Server Action, never a link, as People's search: what's typed is a phone number or
// an email, and an address would carry it into access logs and the browser's history.
export type Looked = { q: string; log?: DeliveryLog; error?: string };
export async function searchDeliveries(_: Looked, f: FormData): Promise<Looked> {
  const q = text(f, "q");
  if (!q) return { q };
  const r = await galaxy<DeliveryLog>("GET", `/galaxy/notifications/deliveries?q=${encodeURIComponent(q)}`);
  return r.ok ? { q, log: r.data } : { q, error: r.error.message };
}
