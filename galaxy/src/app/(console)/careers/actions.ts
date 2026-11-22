"use server";

import { type ApplicationStatus, type Opening, OPENING_KINDS, OPENING_STATUSES } from "@orbit/contract";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { galaxy } from "../../../api";

// Careers' changes (API: /galaxy/openings, /galaxy/applications), for holders of People. The API checks the feature and
// every field; this only reads the form.

export type Saved = { error?: string; ok?: boolean };

// One line each in a list box; blank lines dropped.
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const pick = <T extends string>(v: FormDataEntryValue | null, all: Record<T, string>, or: T) =>
  Object.hasOwn(all, String(v)) ? (String(v) as T) : or;

// A new opening (id null) goes to its own page once made; a saved one stays where it is.
export async function saveOpening(id: string | null, _: Saved, f: FormData): Promise<Saved> {
  const pay = String(f.get("pay") ?? "").trim();
  const opening: Opening = {
    title: String(f.get("title") ?? ""),
    team: String(f.get("team") ?? ""),
    place: String(f.get("place") ?? ""),
    kind: pick(f.get("kind"), OPENING_KINDS, "full"),
    ...(pay ? { pay } : {}),
    about: String(f.get("about") ?? "").replace(/\r\n/g, "\n"),
    does: lines(f.get("does")),
    needs: lines(f.get("needs")),
    status: pick(f.get("status"), OPENING_STATUSES, "draft"),
  };
  // The lists' limits in the page's words; the boxes' own maxLength covers the rest.
  for (const [name, list] of [["What you’ll do", opening.does], ["What we’re looking for", opening.needs]] as const) {
    if (list.length > 12) return { error: `${name}: 12 lines at most.` };
    const long = list.findIndex((l) => l.length > 200);
    if (long >= 0) return { error: `${name}, line ${long + 1}: 200 characters at most.` };
  }
  if (!id) {
    const r = await galaxy<{ id: string }>("POST", "/galaxy/openings", opening);
    if (!r.ok) return { error: r.error.message };
    redirect(`/careers/${r.data.id}`);
  }
  const r = await galaxy("PUT", `/galaxy/openings/${encodeURIComponent(id)}`, opening);
  if (!r.ok) return { error: r.error.message };
  refresh();
  return { ok: true };
}

export async function setStatus(id: string, status: ApplicationStatus) {
  const r = await galaxy("PUT", `/galaxy/applications/${encodeURIComponent(id)}`, { status });
  refresh();
  return r.ok ? {} : { error: r.error.message };
}

// For someone who asks to be forgotten (Privacy Policy): the application and its résumé, for good.
export async function removeApplication(id: string) {
  const r = await galaxy("DELETE", `/galaxy/applications/${encodeURIComponent(id)}`);
  refresh();
  return r.ok ? {} : { error: r.error.message };
}

// An opening nobody applied to, for good; the API refuses one with applications.
export async function removeOpening(id: string) {
  const r = await galaxy("DELETE", `/galaxy/openings/${encodeURIComponent(id)}`);
  // Either way the page reads again: after a delete, Back can't show the opening; after a refusal, its new applicants show.
  refresh();
  if (r.ok) redirect("/careers");
  return { error: r.error.message };
}
