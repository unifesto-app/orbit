"use server";

import { refresh } from "next/cache";
import { galaxy } from "../../../api";
import type { Done } from "../actions";

// Money's risky actions (API: /galaxy/money/*). The API checks Money, the amounts and the reason, writes the audit row
// and emails everyone with Money; these only carry the form across.
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const id = (f: FormData) => encodeURIComponent(text(f, "id"));
// Rupees as typed ("499.50") to whole paise; anything unreadable goes as 0, which the API refuses.
const paise = (f: FormData) => Math.round(Number(text(f, "rupees")) * 100) || 0;

async function run(method: "POST" | "PUT", url: string, body: unknown): Promise<Done> {
  const r = await galaxy(method, url, body);
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: Date.now() };
}

export const refund = async (_: Done, f: FormData) =>
  run("POST", `/galaxy/money/payments/${id(f)}/refund`, { amountPaise: paise(f), reason: text(f, "reason") });
export const retryRefund = async (_: Done, f: FormData) => run("POST", `/galaxy/money/refunds/${id(f)}/retry`, { reason: text(f, "reason") });
export const newPayout = async (_: Done, f: FormData) =>
  run("POST", "/galaxy/money/payouts", { eventId: text(f, "eventId"), amountPaise: paise(f), reason: text(f, "reason") });
export const payoutPaid = async (_: Done, f: FormData) =>
  run("POST", `/galaxy/money/payouts/${id(f)}/paid`, { utr: text(f, "utr"), reason: text(f, "reason") });
export const cancelPayout = async (_: Done, f: FormData) => run("POST", `/galaxy/money/payouts/${id(f)}/cancel`, { reason: text(f, "reason") });
export const setFees = async (_: Done, f: FormData) =>
  run("PUT", `/galaxy/money/fees/${id(f)}`, { plan: text(f, "plan"), feeIncluded: f.get("feeIncluded") === "on", reason: text(f, "reason") });
