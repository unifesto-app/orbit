import type { EventStatus } from "@orbit/contract";
import { Badge } from "../../ui";

export const STATUS_LABELS: Record<EventStatus, string> = { draft: "Draft", published: "Published", cancelled: "Cancelled" };
const tones = { draft: "neutral", published: "success", cancelled: "error" } as const;

export function EventBadge({ status }: { status: EventStatus }) {
  return <Badge tone={tones[status]}>{STATUS_LABELS[status]}</Badge>;
}
