import { Badge } from "../../ui";

// A host's status (Hosts flow): live, paused by its owner, archived, or suspended by staff or for want of an Admin.
const tones = { live: "success", paused: "neutral", archived: "neutral", suspended: "error" } as const;

export function HostStatus({ status }: { status: string }) {
  const tone = tones[status as keyof typeof tones] ?? "neutral";
  return <Badge tone={tone}>{status[0]!.toUpperCase() + status.slice(1)}</Badge>;
}
