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
  session or other account) is deleted first, in the same transaction, so the token moves here; the transaction starts with
  `pg_advisory_xact_lock(hashtext(token))` so two PUTs of one token can't race. Sign-out needs nothing:
  devices hang off sessions; a "live" device is one whose session has `ended_at is null and expires_at > now`.
- `DELETE /me/push-device`: removes the current session's row.
- `GET /me/inbox?app=orbit&before=<cursor>`: 30 items newest first (`created_at desc, id desc`, cursor encodes both), plus
  `unread` (count of that app's items with `read_at is null`) and `next` cursor or null. A cursor whose stamp isn't exactly
  `YYYY-MM-DDTHH:MM:SS.ffffffZ` (a real date) with a uuid → 400.
- `POST /me/inbox/read` `{app, ids?}`: marks the given ids (only the caller's) or, with no ids, all of that app's items read.
- `GET /me/notification-settings`: `{push, quiet, switches}` with every key filled in from defaults.
- `PUT /me/notification-settings` `{push?, quiet?, switches?}`: validates keys against the contract lists, stores only the
  entries that differ from their default. Inserts a defaults row (on conflict do nothing) before `select ... for update`, so
  two first PUTs at once both stick.
- `PUT /me/follows/:hostId/notify` `{notify: "all"|"off"}`: 404 when the caller doesn't follow that host.

## 4. The pipeline (createNotifier)

Order after the existing account-state check and inbox insert. **Must kinds skip steps 1-3 entirely.** The inbox item always
lands, whatever happens to the channels.

1. **Switches.** Email channel: `email.<switch>` off → email row `skipped`, reason `switchOff`. Push channel: master `push`
   off or `push.<switch>` off → push row `skipped` `switchOff`. PR 1's interim "optionalHeld" rule stays until PR 6
   (unsubscribe links): switch off → `switchOff`, else any non-Must email other than `welcome` → `skipped` `optionalHeld`.
   Kill switch stays a placeholder comment (PR 6).
2. **Caps (push only; counted from deliveries, never stored).** Day = the IST calendar day the push delivers (`run_at`), so
   pushes held overnight count toward the morning they go. A push "counts" when its delivery row is not
   `skipped`/`dropped`, plus `skipped` with reason `notSetUp` (see 5).
   - 5 Low pushes a day per person → over it: push `skipped` `capReached`. Normal pushes aren't counted.
   - 1 `followedHostEvent` push a day per person per host → same. Put `hostId` in the kind's vars so it can be counted.
   - The 3-a-day per-event announcement cap is PR 10; leave a comment, don't build it.
3. **Quiet hours.** 22:00 to 07:00 IST (fixed UTC+5:30), when the person's `quiet` is on. Low push inside the window
   → row `held` with `run_at` = the next 07:00 IST. Normal pushes are not held.
4. **Devices.** One push row per live device of the person on the kind's `app`. None → one row `skipped` `noDevice`
   (as PR 1 does). Held rows are per device too.

## 5. Worker (runDeliveries)

- **Release** due `held` rows first: re-check the switch and that the device is still live (row there, session not ended
  and not expired; else → `dropped` `noDevice`; switch now off → `dropped` `switchOff`); for forward-looking kinds only
  (inbox type `reminder`, `follow`, `near`) drop as `dropped` `stale` when the item's event (`vars.eventId`, a uuid) is
  cancelled or has started; post-event kinds (thanks, results, summaries) are never stale. Otherwise set `queued`,
  `run_at = now`. A row of an unknown kind, or one that throws, is `dropped` `error` (logged) and the rest carry on. The due
  index must cover `held` (update the partial index).
- **Push sending** doesn't exist until PR 4: claimed push rows become `skipped` `notSetUp` with a `ponytail:` comment naming
  PR 4. Email rows keep PR 1's behaviour exactly.

## 6. followedHostEvent on publish

`POST /events/:id/publish` (`api/src/events/routes.ts`, see the existing ponytail comment there): after the transaction
commits, when the event is public (not link-only, host not private) and the host's status is `live` (a paused host's
publish tells nobody), notify every follower of the host whose `follows.notify = 'all'`, kind `followedHostEvent`, key =
event id (dedupe makes a re-publish a no-op), vars with `hostId`, `eventId`, title. The fan-out runs in the background, not
awaited by the response; errors are logged. A `ponytail:` comment: not durable across a restart mid-fan-out, slow for large
follower counts; the upgrade is a fan-out row the worker picks up and batches. Remove the "follower pushes" half of that
old comment.

## 7. Prune

`pruneNotifications` also deletes `push_devices` with `seen_at` older than 270 days.

## Done when (tests, node:test via testkit, DB `orbit_test`)

- Each switch: turned off through `PUT /me/notification-settings` → the matching channel's row is `skipped` `switchOff`;
  master push off skips every non-Must push.
- A Low push at 23:00 IST is `held` with `run_at` 07:00 IST and released to `queued` at 07:00; one whose event was cancelled
  meanwhile is `dropped` `stale`.
- A Normal push at 23:00 IST is not held.
- A held push is dropped at release when its device went, its session ended (`noDevice`) or its switch went off.
- Release: an unknown-kind held row is `dropped` `error` and a queued Must email still sends; a post-event kind is never
  `stale`.
- A sixth Low push in an IST day lands in the inbox only (`capReached`), a Normal one still goes; a second
  `followedHostEvent` from the same host that day too, while a different host's still goes. Five Low pushes held overnight
  fill the morning's cap.
- Two concurrent first settings PUTs both stick; a malformed inbox cursor (e.g. Feb 30) is 400.
- Publish tells nobody for a link-only event, a private host or a paused host.
- A Must kind ignores switches, caps and quiet hours.
- A token moving between accounts: second account's PUT takes it, first account has no device.
- Settings GET fills defaults (`push.near` follows city); PUT stores only diffs.
- Inbox page + cursor + unread count; read by ids and read-all.
- Publish notifies `all` followers, not `off` ones; re-publish path doesn't duplicate.
- Device prune at 270 days.

`pnpm -r typecheck` and the API tests pass. Commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push.
