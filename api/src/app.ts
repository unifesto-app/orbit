import { Hono } from "hono";
import { HealthResponse } from "@orbit/contract";
import { authRoutes, type Deps } from "./auth/routes.ts";
import { deletionRoutes } from "./auth/deletion.ts";
import { securityRoutes } from "./auth/security.ts";
import { eventsRoutes } from "./events/routes.ts";
import { slotsRoutes } from "./slots/routes.ts";
import { hostsRoutes } from "./hosts/routes.ts";
import { mediaRoutes } from "./media.ts";
import { pmRoutes } from "./pm/routes.ts";
import { prelaunchRoutes } from "./prelaunch.ts";
import { contentRoutes } from "./content.ts";
import { careersRoutes } from "./careers.ts";
import { analyticsRoutes } from "./analytics.ts";
import { dashboardRoutes } from "./dashboard.ts";
import { visitRoutes } from "./visits.ts";
import { rolesRoutes } from "./roles/routes.ts";

export const VERSION = "0.0.0";

// The whole API. Routes are added here as the contract grows. Without deps (the health test) it serves /health only.
export function createApp(deps?: Deps) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json(HealthResponse.parse({ status: "ok", service: "orbit-api", version: VERSION })),
  );
  // api.heyorbit.in opened in a browser (owner, 17 Nov 2026: "add copyright 2027 Orbit"). Other unknown paths keep the
  // JSON 404 below, which the app and Galaxy read.
  app.get("/", (c) => c.text("© 2027 Orbit"));
  if (deps) {
    app.route("/", authRoutes(deps));
    app.route("/", securityRoutes(deps));
    app.route("/", deletionRoutes(deps));
    app.route("/", rolesRoutes(deps));
    app.route("/", hostsRoutes(deps));
    app.route("/", eventsRoutes(deps));
    app.route("/", slotsRoutes(deps));
    app.route("/", mediaRoutes(deps.media));
    app.route("/", pmRoutes(deps));
    app.route("/", prelaunchRoutes(deps));
    app.route("/", visitRoutes(deps));
    app.route("/", contentRoutes(deps));
    app.route("/", careersRoutes(deps));
    app.route("/", dashboardRoutes(deps));
    app.route("/", analyticsRoutes(deps));
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
