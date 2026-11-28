import type { ReportStatus } from "@orbit/contract";
import { Badge } from "../../ui";

// A report's status, as the tabs on the Reports page name them.
// What a report is about, as the list and a report's page name it.
export const KINDS = { event: "Event", host: "Host", person: "Person" } as const;

export const STATUS_LABELS: Record<ReportStatus, string> = { open: "Open", resolved: "Resolved", dismissed: "Dismissed" };
const tones = { open: "info", resolved: "success", dismissed: "neutral" } as const;

export function ReportBadge({ status }: { status: ReportStatus }) {
  return <Badge tone={tones[status]}>{STATUS_LABELS[status]}</Badge>;
}
