import { z } from "zod";

// Half of a UTF-16 pair with no other half. A regex, not isWellFormed(), so it runs on every engine the contract ships to.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Text Postgres can store: a NUL character or a lone surrogate would fail the write as a server error, with the text in the log.
export const Text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !s.includes("\u0000"), "Remove the NUL character")
    .refine((s) => !LONE_SURROGATE.test(s), "Remove the broken character");
