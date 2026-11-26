# Notifications PR 4: push senders (APNs + FCM), email fallback, provider alert

Plan doc: https://claude.ai/artifact/39zppEh4XSQhFe33NRCBnS (approved 26 Nov 2026). PR 1 #136, PR 2 #140, PR 3 #145 are
merged. Read `api/src/notifications.ts` (the PR 2 pipeline), `api/src/auth/senders.ts`, `api/src/server.ts` (worker
loop, env), `api/src/notification-emails.ts` (`inboxFor`, `opensFor`, `emailFor`), `contract/src/notifications.ts`
(`KINDS`, `email: "fallback"`), `api/src/roles/access.ts` (`holdersOf`), `api/src/testkit.ts`, `app/src/push.tsx`.

Branch `feat/notifications-push` from origin/main (d9953ad or later). API, plus one small app change (section 6).
**No new packages**: Node's `http2`, `crypto` and `fetch` only. No migration expected (if you find you need one, keep it
to one small file and say why).

## 1. Senders (new file `api/src/push.ts`)

```ts
type Device = { app: InboxApp; platform: "ios" | "android"; env: "sandbox" | "production"; token: string };
type PushMessage = { title: string; body: string; data: { id: string | null; opens: unknown }; badge?: number; collapseId: string };
export type Push = { ios?: (d: Device, m: PushMessage) => Promise<string | undefined>; android?: (...same) };
```
Each returns the provider's message id (kept in `deliveries.provider_id`), or throws `NotSent`. Widen `NotSent`'s
channel to `Contact["kind"] | "push"` and add one reason, `gone`: the token is dead (app deleted, token for another
app), so the device row is deleted. `refused` stays "this message was refused" and never deletes a device.

**APNs** (`apnsSender({ teamId, keyId, privateKey }, request = h2Request)`):
- Provider token: ES256 JWT, header `{alg:"ES256", kid}`, claims `{iss: teamId, iat}`, signed with
  `crypto.sign("sha256", input, { key, dsaEncoding: "ieee-p1363" })`, base64url. Cache it and renew after 50 minutes
  (Apple refuses tokens older than 60 and rate-limits renewing more often than every 20).
- `request` keeps one `http2.connect` session per host, reconnecting after `close`/`error`/`goaway`; a 10 s timeout per
  request. Host from `device.env`: `api.sandbox.push.apple.com` or `api.push.apple.com`. Injectable so tests never touch
  the network.
- `POST /3/device/<token>`, headers `authorization: bearer <jwt>`, `apns-topic` = the app's bundle id
  (orbit `in.heyorbit.app`, launch/station/crew `in.heyorbit.<app>`; reuse what `server.ts`/`host/variants.ts` already
  hold if there's a clean way, else a 4-line map with a comment), `apns-push-type: alert`, `apns-priority: 10`,
  `apns-collapse-id` = the delivery id (a push retried after a timeout replaces the first).
  Body `{aps: {alert: {title, body}, sound: "default", badge?}, body: {id, opens}}`: expo-notifications on iOS fills a
  remote push's `content.data` only from `userInfo["body"]` (review, 26 Nov). A token that isn't hex → `gone` without a
  request (never an unvalidated token in `:path`). A request that times out destroys its session, so the next reconnects.
- Answer → reason: 200 → the `apns-id` header. 410, or 400 with `BadDeviceToken` / `DeviceTokenNotForTopic` /
  `Unregistered` → `gone`. 403 `ExpiredProviderToken` → drop the cached JWT, `unknown` (retries). 403 other
  (`InvalidProviderToken`, `MissingProviderToken`...) → `notSetUp`. 429 → `throttled`. Other 4xx → `refused`. 5xx,
  timeout, connection error → `unknown`.

**FCM** (`fcmSender({ projectId, clientEmail, privateKey }, fetchImpl = fetch)`):
- OAuth: RS256 JWT `{iss: clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging",
  aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600}`, POSTed as
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…`. Cache the access token until 60 s before its
  `expires_in`. Token endpoint failure: 400/401 → `notSetUp`, else `unknown`.
- `POST https://fcm.googleapis.com/v1/projects/<id>/messages:send`,
  `{message: {token, notification: {title, body}, data: {id: id ?? "", opens: JSON.stringify(opens)},
  android: {priority: "HIGH", notification: {tag: <delivery id>}}}}`. FCM data values must be strings, hence `opens` as
  JSON text.
- Answer → reason: 200 → `name`. An error whose `details[].errorCode` is `UNREGISTERED` → `gone`. 401 → drop the cached
  access token, `unknown`. 403 (including `SENDER_ID_MISMATCH`: a wrong project mustn't strip devices) → `notSetUp`.
  429 → `throttled`. Other 4xx (a 404 without `UNREGISTERED` too) → `refused`. 5xx/timeout → `unknown`.

Never log the token, the JWT or the provider's raw body (it can echo the token): reason words only, as the email path.

## 2. Config (`api/src/server.ts`)

- iOS on when `APNS_KEY_ID` and `APNS_PRIVATE_KEY` are set (`\n`-escaped, like `APPLE_PRIVATE_KEY`); team
  `APNS_TEAM_ID`, default `9AH3Z5C5DH` like Apple sign-in.
- Android on when `FCM_SERVICE_ACCOUNT` is set: the service account JSON (GCP project heyorbit-app), from which
  `project_id`, `client_email`, `private_key`. Malformed JSON → throw at start (a config error, loud), like the other
  key checks in server.ts.
- Pass `push` into `runDeliveries` (worker loop) and nowhere else. A platform without keys = that sender undefined.

## 3. The worker (`runDeliveries` in `api/src/notifications.ts`)

Replace the ponytail "no push sender" branch. For a claimed push row (`target` = session id):
- Load the device by `session_id` joined to a **live** session (`ended_at is null and expires_at > now`) — reuse
  `liveDevices`/its join. Sign-out, security sweeps and account deletion don't delete device rows, so this check is what
  keeps a push off an ended session. None → `dropped`, reason `noDevice`.
- No sender for the device's platform → `skipped notSetUp` (as now). Nothing logged as an error.
- Message: `title` = `inboxFor(kind, payload).fromName`, `body` = its `text`; `data` = `{id: d.inboxItemId, opens}`
  where `opens` = `opensFor(kind, payload)` (same as the inbox row). `badge` (iOS only) = that person's unread inbox
  items on the device's app.
- Sent → `sent`, `sentAt`, `providerId`, `reason` cleared. `gone` → `failed` reason `gone` and delete the `push_devices`
  row (by session id and the token that was sent, so a token rolled mid-send stays). Then the same retry rules as email: `notSetUp` → skipped; `refused` or 4th try → failed; `throttled`/`unknown` →
  queued again after 1, 5, 30 minutes. Keep the `ours` guard on every write.
- Keep email exactly as it is.

## 4. Email fallback (kinds with `email: "fallback"`)

The email goes when the push can't land: no live device, push switched off, or every device's push ended without being
sent. A cap (`capReached`) or a quiet-hours hold is not "can't land": no email for those.
- Move the email decision now inline in `write()` (switch → optionalHeld → address → queued/noEmail) into one helper,
  used by `"always"` kinds in `write()` and by the fallback. Same rows, same reasons. (Every fallback kind is Normal
  level, so until PR 6's unsubscribe links its fallback email lands as `skipped optionalHeld`. That's expected: the row
  proves the fallback fired, and PR 6 lifts it for both.)
- In `write()`: for a fallback kind, call the helper when the push path ended in `switchOff` or `noDevice`.
- In the worker and in `releaseHeld`: when a push row ends in `failed`, `dropped` (not `stale`), or `skipped notSetUp`,
  and no other push row with the same `dedupe_key` is `queued`, `held`, `sending` or `sent`, call the helper. Two
  workers finishing the last two devices at once may both get here: the deliveries unique key
  `(dedupe_key, channel, target)` plus `onConflictDoNothing` makes the second a no-op. Say so in a comment. The account
  is checked again first: suspended or waiting for deletion → no non-Must email, the same rule as `write()`.

## 5. Provider alert (`providerFailing`, already in the catalog: Must, email, staff)

New `checkProviders({ db, notify, now })`, run hourly from server.ts beside the other sweeps.
- Per channel (`push`, `email`), over rows created in the last hour: ok = `sent`+`delivered`; failing = `failed`,
  **not counting** reason `gone` or `refused` (a dead phone or a bad address is not the provider failing), plus rows
  still `queued`/`sending` with reason `unknown` or `throttled` (a retry pending: only the 4th try fails, 36+ minutes
  on). At least 20 counted rows and more than 20% failing → alert. Run once at start, then hourly (review, 26 Nov).
- Alert: `console.error("[providers] <channel> failing: <failed>/<total> in the last hour")` — that line already reaches
  Sentry through `captureConsoleIntegration` (instrument.ts), so no direct Sentry call. And `tell(notify,
  holdersOf(db, "platform", at), "providerFailing", {channel, failed, total})` with key `<channel>:<hour start ISO>`,
  so one alert per channel per hour.
- Add the `providerFailing` email template in `notification-emails.ts` if it's missing.

## 6. App (`app/src/push.tsx`, JS only)

On Android the FCM data arrives as strings: when `data.opens` is a string, `JSON.parse` it (in a try; bad → null) before
`hrefFor`. Keep the PR 3 comment that names this payload, updated to say `opens` comes as JSON text on Android.

## Tests

Pure, `api/src/push.test.ts` (node:test, no network):
- The APNs JWT: generate a P-256 key with `crypto.generateKeyPairSync("ec", {namedCurve: "P-256"})`, check header,
  claims, a 64-byte raw signature that `crypto.verify` accepts with `dsaEncoding: "ieee-p1363"`; reused at 49 min,
  renewed at 51.
- The FCM assertion: an RSA key pair, claims as in section 1, verifies; the access token is cached and re-fetched after
  expiry.
- Every row of both answer tables above → its reason (or id), with a fake `request` / `fetch`. FCM `opens` is a string.
- Apple's and Google's docs don't publish a private key with a matching signed example, so "against their examples"
  means the documented header/claim shapes and algorithms above; say that in a comment.

API, `api/src/notifications.test.ts` (testkit's `deliver` takes an optional fake `push`):
- A push to a live device is sent with `data = {id: inbox item id, opens}` and the right title/body; `sent` row with
  `providerId`.
- An ended session (sign-out) → `dropped noDevice`, nothing sent.
- `gone` → row `failed gone`, device row deleted; the next notice to that person writes `noDevice`.
- No `push` at all → push rows `skipped notSetUp`, no throw, emails still sent.
- Throttled → queued again after 1 minute.
- Fallback: a fallback kind with no device writes its email row at once; with two devices, the email row appears only
  after the second push fails, not after the first.
- `checkProviders`: 25 email rows with 6 failed (24%) → one `providerFailing` per Platform holder; a second run in the
  same hour writes nothing new; 25 rows with 6 `gone` failures → no alert; 10 rows all failed → no alert (under 20).

`pnpm -r typecheck` and the API tests pass. Run API tests on a throwaway database (`createdb orbit_pr4_test`,
`TEST_DATABASE_URL=postgres://localhost:5432/orbit_pr4_test`, `--test-concurrency=1`, `dropdb` after); the shared
`orbit_test` is used by other sessions.

## Done when (owner, after merge and deploy, with keys set)

A test send reaches a real iPhone and a real Android phone; a deleted app's token is removed on the next send; with no
keys set, pushes are skipped and nothing errors. Keys the owner adds to api.env: `APNS_KEY_ID`, `APNS_PRIVATE_KEY`
(the .p8, team 9AH3Z5C5DH) and `FCM_SERVICE_ACCOUNT` (heyorbit-app). The PR merges without them.

Commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
