import { Hono } from "hono";
import { HealthResponse } from "@orbit/contract";
import { authRoutes, type Deps } from "./auth/routes.ts";
import { deletionRoutes } from "./auth/deletion.ts";
import { securityRoutes } from "./auth/security.ts";
import { rolesRoutes } from "./roles/routes.ts";

export const VERSION = "0.0.0";

// The whole API. Routes are added here as the contract grows. Without deps (the health test) it serves /health only.
export function createApp(deps?: Deps) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json(HealthResponse.parse({ status: "ok", service: "orbit-api", version: VERSION })),
  );
  if (deps) {
    app.route("/", authRoutes(deps));
    app.route("/", securityRoutes(deps));
    app.route("/", deletionRoutes(deps));
    app.route("/", rolesRoutes(deps));
  }

  // An unknown path looks the same as a Galaxy route someone can't use.
  app.notFound((c) => c.json({ error: "notFound", message: "There's nothing here." }, 404));
  // Anything unexpected still answers in the contract's error shape.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "server", message: "Something went wrong on our side. Try again in a minute." }, 500);
  });

  return app;
}
