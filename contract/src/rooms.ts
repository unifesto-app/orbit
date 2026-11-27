import { z } from "zod";
import { Text } from "./text.ts";

// inRoom (mock-leftovers plan, Feature 3): a published meetup with inRoom on, on a live host, has a room. A signed-in
// guest who has been let in (a confirmed booking with someone checked in) joins by putting up a card: a line and one
// to three ways to reach them. Members see each other's name, photo and line; an ask to connect, once accepted, swaps
// the reach. No chat. The room closes 7 days after the event ends. Staff with Queues remove cards and bar people.

export const ROOM_LINE_MAX = 120;
export const ROOM_REACH_MAX = 3;
export const ROOM_ASKS_PER_DAY = 30;
export const ROOM_OPEN_DAYS = 7; // after endsAt

// One way to reach a member, shown only to those they've connected with: "Instagram" · "@riya".
export const RoomReach = z.object({ label: Text(1, 24), value: Text(1, 120) });
export type RoomReach = z.infer<typeof RoomReach>;

// PUT /me/rooms/:eventId/card: join, or change the card.
export const RoomCard = z.object({ line: Text(1, ROOM_LINE_MAX), reach: z.array(RoomReach).min(1).max(ROOM_REACH_MAX) });
export type RoomCard = z.infer<typeof RoomCard>;

// POST /me/rooms/:eventId/asks
export const RoomAskBody = z.object({ memberId: z.uuid() });

// door: let in, not joined (or left and may come back); out: not let in, or no longer; in: a member; closed: 7 days
// after the end; removed: staff took the card down (for good); barred: staff barred them from every room.
export const ROOM_STATES = ["door", "out", "in", "closed", "removed", "barred"] as const;
export type RoomState = (typeof ROOM_STATES)[number];

// Between me and a member: none; asked (I asked; stays "asked" if they decline); incoming (they asked, I haven't
// answered); declined (they asked and I said no; asking them now turns it round, waiting on their yes); connected
// (accepted either way: reach shows).
export type RoomAsk = "none" | "asked" | "incoming" | "declined" | "connected";

// Never a user id, phone or email: `id` is the member's id in this room; contacts only in `reach`, once connected.
export type RoomMember = {
  id: string;
  name: string;
  photo: string | null;
  line: string;
  host: boolean; // on the host's team
  ask: RoomAsk;
  askId?: string;
  reach?: RoomReach[];
};

export type RoomEvent = { id: string; slug: string; title: string; startsAt: string; endsAt: string };

// GET /me/rooms/:eventId. `me` is my card, while I have one. `members`: everyone I can see while "in"; once "closed",
// only those I connected with (reach included) if I was a member, so contacts stay readable (no purge); empty in every
// other state. Asks and accepts end when the room closes.
export type RoomView = {
  event: RoomEvent;
  state: RoomState;
  closesAt: string;
  me: { id: string; line: string; reach: RoomReach[] } | null;
  members: RoomMember[];
};

// ---------- Galaxy (Queues) ----------

// GET /galaxy/rooms: meetups with inRoom on, newest first.
export type StaffRoomRow = {
  eventId: string;
  slug: string;
  title: string;
  hostName: string;
  status: string; // the event's
  startsAt: string | null;
  closesAt: string | null;
  members: number; // in the room now (not left or removed)
  removed: number;
};
export type StaffRooms = { rooms: StaffRoomRow[] };

// GET /galaxy/rooms/:eventId: every card ever put up, with who's behind it.
export type StaffRoomMember = {
  id: string;
  userId: string;
  name: string | null;
  line: string;
  reach: RoomReach[];
  joinedAt: string;
  leftAt: string | null;
  removedAt: string | null;
  removedBy: string | null; // the staffer's name
  barred: boolean;
  letIn: boolean; // a confirmed booking with someone checked in, now
};
export type StaffRoom = { room: StaffRoomRow; members: StaffRoomMember[] };

// POST /galaxy/rooms/:eventId/members/:memberId/remove | bar, POST /galaxy/rooms/unbar/:userId
export const RoomStaffReason = z.object({ reason: z.string().trim().min(3).max(500) });
