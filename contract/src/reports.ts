import { z } from "zod";
import { Text } from "./text.ts";

// Reports (orbit-pm X15): anyone signed in flags an event or a host from its page; staff with Queues work the queue in
// Galaxy, and act on the event or host from its own Galaxy page.

export const REPORT_REASONS = ["misleading", "scam", "unsafe", "offensive", "spam", "other"] as const;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;

// What the app and Galaxy show for each reason.
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  misleading: "Misleading or wrong",
  scam: "Scam or fraud",
  unsafe: "Unsafe",
  offensive: "Offensive",
  spam: "Spam",
  other: "Something else",
};

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export const ReportStatus = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatus>;

export const REPORT_NOTE_MAX = 1000;
export const REPORTS_PER_DAY = 10;

// POST /reports: exactly one of eventId and hostId.
export const NewReport = z
  .object({
    eventId: z.uuid().optional(),
    hostId: z.uuid().optional(),
    reason: ReportReason,
    note: Text(0, REPORT_NOTE_MAX).optional(),
  })
  .refine((b) => (b.eventId === undefined) !== (b.hostId === undefined), { message: "Report one event or one host", path: ["eventId"] });
export type NewReport = z.infer<typeof NewReport>;

// POST /galaxy/reports/:id/resolve | dismiss.
export const DecideReport = z.object({ note: Text(0, REPORT_NOTE_MAX).optional() });

export type ReportSubject = { kind: "event" | "host"; id: string; slug: string; name: string };

// GET /galaxy/reports: newest first.
export type StaffReport = {
  id: string;
  status: ReportStatus;
  reason: ReportReason;
  note: string | null;
  createdAt: string;
  subject: ReportSubject;
  reporter: { id: string; name: string | null; phone: string | null; email: string | null };
  openOnSubject: number; // open reports on the same event or host, this one included
};
// GET /galaxy/reports/:id
export type StaffReportDetail = StaffReport & { staffNote: string | null; decidedBy: { id: string; name: string | null } | null; decidedAt: string | null };
export type StaffReportList = { reports: StaffReport[] };
