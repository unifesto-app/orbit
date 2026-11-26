import { Hono } from "hono";
import { HealthResponse } from "@orbit/contract";
import { scrub } from "./instrument.ts";
import { authRoutes, type Deps } from "./auth/routes.ts";
import { deletionRoutes } from "./auth/deletion.ts";
import { securityRoutes } from "./auth/security.ts";
import { eventsRoutes } from "./events/routes.ts";
import { galaxyEventsRoutes } from "./events/galaxy.ts";
import { galaxySlotsRoutes, galaxyVenuesRoutes } from "./slots/galaxy.ts";
import { announcementsRoutes } from "./announcements.ts";
import { publicEventsRoutes } from "./events/public.ts";
import { savesRoutes } from "./saves.ts";
import { reportsRoutes } from "./reports.ts";
import { supportRoutes } from "./support.ts";
import { meNotificationsRoutes } from "./me-notifications.ts";
import { bookingsRoutes } from "./bookings.ts";
import { paymentsRoutes } from "./payments/routes.ts";
import { moneyRoutes } from "./payments/galaxy.ts";
import { hostMoneyRoutes } from "./payments/host.ts";
import { checkInRoutes } from "./checkin.ts";
import { slotsRoutes } from "./slots/routes.ts";
import { hostsRoutes } from "./hosts/routes.ts";
import { requestsRoutes } from "./hosts/requests.ts";
import { mediaRoutes } from "./media.ts";
import { pmRoutes } from "./pm/routes.ts";
import { prelaunchRoutes } from "./prelaunch.ts";
import { contentRoutes } from "./content.ts";
import { galaxyNotificationsRoutes } from "./galaxy-notifications.ts";
import { broadcastsRoutes } from "./broadcasts.ts";
import { careersRoutes } from "./careers.ts";
import { analyticsRoutes } from "./analytics.ts";
import { dashboardRoutes } from "./dashboard.ts";
import { visitRoutes } from "./visits.ts";
import { rolesRoutes } from "./roles/routes.ts";
import { sesHookRoutes, unsubscribeRoutes } from "./email-hygiene.ts";

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
    app.route("/", requestsRoutes(deps));
    app.route("/", eventsRoutes(deps));
    app.route("/", galaxyEventsRoutes(deps));
    app.route("/", announcementsRoutes(deps));
    app.route("/", publicEventsRoutes(deps));
    app.route("/", savesRoutes(deps));
    app.route("/", reportsRoutes(deps));
    app.route("/", supportRoutes(deps));
    app.route("/", meNotificationsRoutes(deps));
    app.route("/", bookingsRoutes(deps));
    app.route("/", paymentsRoutes(deps));
    app.route("/", moneyRoutes(deps));
    app.route("/", hostMoneyRoutes(deps));
    app.route("/", checkInRoutes(deps));
    app.route("/", slotsRoutes(deps));
    app.route("/", galaxyVenuesRoutes(deps));
    app.route("/", mediaRoutes(deps.media));
    app.route("/", pmRoutes(deps));
    app.route("/", prelaunchRoutes(deps));
    app.route("/", visitRoutes(deps));
    app.route("/", contentRoutes(deps));
    app.route("/", galaxyNotificationsRoutes(deps));
    app.route("/", galaxySlotsRoutes(deps));
    app.route("/", broadcastsRoutes(deps));
    app.route("/", careersRoutes(deps));
    app.route("/", dashboardRoutes(deps));
    app.route("/", analyticsRoutes(deps));
    app.route("/", unsubscribeRoutes(deps));
    if (deps.sesTopic) app.route("/", sesHookRoutes({ db: deps.db, topicArn: deps.sesTopic, now: deps.now }));
  }

  // An unknown path looks the same as a Galaxy route someone can't use.
  app.notFound((c) => c.json({ error: "notFound", message: "There's nothing here." }, 404));
  // Anything unexpected still answers in the contract's error shape.
  app.onError((err, c) => {
    // Scrubbed as Sentry's events are: a failed query's text ends with its params, which can be a bank account or UPI ID.
    // The stack's frames go as they are (code paths only); scrub would drop them with the params.
    const cause = (err as { cause?: unknown }).cause;
    const frames = (err.stack ?? "").split("\n").filter((l) => l.trimStart().startsWith("at ")).join("\n");
    console.error(scrub(`${err.name}: ${err.message}`), cause instanceof Error ? scrub(`cause: ${cause.message}`) : "", `\n${frames}`);
    return c.json({ error: "server", message: "Something went wrong on our side. Try again in a minute." }, 500);
  });

  return app;
}
