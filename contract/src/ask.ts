import { z } from "zod";
import { Text } from "./text.ts";

// Ask Orbit (X11): the chat's assistant. The app sends the conversation as the person sees it, text only; the API
// grounds the model in Orbit's own words (staff knowledge, Help answers), the person's bookings and what's coming up,
// and answers with one reply.

// POST /ask, signed in: the last 20 bubbles at most, oldest first, the last one theirs. Orbit's replies run longer than
// a question, so they get their own limit.
export const AskMessage = z.discriminatedUnion("from", [
  z.object({ from: z.literal("you"), text: Text(1, 1000) }),
  z.object({ from: z.literal("orbit"), text: Text(1, 8000) }),
]);
export type AskMessage = z.infer<typeof AskMessage>;
export const AskRequest = z.object({
  messages: z.array(AskMessage).min(1).max(20).refine((m) => m.at(-1)?.from === "you", "End with your question"),
});
export type AskRequest = z.infer<typeof AskRequest>;
// 200. Refusals: 400 invalid, 401 signedOut, 429 tooMany, 503 askOff (switched off, no model key, or the day's ceiling for everyone reached) and 503 askBusy
// (the model failed; try again in a minute).
export type AskReply = { reply: string };

// PUT /galaxy/ask/switch (Platform): Ask Orbit on or off for everyone, at once.
export const AskSwitch = z.object({ on: z.boolean() });

export type AskStatus = "ok" | "refused" | "error";
// GET /galaxy/ask (Platform): the switch, whether the server has a model key (never the key), cost per India day for
// the last 30 full days, newest first, and the latest 50 asks.
export type AskAdmin = {
  on: boolean;
  keySet: boolean;
  days: { day: string; asks: number; costUsd: number }[];
  log: { at: string; who: string | null; question: string; reply: string | null; status: AskStatus; tokens: number; costUsd: number }[];
};
