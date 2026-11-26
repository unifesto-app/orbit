import { z } from "zod";
import { CityName } from "./roles.ts";
import { Text } from "./text.ts";

// Broadcasts (notifications build plan PR 9): a staff message to a segment, confirmed by a second Platform holder. News
// (orbitNews) honours the person's "From Orbit" switch, quiet hours and caps; a service notice (orbitNotice) is Must, for
// outages and changes to terms. With no other Platform holder, the author's own broadcast goes after a 24-hour wait.

export const BROADCAST_TYPES = ["news", "notice"] as const;
export type BroadcastType = (typeof BROADCAST_TYPES)[number];
export const BROADCAST_STATUSES = ["waiting", "scheduled", "sending", "sent", "cancelled"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];
// The inbox always gets it; push and email as picked.
export const BROADCAST_CHANNELS = ["push", "email"] as const;
export type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];

export const BroadcastSegment = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ city: CityName }).strict(),
  z.object({ hostId: z.uuid() }).strict(),
  z.object({ eventId: z.uuid() }).strict(),
]);
export type BroadcastSegment = z.infer<typeof BroadcastSegment>;

export const NewBroadcast = z.object({
  type: z.enum(BROADCAST_TYPES),
  segment: BroadcastSegment,
  channels: z.array(z.enum(BROADCAST_CHANNELS)).max(2).transform((c) => [...new Set(c)]),
  title: Text(1, 80).refine((t) => !/[\r\n]/.test(t), "Keep the title on one line."),
  text: Text(1, 500),
  sendAt: z.iso.datetime({ offset: true }).optional(),
});
export type NewBroadcast = z.input<typeof NewBroadcast>;
export const CancelBroadcast = z.object({ reason: z.string().trim().min(3).max(500) });

export type Broadcast = {
  id: string;
  type: BroadcastType;
  segment: BroadcastSegment;
  channels: BroadcastChannel[];
  title: string;
  text: string;
  status: BroadcastStatus;
  author: { id: string; name: string | null };
  confirmer: { id: string; name: string | null } | null;
  sendAt: string | null;
  audienceCount: number;
  sent: number;
  failed: number;
  reason: string | null;
  createdAt: string;
  // With no other Platform holder: when the author's own broadcast moves on by itself.
  autoAt: string | null;
  // It went after the 24-hour wait, with no one confirming.
  autoSent: boolean;
};
export type Broadcasts = { items: Broadcast[] };
