import { type CategorySlug, DETAIL_KEYS, type EventDetails, formatLines, parseLines } from "@orbit/contract";

// An event's kind details as the Galaxy form's boxes and back: lists are "Name | brief" lines, highlights one a line.
// Pure, so details.test.ts runs it on Node. The API checks what comes back (EventDetails).

type Key = keyof EventDetails;

export const LABELS: Record<Key, string> = {
  language: "Language", seating: "Seating", style: "Playing", bring: "Bring", onSite: "There already",
  teamMin: "Smallest team", teamMax: "Biggest team", tracks: "Tracks (name | brief)", prizes: "Prizes (place | prize)",
  rounds: "Rounds (name | when)", criteria: "Judged on (name | weight, adding to 100)", festType: "Fest type", highlights: "What's on (one a line)",
};

// Each list's two fields, in the order a line holds them.
const PAIRS: Partial<Record<Key, [string, string]>> = { tracks: ["name", "brief"], prizes: ["place", "prize"], rounds: ["name", "when"], criteria: ["name", "weight"] };
const LONG: Key[] = ["tracks", "prizes", "rounds", "criteria", "highlights"];

export const keysOf = (category: string | null) => DETAIL_KEYS[category as CategorySlug] ?? [];
export const isLong = (k: Key) => LONG.includes(k);

/** A stored value as its box shows it. */
export function boxOf(k: Key, details: EventDetails): string {
  const v = details[k];
  if (v === undefined) return "";
  if (k === "highlights") return (v as string[]).join("\n");
  const pair = PAIRS[k];
  return pair ? formatLines((v as Record<string, string | number>[]).map((o) => [String(o[pair[0]]), o[pair[1]]!])) : String(v);
}

/** The category's boxes as details; an empty box is left out. */
export function detailsOf(category: string | null, box: (k: Key) => string): EventDetails {
  const out: Record<string, unknown> = {};
  for (const k of keysOf(category)) {
    const v = box(k).trim();
    if (!v) continue;
    const pair = PAIRS[k];
    if (k === "teamMin" || k === "teamMax") out[k] = Number(v);
    else if (k === "highlights") out[k] = v.split("\n").map((l) => l.trim()).filter(Boolean);
    else if (pair) out[k] = parseLines(v).map(([a, b]) => ({ [pair[0]]: a, [pair[1]]: k === "criteria" ? Number(b) : b }));
    else out[k] = v;
  }
  return out as EventDetails;
}
