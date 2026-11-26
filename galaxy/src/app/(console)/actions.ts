"use server";

import { refresh } from "next/cache";
import { galaxy } from "../../api";

// Galaxy's risky actions (Roles flow): each carries a written reason the other side sees, and the API writes the change,
// its audit row and the email to that feature's holders together. Each answers with the API's message when it says no.

export type Done = { error?: string; ok?: number };

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const path = (f: FormData, k: string) => encodeURIComponent(text(f, k));

async function run(method: "POST" | "PUT" | "DELETE", url: string, body: unknown): Promise<Done> {
  const r = await galaxy(method, url, body);
  if (!r.ok) return { error: r.error.message };
  refresh(); // the page reads again, so it shows what changed
  return { ok: Date.now() };
}

// ─── People ───
export type Person = { id: string; name: string | null; phone: string | null; email: string | null; suspended: boolean; since: string };
export type Found = { q: string; people?: Person[]; error?: string };

// A Server Action (a POST), never a link: what's typed is often a phone number or an email, and a page address would
// carry it into Caddy's access log (kept 180 days), Cloudflare's and the browser's history. Galaxy's server reaches the
// API directly, past Caddy's log, and the API logs who searched, never what was typed.
export async function searchPeople(_: Found, f: FormData): Promise<Found> {
  const q = text(f, "q");
  if (!q) return { q }; // Clear: back to the list
  const r = await galaxy<Person[]>("GET", `/galaxy/people?q=${encodeURIComponent(q)}`);
  return r.ok ? { q, people: r.data } : { q, error: r.error.message };
}

// "Until" is a day, in India's time: suspended to the end of it. Empty closes the account for good.
const endOfDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T23:59:59+05:30`).toISOString() : null);

export async function suspendPerson(_: Done, f: FormData) {
  const until = text(f, "until");
  if (until && !endOfDay(until)) return { error: "Pick a day, or leave it empty to close the account for good." };
  return run("POST", `/galaxy/people/${path(f, "id")}/suspend`, { reason: text(f, "reason"), until: endOfDay(until) });
}
export async function liftPerson(_: Done, f: FormData) {
  return run("POST", `/galaxy/people/${path(f, "id")}/lift`, { reason: text(f, "reason") });
}

// ─── Hosts ───
// Verify carries the name staff saw, so the badge can't land on a name nobody checked.
export async function verifyHost(_: Done, f: FormData) {
  return run("POST", `/galaxy/hosts/${path(f, "id")}/verify`, { reason: text(f, "reason"), name: String(f.get("name") ?? "") });
}
export async function unverifyHost(_: Done, f: FormData) {
  return run("DELETE", `/galaxy/hosts/${path(f, "id")}/verify`, { reason: text(f, "reason") });
}
export async function suspendHost(_: Done, f: FormData) {
  return run("POST", `/galaxy/hosts/${path(f, "id")}/suspend`, { reason: text(f, "reason") });
}
export async function liftHost(_: Done, f: FormData) {
  return run("POST", `/galaxy/hosts/${path(f, "id")}/lift`, { reason: text(f, "reason") });
}
// The parent by its current link; empty takes it out from under one.
export async function setParent(_: Done, f: FormData) {
  // "https://heyorbit.in/jam-circle/?utm=x", "heyorbit.in/jam-circle" and "jam-circle" are all jam-circle.
  const slug = text(f, "parent")
    .toLowerCase()
    .replace(/^.*heyorbit\.in\//, "")
    .split(/[?#]/)[0]!
    .replace(/^\/+|\/+$/g, "");
  let parentId: string | null = null;
  if (slug) {
    const r = await galaxy<{ id: string; slug: string }[]>("GET", `/galaxy/hosts?q=${encodeURIComponent(slug)}`);
    if (!r.ok) return { error: r.error.message };
    // The search matches names and old links too; only the current link picks a parent, so it's never a near miss.
    const hit = r.data.find((h) => h.slug === slug);
    if (!hit) return { error: "No host has that link now. Copy it from the host's page." };
    parentId = hit.id;
  }
  return run("PUT", `/galaxy/hosts/${path(f, "id")}/parent`, { parentId, reason: text(f, "reason") });
}

// ─── Event Requests ───
// Approve makes the host and its draft event; changes and decline send the reason to the requester.
export async function approveRequest(_: Done, f: FormData) {
  return run("POST", `/galaxy/event-requests/${path(f, "id")}/approve`, { reason: text(f, "reason") });
}
export async function askChanges(_: Done, f: FormData) {
  return run("POST", `/galaxy/event-requests/${path(f, "id")}/changes`, { reason: text(f, "reason") });
}
export async function declineRequest(_: Done, f: FormData) {
  return run("POST", `/galaxy/event-requests/${path(f, "id")}/decline`, { reason: text(f, "reason") });
}

// ─── Staff ───
export async function grantFeatures(_: Done, f: FormData) {
  const features = f.getAll("feature").map(String);
  if (!features.length) return { error: "Pick at least one feature." };
  return run("POST", "/galaxy/staff/grants", { userId: text(f, "userId"), features, reason: text(f, "reason") });
}
export async function confirmGrant(_: Done, f: FormData) {
  return run("POST", `/galaxy/staff/grants/${path(f, "id")}/confirm`, { reason: text(f, "reason") });
}
export async function endGrant(_: Done, f: FormData) {
  return run("DELETE", `/galaxy/staff/grants/${path(f, "id")}`, { reason: text(f, "reason") });
}
