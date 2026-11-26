import { z } from "zod";
import { Text } from "./text.ts";

// Help and support (orbit-pm X16): Help's Write to us in the Orbit app, Event Partner and Play Partner sends to one
// support inbox; staff with Queues read and answer it in Galaxy, and a reply reaches the person as a supportReply notice.

export const SUPPORT_APPS = ["orbit", "launch", "station"] as const;
export const SupportApp = z.enum(SUPPORT_APPS);
export type SupportApp = z.infer<typeof SupportApp>;
// What Galaxy calls each app.
export const SUPPORT_APP_LABELS: Record<SupportApp, string> = { orbit: "Orbit", launch: "Event Partner", station: "Play Partner" };

export const SUPPORT_STATUSES = ["open", "answered", "closed"] as const;
export const SupportStatus = z.enum(SUPPORT_STATUSES);
export type SupportStatus = z.infer<typeof SupportStatus>;

export const SUPPORT_BODY_MAX = 2000;
export const SUPPORT_PER_DAY = 20;

// POST /me/support: {threadId}.
export const NewSupportMessage = z.object({ app: SupportApp, body: Text(1, SUPPORT_BODY_MAX) });
export type NewSupportMessage = z.infer<typeof NewSupportMessage>;

// One message, oldest first. `name`: the staff member's first name or "Orbit"; null for the person.
export type SupportMessage = { id: string; from: "person" | "staff"; name: string | null; body: string; at: string };
export type SupportThread = { id: string; app: SupportApp; status: SupportStatus; createdAt: string; updatedAt: string; messages: SupportMessage[] };
// GET /me/support?app=: the person's latest thread for that app, or null.
export type MySupport = { thread: SupportThread | null };

// ---------- Galaxy ----------
// POST /galaxy/support/:id/reply
export const SupportReply = z.object({ body: Text(1, SUPPORT_BODY_MAX) });
// POST /galaxy/support/:id/status: staff close a thread or open it again.
export const SupportStatusBody = z.object({ status: z.enum(["open", "closed"]) });

export type SupportPerson = { id: string; name: string | null; phone: string | null; email: string | null };
// GET /galaxy/support?status=: the newest message first.
export type StaffSupportRow = { id: string; app: SupportApp; status: SupportStatus; updatedAt: string; preview: string; person: SupportPerson };
export type StaffSupportList = { threads: StaffSupportRow[] };
// GET /galaxy/support/:id
export type StaffSupportThread = StaffSupportRow & { createdAt: string; messages: SupportMessage[] };
