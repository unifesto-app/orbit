import type { RequestStatus } from "@orbit/contract";
import { Badge } from "../../ui";

// An Event Request's status (Hosts flow, H1.5), as the tabs on the Requests page name them.
export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Open",
  changes: "Changes asked",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};
const tones = { open: "info", changes: "warning", approved: "success", declined: "error", withdrawn: "neutral" } as const;

export function RequestBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={tones[status]}>{STATUS_LABELS[status]}</Badge>;
}

// A moment as staff read it, in India's time.
export const time = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
