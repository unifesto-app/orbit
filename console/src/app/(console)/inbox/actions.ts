"use server";

import type { InboxPage } from "@orbit/contract";
import { call } from "../../../api";
import { INBOX_APP, readBody } from "../../../inbox";

// The unread count beside Inbox in the top bar; null when the API can't say.
// ponytail: GET /me/inbox brings its first 30 rows along; add a count-only route if this read ever shows up.
export async function unreadCount(): Promise<number | null> {
  const r = await call<InboxPage>("GET", `/me/inbox?app=${INBOX_APP}`);
  return r.ok ? r.data.unread : null;
}

// Those messages read, or every one with no ids. False when it didn't take.
export async function markRead(ids?: string[]): Promise<boolean> {
  const body = readBody(ids);
  if (!body) return false;
  return (await call("POST", "/me/inbox/read", body)).ok;
}
