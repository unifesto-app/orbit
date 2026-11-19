"use server";

import type { ContentKey } from "@orbit/contract";
import { refresh } from "next/cache";
import { galaxy } from "../../../api";

// App content's one change (API: PUT /galaxy/app-content/:key): a whole list, with when the editor's copy was read, so a
// save over someone else's since is refused. The API checks Platform and every field; this only carries the list over.
// `at` always comes back: the new one after a save, the same one after a refusal, so fixing a field and saving again
// isn't taken for someone else's change. `sent` is the list as saved, so the editor can tell whether it's changed since.
export type Saved = { error?: string; at?: string; sent?: string };

export async function saveList(key: ContentKey, _: Saved, f: FormData): Promise<Saved> {
  const sent = String(f.get("value") ?? "");
  const given = String(f.get("at") ?? "") || null;
  let value: unknown;
  try {
    value = JSON.parse(sent);
  } catch {
    return { error: "Check what you typed and try again.", at: given ?? undefined };
  }
  const r = await galaxy<{ at: string }>("PUT", `/galaxy/app-content/${encodeURIComponent(key)}`, { value, at: given });
  if (!r.ok) return { error: r.error.message, at: given ?? undefined };
  refresh(); // the page reads again, so "Last saved" says who and when
  return { at: r.data.at, sent };
}
