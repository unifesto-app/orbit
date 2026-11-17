import { z } from "zod";

// Text Postgres can store: a NUL character would fail the write as a server error, with the text in the log.
export const Text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !s.includes("\u0000"), "Remove the NUL character");
