import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub } from "./instrument.ts";

test("scrub keeps a failed query's SQL but not its values, contacts or anything else in the event", () => {
  const event = {
    event_id: "4f1c9a1b2c3d4e5f60718293a4b5c6d7",
    timestamp: 1763892000.5,
    exception: { values: [{ type: "DrizzleQueryError", value: 'Failed query: select * from "people" where "phone" = $1\nparams: +919876543210,Asha' }] },
    extra: { arguments: ["[mail] waitlist welcome not sent: Email address is not verified: asha.r+1@example.co.in", "[codes] whatsapp 919876543210 refused"] },
  };
  const out = scrub(event);
  assert.equal(out.exception.values[0]!.value, 'Failed query: select * from "people" where "phone" = $1\nparams: [removed]');
  assert.deepEqual(out.extra.arguments, ["[mail] waitlist welcome not sent: Email address is not verified: [email]", "[codes] whatsapp [phone] refused"]);
  const frame = "/repo/node_modules/.pnpm/drizzle-orm@0.45.4_@opentelemetry+api@1.10.0_postgres@4.1.1/node_modules/drizzle-orm/errors.js";
  assert.equal(scrub(frame), frame);
  assert.equal(out.event_id, event.event_id);
  assert.equal(out.timestamp, event.timestamp);
});
