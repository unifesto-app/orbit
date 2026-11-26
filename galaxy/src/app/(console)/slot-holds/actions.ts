"use server";

import { refresh } from "next/cache";
import { galaxy } from "../../../api";
import type { Done } from "../actions";

// A live hold ends now (API: POST /galaxy/slot-holds/:claimId/release). The API checks Hosts, logs it and emails
// everyone with Hosts.
export async function releaseHold(_: Done, f: FormData): Promise<Done> {
  const id = encodeURIComponent(String(f.get("id") ?? ""));
  const r = await galaxy("POST", `/galaxy/slot-holds/${id}/release`, { reason: String(f.get("reason") ?? "").trim() });
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: Date.now() };
}
