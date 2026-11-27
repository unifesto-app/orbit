import type { Broadcast, BroadcastStatus } from "@orbit/contract";

// Broadcasts' words, shared by the list and a broadcast's page.
export const STATUS: Record<BroadcastStatus, [string, "success" | "info" | "warning" | "error" | "neutral"]> = {
  waiting: ["Waiting for confirm", "warning"],
  scheduled: ["Scheduled", "info"],
  sending: ["Sending", "info"],
  sent: ["Sent", "success"],
  cancelled: ["Cancelled", "neutral"],
};
export const TYPES = { news: "News", notice: "Service notice" } as const;
export const segmentName = (s: Broadcast["segment"]) =>
  "city" in s ? `People in ${s.city}` : "hostId" in s ? `Followers of host ${s.hostId}` : "eventId" in s ? `Guests of event ${s.eventId}` : "Everyone";
export const channelNames = (b: Broadcast) => ["Inbox", ...b.channels.map((c) => (c === "push" ? "Push" : "Email"))].join(", ");
