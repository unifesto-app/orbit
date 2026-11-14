import { Hono } from "hono";
import { HealthResponse } from "@orbit/contract";

export const VERSION = "0.0.0";

// The whole API. Routes are added here as the contract grows.
export function createApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json(HealthResponse.parse({ status: "ok", service: "orbit-api", version: VERSION })),
  );

  return app;
}
