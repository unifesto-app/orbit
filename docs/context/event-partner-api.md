# Orbit Event Partner off mock (26 Nov 2026)

Plan F31, slices L1–L7. Event Partner = host app variant `launch` in `host/`. Payments stay stubbed until Razorpay keys.

## 1. What the screens read today, and the real route

| Mock (`host/src/launch/data.ts`, `inboxStore.ts`) | Read by | Real route | Status |
|---|---|---|---|
| `host` (which host am I on) | every tab | `GET /me` → `teams` (admin seats) | exists |
| `page` (name, kind, city, about, logo, status, followers, verified) | Host tab | `GET /hosts/:id` → `HostPage` | exists |
| `admins`, `adminInvites` | Host › Team | `GET /hosts/:id/team`, `POST /hosts/:id/team`, `DELETE` seat | exists |
| `events`, `drafts` | Events, Host, Money | `GET /hosts/:id/events` → `{drafts, upcoming, past}` | exists |
| `sales`, `salesOf()` (sold, checked in, gross) | Events, Money, Host | none | **missing** (H10.1) |
| `eventTeams`, `invites` (event roles: Event lead, Crew) | Host › Team, Events | none | **missing** (H3.3, Crew app C1) |
| `feePlan`, `bank`, payouts | Money | none | **missing**, waits on Razorpay (H14) |
| inbox messages, read set | Inbox, tab badge | `GET /me/inbox`, `POST /me/inbox/read` | exists |
| "Start a request" (welcome) | Welcome | none | **missing** (Event Request, H1.1–H1.7) |

## 2. Missing routes, in scope

### 2a. Sold and checked-in counts (H10.1, small)
Add `sold` and `checkedIn` (ticket counts, not money) to each row of `GET /hosts/:id/events`. One grouped count over bookings; no new route. Gross money stays off until payments are real, so the Money tab shows the stub.

### 2b. Event Request API (H1.1, H1.2, H1.6, H1.7)
From the Hosts flow: anyone signed in sends one request (host details + first event); staff approve, ask for changes, or decline in Galaxy; approved → host goes live **Unverified**, the requester is owner + Admin, the event waits as a **draft**. One open request per person. The requester hears by push and email.

Table `event_requests` (migration **0025**, or the next free number at merge; the Play Partner session may take 0025 first):
- `id`, `user_id`, `status` (`open` | `changes` | `approved` | `declined` | `withdrawn`), `note` (staff, for changes/decline), `host` jsonb (name, kind, city, about), `event` jsonb nullable (title, category, startsAt, venue text, free/paid, expected size), `host_id`, `event_id` (set on approve), `decided_by`, timestamps.
- Partial unique index: one row per `user_id` where status in (`open`, `changes`).

Routes (contract types in `contract/src/requests.ts`):
- `POST /event-requests` – send. 409 if one is open.
- `GET /me/event-request` – my latest request (or null).
- `PATCH /me/event-request` – edit while `changes`; goes back to `open`.
- `DELETE /me/event-request` – withdraw while `open`/`changes`.
- `GET /galaxy/event-requests?status=` and `GET /galaxy/event-requests/:id` – staff feature `hosts`.
- `POST /galaxy/event-requests/:id/approve | changes | decline` – `{reason}` (note to the requester for changes/decline). Approve runs in one transaction with a row lock: creates the host (same code path as `POST /hosts`), the owner/Admin seat, and the draft event when the request has one.
- Each decision tells the requester through the notifier (push + email).

Event is optional only for kinds Venue and Performer (decision 23). `Performer` is not in `HOST_KINDS` yet: add it here.

## 3. Slices / PRs

| PR | What | Who reviews |
|---|---|---|
| A – API | 2a counts + 2b Event Request routes, migration, tests | Fable |
| B – app | L1 tabs need sign-in; L2 host picker from `/me` teams; L3 Host tab + Team on real routes; L4 Events on real routes with counts; L7 Inbox on `/me/inbox`. Money tab: "Payouts open when payments go live" stub. Event roles hidden until H3.3. `data.ts` mock deleted (dev demo kept only if cheap) | Sonnet |
| C – Galaxy | Requests page (H1.5): list, open one, approve / ask for changes / decline with a note | Sonnet |
| D – app form | Event Request form in Event Partner (H1.3), welcome's "Start a request" live. Needs a design take first (one take, owner approves) | Sonnet |
| E – close | `POST /hosts` staff-only (H1.7), once D is on devices | Fable |

Order: A → B and C in parallel → D → E. App PRs are JS only (no rebuild); `expo-camera` skip for `launch` in `app.config.ts` is native and rides with the next rebuild.

## 4. Calls for the owner
1. Ok to add **Performer** as a host kind now?
2. "Ask for changes" kept (flow says approve / ask for changes / decline)?
3. Close direct `POST /hosts` (E) only after the form ships — Station and Play Partner keep starting hosts the old way until then?
4. Event roles (Event lead, Crew per event) stay hidden in Event Partner 1.0 until the Crew slice (H3.3)?
