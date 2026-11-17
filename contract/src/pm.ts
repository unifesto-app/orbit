import { z } from "zod";
import { Text } from "./text.ts";

// Orbit's PM board (owner, 17 Nov 2026): tracks of tasks and an activity log, used in Galaxy and by Claude Code over
// MCP as "orbit-pm", with the same tools and argument names as Unifesto's board. One schema per tool, shared by the MCP
// endpoint and Galaxy, so the two can't drift; the MCP tool list is drawn from them too.

export const PM_STATUSES = ["NEXT", "PLANNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "PARKED", "DROPPED"] as const;
export const PmStatus = z.enum(PM_STATUSES);
export type PmStatus = z.infer<typeof PmStatus>;

// Trim, lowercase, drop blanks and repeats, so "Mobile " and "mobile" are one label.
export const cleanLabels = (labels: string[]) => [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))];

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const keyOf = (max: number) => z.string().trim().min(1).max(max).regex(KEY, "Use letters, digits, dots, dashes or underscores");
const TrackKey = keyOf(16); // "S", "P", "Z"
const TaskKey = keyOf(32); // "P13"
const Order = z.number().int().min(-1_000_000).max(1_000_000);
// A real day, in years a plan could mean (Postgres refuses year 0).
const Day = z.iso.date().refine((d) => d >= "2000-01-01" && d <= "2100-12-31", "Pick a date between 2000 and 2100");

export const UpsertTrack = z.strictObject({ key: TrackKey, name: Text(1, 160), sortOrder: Order.optional() });
export type UpsertTrack = z.infer<typeof UpsertTrack>;

// Create or update by key: creating needs track and title. Empty owner or notes clears it; "" clears the due date.
export const UpsertTask = z.strictObject({
  key: TaskKey,
  track: TrackKey.optional(),
  title: Text(1, 500).optional(),
  notes: z
    .string()
    .max(20_000)
    .refine((s) => !s.includes("\u0000"), "Remove the NUL character")
    .optional(),
  status: PmStatus.optional(),
  owner: Text(0, 80).optional(),
  dueDate: z.union([Day, z.literal("")]).describe("YYYY-MM-DD, or empty to clear").optional(),
  sortOrder: Order.optional(),
  labels: z.array(Text(0, 40)).max(20).describe("Replaces all labels (lowercased). Send [] to clear; omit to keep.").optional(),
});
export type UpsertTask = z.infer<typeof UpsertTask>;
// Galaxy only: when the dialog read the task, so a save over a change made since (often Claude's) is refused.
export const SaveTask = UpsertTask.extend({ ifUpdatedAt: z.iso.datetime().optional() });
export type SaveTask = z.infer<typeof SaveTask>;

export const ListTasks = z.strictObject({ track: TrackKey.optional(), statuses: z.array(PmStatus).max(8).optional(), label: Text(0, 40).optional() });
export const GetTask = z.strictObject({ key: TaskKey });
export const AddNote = z.strictObject({ message: Text(1, 2000), key: TaskKey.optional() });
export const CreatePmToken = z.strictObject({ name: Text(1, 80) });

// What the API answers with.
export type PmTrack = { key: string; name: string; sortOrder: number };
export type PmTaskRow = {
  key: string;
  track: string;
  title: string;
  status: PmStatus;
  owner: string | null;
  dueDate: string | null;
  labels: string[];
  sortOrder: number;
  updatedAt: string;
};
export type PmActivity = { id: string; key: string | null; actor: string; message: string; at: string };
export type PmTask = PmTaskRow & { notes: string | null; activity: PmActivity[] };
export type PmBoard = { tracks: PmTrack[]; tasks: PmTaskRow[] };
export type PmToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; active: boolean };
