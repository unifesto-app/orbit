"use server";

import type { PmStatus, PmTask, SaveTask } from "@orbit/contract";
import { refresh } from "next/cache";
import { galaxy } from "../../../api";

// The PM board's changes (API: /galaxy/pm/*), all Server Actions: the API checks the Platform feature, and the
// owner for tokens, on every call. Each answers with the API's message when it says no.

type Saved = { error?: string };
const done = async (r: Awaited<ReturnType<typeof galaxy>>): Promise<Saved> => {
  if (!r.ok) return { error: r.error.message };
  refresh(); // the board reads again, so it shows what changed
  return {};
};

export async function moveTask(key: string, status: PmStatus) {
  return done(await galaxy("PUT", "/galaxy/pm/tasks", { key, status }));
}

// `ifUpdatedAt` is when the dialog read the task: a save over a change made since (often Claude's) is refused.
export async function saveTask(task: SaveTask) {
  return done(await galaxy("PUT", "/galaxy/pm/tasks", task));
}

export async function addNote(key: string, message: string) {
  return done(await galaxy("POST", "/galaxy/pm/notes", { key, message }));
}

export async function saveTrack(key: string, name: string) {
  return done(await galaxy("PUT", "/galaxy/pm/tracks", { key, name }));
}

// The whole task, with its notes and last 20 changes, for the dialog. Read fresh each time it opens.
export async function readTask(key: string): Promise<{ task?: PmTask; error?: string }> {
  const r = await galaxy<PmTask>("GET", `/galaxy/pm/tasks/${encodeURIComponent(key)}`);
  return r.ok ? { task: r.data } : { error: r.error.message };
}

// The new token comes back here once and is held only in the Connect page's state; it's never put in the page the
// server renders, a cookie or the address.
export async function createToken(name: string): Promise<{ token?: string; error?: string }> {
  const r = await galaxy<{ id: string; name: string; token: string }>("POST", "/galaxy/pm/tokens", { name });
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { token: r.data.token };
}

export async function revokeToken(id: string) {
  return done(await galaxy("DELETE", `/galaxy/pm/tokens/${encodeURIComponent(id)}`));
}
