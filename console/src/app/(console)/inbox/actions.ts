"use server";

import type { InboxPage } from "@orbit/contract";
import { cookies } from "next/headers";
import { call } from "../../../api";
import { ACCESS, apiFetch } from "../../../session";
import { INBOX_APP, readBody } from "../../../inbox";

// The unread count beside Inbox in the top bar; null when the API can't say.
// ponytail: GET /me/inbox brings its first 30 rows along; add a count-only route if this read ever shows up.
// A background poll, so never call(): its redirect to /login would throw a signed-in person out mid-page when a token
// renewal failed for a moment (API deploy). No token or any error → null, the badge just stays as it was.
export async function unreadCount(): Promise<number | null> {
  const access = (await cookies()).get(ACCESS)?.value;
  if (!access) return null;
  const r = await apiFetch<InboxPage>("GET", `/me/inbox?app=${INBOX_APP}`, { access });
  return r.ok ? r.data.unread : null;
}

// Those messages read, or every one with no ids. False when it didn't take.
export async function markRead(ids?: string[]): Promise<boolean> {
  const body = readBody(ids);
  if (!body) return false;
  return (await call("POST", "/me/inbox/read", body)).ok;
}
