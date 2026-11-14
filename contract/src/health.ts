import { z } from "zod";

// GET /health on the API.
export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("orbit-api"),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
