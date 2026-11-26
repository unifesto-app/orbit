import { z } from "zod";
import { Text } from "./text.ts";

// Host announcements and the automatic reminders (notifications build plan PR 10): a host's message to an event's
// ticket holders, at most 3 a day per event (India day), and the per-event switches for Tomorrow, Starting soon and Thanks.

export const ANNOUNCEMENTS_A_DAY = 3;
export const AUDIENCES = ["everyone", "notCheckedIn"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const NewAnnouncement = z.object({ text: Text(1, 500), audience: z.enum(AUDIENCES).default("everyone") });
export type NewAnnouncement = z.infer<typeof NewAnnouncement>;

export type Announcement = { id: string; text: string; audience: Audience; author: string | null; reached: number; createdAt: string };

export type AutoMessages = { tomorrow: boolean; startingSoon: boolean; thanks: boolean };
export const AUTO_MESSAGES_ON: AutoMessages = { tomorrow: true, startingSoon: true, thanks: true };
export const AutoMessagesBody = z.object({ tomorrow: z.boolean().optional(), startingSoon: z.boolean().optional(), thanks: z.boolean().optional() });

// GET /events/:id/announcements: newest first, what's left of today's 3, and the switches.
export type EventAnnouncements = { items: Announcement[]; left: number; autoMessages: AutoMessages };
