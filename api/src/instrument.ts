import * as Sentry from "@sentry/node";

// Sentry (owner, 23 Nov 2026: "add sentry to orbit"): the API's errors and a tenth of its requests as traces. Loaded
// before anything else (`node --import ./src/instrument.ts`), so its hooks see Hono, http and postgres as they load.
// Off until SENTRY_DSN is set (api.env on the box).
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  const production = process.env.NODE_ENV === "production";
  Sentry.init({
    dsn,
    environment: production ? "production" : "development",
    tracesSampleRate: production ? 0.1 : 1,
    // Every console.error in the API is something that failed: a 500 (app.ts), a sweep, an email or an S3 delete.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    // The SDK sends bodies, headers, cookies, query strings, query values and local variables by default. Here those hold
    // sign-in codes, phone numbers, emails, tokens and résumés, so none of it goes: only the error, its stack and the
    // route.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "x-orbit-client"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
}
