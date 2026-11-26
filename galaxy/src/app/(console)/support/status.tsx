import { SUPPORT_APP_LABELS, type StaffSupportRow, type SupportStatus } from "@orbit/contract";
import { Badge, phone } from "../../ui";

// A thread's status, as the tabs on the Support page name them.
export const STATUS_LABELS: Record<SupportStatus, string> = { open: "Open", answered: "Answered", closed: "Closed" };
const tones = { open: "info", answered: "success", closed: "neutral" } as const;

export function SupportBadge({ status }: { status: SupportStatus }) {
  return <Badge tone={tones[status]}>{STATUS_LABELS[status]}</Badge>;
}

export const appLabel = (app: StaffSupportRow["app"]) => SUPPORT_APP_LABELS[app];
// The person's name, else their masked contact.
export const who = (p: StaffSupportRow["person"]) => p.name ?? (p.phone ? phone(p.phone) : p.email) ?? "No name yet";
