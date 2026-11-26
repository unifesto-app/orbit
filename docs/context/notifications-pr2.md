# Notifications PR 2: people settings, devices and the rules

Plan doc: https://claude.ai/artifact/39zppEh4XSQhFe33NRCBnS (approved 26 Nov 2026, all defaults). PR 1 (#136, d02741a) built the
catalog, `inbox_items`, `deliveries`, `createNotifier`, `runDeliveries`, `pruneNotifications` and SES email. Read
`docs/context/notifications-pr1.md`, `api/src/notifications.ts`, `contract/src/notifications.ts` and the PR 1 tests first.

Branch `feat/notifications-people` from origin/main. API + contract only; no app, host or Galaxy screens in this PR.

## 1. Contract

- Switch keys (match `app/src/app/account/notifications.tsx`): push `tickets, reminders, follows, near, announcements,
  inRoom, orbit, yourHosts`; email `reminders, follows, announcements, orbit, yourHosts`. Export them as consts + types.
- Add `switch` to `KindDef`: which switch key governs a kind, or `null` for Must kinds (Must never has a switch). Fill it for
  every kind from the plan doc's "Switch" column (Tickets, Reminders, From hosts you follow = `follows`, New events near you
  = `near`, Host announcements = `announcements`, inRoom, From Orbit = `orbit`, Your hosts = `yourHosts`). A test asserts
  every non-Must kind has a switch and every Must kind has none.
- Types for the new routes' bodies and replies (settings, inbox page, push device).

## 2. Migration 0024 (`pnpm db:generate --name notification_prefs`)

- `notification_prefs`: `user_id` PK (FK users, cascade), `push` bool not null default true, `switches` jsonb not null
  default `{}` (only entries that differ from their default, keys like `push.near`, `email.follows`), `quiet` bool not null
  default true, `updated_at`.
- `push_devices`: `session_id` PK (FK sessions, cascade), `user_id` (FK users, cascade), `app` (orbit|launch|station|crew),
  `platform` (ios|android), `env` (sandbox|production), `token` text unique, `seen_at` not null. Index on `user_id`.
- `follows.notify` text enum `all|off` not null default `all`.

Defaults: every switch on, except `push.near` which is on only when the person has a city set. Quiet hours default on.

## 3. Routes (new file `api/src/me-notifications.ts`, wired like `saves.ts`)

- `PUT /me/push-device` `{app, platform, env, token}`: upsert on the current session. A token already on another row (other
  session or other account) is deleted first, in the same transaction, so the token moves here. Sign-out needs nothing:
  devices hang off sessions; a "live" device is one whose session has `ended_at is null and expires_at > now`.
- `DELETE /me/push-device`: removes the current session's row.
- `GET /me/inbox?app=orbit&before=<cursor>`: 30 items newest first (`created_at desc, id desc`, cursor encodes both), plus
  `unread` (count of that app's items with `read_at is null`) and `next` cursor or null.
- `POST /me/inbox/read` `{app, ids?}`: marks the given ids (only the caller's) or, with no ids, all of that app's items read.
- `GET /me/notification-settings`: `{push, quiet, switches}` with every key filled in from defaults.
- `PUT /me/notification-settings` `{push?, quiet?, switches?}`: validates keys against the contract lists, stores only the
  entries that differ from their default.
- `PUT /me/follows/:hostId/notify` `{notify: "all"|"off"}`: 404 when the caller doesn't follow that host.

## 4. The pipeline (createNotifier)

Order after the existing account-state check and inbox insert. **Must kinds skip steps 1-3 entirely.** The inbox item always
lands, whatever happens to the channels.

1. **Switches.** Email channel: `email.<switch>` off → email row `skipped`, reason `switchOff`. Push channel: master `push`
   off or `push.<switch>` off → push row `skipped` `switchOff`. Replace PR 1's interim "optionalHeld" rule: optional email
   now follows the switch. Kill switch stays a placeholder comment (PR 6).
2. **Caps (push only; counted from deliveries, never stored).** Day = IST calendar day. A push "counts" when its delivery row
   is not `skipped`/`dropped`, plus `skipped` with reason `notSetUp` (see 5).
   - 5 Low/Normal pushes a day per person → over it: push `skipped` `capReached`.
   - 1 `followedHostEvent` push a day per person per host → same. Put `hostId` in the kind's vars so it can be counted.
   - The 3-a-day per-event announcement cap is PR 10; leave a comment, don't build it.
3. **Quiet hours.** 22:00 to 07:00 IST (fixed UTC+5:30), when the person's `quiet` is on. Low/Normal push inside the window
   → row `held` with `run_at` = the next 07:00 IST.
4. **Devices.** One push row per live device of the person on the kind's `app`. None → one row `skipped` `noDevice`
   (as PR 1 does). Held rows are per device too.

## 5. Worker (runDeliveries)

- **Release** due `held` rows first: re-check the switch and that the device row still exists (gone → `dropped` `noDevice`;
  switch now off → `dropped` `switchOff`); drop as `dropped` `stale` when the item's event (`vars.eventId`, if any) is
  cancelled or has started. Otherwise set `queued`, `run_at = now`. The due index must cover `held` (update the partial index).
- **Push sending** doesn't exist until PR 4: claimed push rows become `skipped` `notSetUp` with a `ponytail:` comment naming
  PR 4. Email rows keep PR 1's behaviour exactly.

## 6. followedHostEvent on publish

`POST /events/:id/publish` (`api/src/events/routes.ts`, see the existing ponytail comment there): after the transaction
commits, notify every follower of the host whose `follows.notify = 'all'`, kind `followedHostEvent`, key = event id (dedupe
makes a re-publish a no-op), vars with `hostId`, `eventId`, title. Don't block the response on the fan-out errors (log them);
a `ponytail:` comment for batching when follower counts get large. Remove the "follower pushes" half of that old comment.

## 7. Prune

`pruneNotifications` also deletes `push_devices` with `seen_at` older than 270 days.

## Done when (tests, node:test via testkit, DB `orbit_test`)

- Each switch: turned off through `PUT /me/notification-settings` → the matching channel's row is `skipped` `switchOff`;
  master push off skips every non-Must push.
- A Low push at 23:00 IST is `held` with `run_at` 07:00 IST and released to `queued` at 07:00; one whose event was cancelled
  meanwhile is `dropped` `stale`.
- A sixth Low/Normal push in an IST day lands in the inbox only (`capReached`); a second `followedHostEvent` from the same
  host that day too, while a different host's still goes.
- A Must kind ignores switches, caps and quiet hours.
- A token moving between accounts: second account's PUT takes it, first account has no device.
- Settings GET fills defaults (`push.near` follows city); PUT stores only diffs.
- Inbox page + cursor + unread count; read by ids and read-all.
- Publish notifies `all` followers, not `off` ones; re-publish path doesn't duplicate.
- Device prune at 270 days.

`pnpm -r typecheck` and the API tests pass. Commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
