import * as Sentry from "@sentry/node";

// Error text can still name people after dataCollection below: drizzle puts a failed query's values after "\nparams: ",
// and SES and Meta errors can quote the address or number they refused. Every string in an event goes through this.
const PARAMS = /\nparams: [\s\S]*/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g; // a letter ending, so "drizzle-orm@0.45.4" paths stay
const PHONE = /\+\d{10,15}|\b91\d{10}\b/g; // +E.164, and Meta's "91…" without the plus
export const scrub = <T>(v: T): T =>
  (typeof v === "string"
    ? v.replace(PARAMS, "\nparams: [removed]").replace(EMAIL, "[email]").replace(PHONE, "[phone]")
    : Array.isArray(v)
      ? v.map(scrub)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
        : v) as T;

// Sentry (owner, 23 Nov 2026: "add sentry to orbit"): the API's errors. Loaded before anything else
// (`node --import ./src/instrument.ts`), so its hooks see Hono and http as they load. Off until SENTRY_DSN is set
// (api.env on the box).
// No tracing: Redis spans carry their keys, and ours hold phone numbers, emails and sign-in state.
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    // Every console.error in the API is something that failed: a 500 (app.ts), a sweep, an email or an S3 delete.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    // console.log lines ([notify] with a contact, even a deleted account's) would ride along on the next error.
    beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
    // Also leans on the default normalizeDepth (3): deeper, a DrizzleQueryError's own `params` array would be sent whole.
    beforeSend: scrub,
    // The SDK sends bodies, headers, cookies, query strings and local variables by default. Here those hold sign-in
    // codes, phone numbers, emails, tokens and résumés, so none of it goes: only the error, its stack and the route.
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
