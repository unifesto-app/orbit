import { test } from "node:test";
import assert from "node:assert/strict";
import { readClient } from "./analytics.ts";

test("the client header sorts counts and trusts nothing", () => {
  assert.deepEqual(readClient("ios/1.0.0"), { platform: "ios", version: "1.0.0" });
  assert.deepEqual(readClient(" Android/12.3.45 "), { platform: "android", version: "12.3.45" });
  assert.deepEqual(readClient("web"), { platform: "web", version: null });
  assert.deepEqual(readClient("galaxy"), { platform: "galaxy" });
  assert.deepEqual(readClient("launch-ios/1.0.0"), { platform: "host", app: "launch", os: "ios", version: "1.0.0" });
  assert.deepEqual(readClient("Station-Android/2.1.0"), { platform: "host", app: "station", os: "android", version: "2.1.0" });
  for (const v of ["launch/1.0.0", "launch-ios", "galaxy-ios/1.0.0", "crew-web/1.0.0"])
    assert.deepEqual(readClient(v), { platform: "app", version: null }, v);
  for (const v of [undefined, null, "", "ios", "ios/1.0", "ios/1.0.0.1", "windows/1.0.0", "ios/1.0.0; drop table", "ios/9999.0.0", "x".repeat(500)])
    assert.deepEqual(readClient(v as string | undefined), { platform: "app", version: null }, String(v));
});
