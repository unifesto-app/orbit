# Orbit by Unifesto

New app, API, website and contract for Orbit by Unifesto. Plan: see `docs/context/artifacts/orbit-rebuild-plan.md` (draft, not yet approved).

- `api/` - Node 24, Hono, Drizzle on Postgres
- `app/` - Expo (TypeScript)
- `web/` - Next.js (TypeScript), the public site at heyorbit.in
- `galaxy/` - Next.js (TypeScript), the platform admin (Orbit admin)
- `contract/` - zod schemas and types shared by the API, the app and the web

## Develop

Requires Node 24 (see `.nvmrc`) and pnpm 10.13.1.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @orbit/api dev
```

The API's tests need a Postgres: `createdb orbit_test` locally, or set `TEST_DATABASE_URL`. Running the API needs `DATABASE_URL` and `AUTH_SECRET` (32+ characters); off production, sign-in codes print to its log instead of being sent. Schema changes go in `api/src/db/schema.ts`, then `pnpm --filter @orbit/api db:generate` writes the SQL migration, which the API applies when it starts.

## Deploy

- `api/Dockerfile`, `web/Dockerfile` and `galaxy/Dockerfile` build from the repo root.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests, build and both Docker builds on every push and PR.
- `deploy/deploy.sh` copies the repo to Orbit's own server, `orbit-server` (ap-south-1, its own VPC, nothing shared with Unifesto), and builds and starts `deploy/docker-compose.yml` there: the API, web, Galaxy, Valkey and Caddy. Deploy from a worktree at `origin/main`. It needs `aws login --profile orbit` and `~/.ssh/orbit-key`; port 22 is closed and SSH goes through Session Manager.
- Caddy (`deploy/Caddyfile`) serves heyorbit.in, www., api. and galaxy. behind Cloudflare (Full strict, Authenticated Origin Pulls) with the origin cert in `~/orbit/certs` on the server.
- On the server, `~/orbit/api.env` holds `DATABASE_URL` (database `orbit`, login `orbit_app`, on Orbit's own RDS `orbit-db`), `AUTH_SECRET` and `REDIS_URL=redis://orbit-redis:6379`, Orbit's own Valkey container.
- Sign-in codes (`api/src/auth/senders.ts`), each channel switched on by its own settings in `api.env`:
  - WhatsApp: `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` (the approved `otp` template).
  - Email by Amazon SES: `SES_REGION`, with AWS credentials from the usual chain (on the server, the `orbit-box` instance role, allowed to send only as `@heyorbit.in`); `EMAIL_FROM` defaults to `Orbit <no-reply@updates.heyorbit.in>`.
  - `OPEN_TO`: the opening gate. `*` for everyone, or a comma-separated list of numbers and emails. Unset, nobody gets a code wherever codes really go out.
  - Proof that a code send or Google's start comes from Orbit (`api/src/auth/proof.ts`): App Attest on iPhones (nothing to set), Play Integrity on Android with `PLAY_INTEGRITY_KEY` (a Google Cloud service account's JSON key, in the project linked to the app in Play Console) and `PLAY_CERTS` (comma-separated signing-certificate digests that pass without a Play install, copied from the API's `[proof]` log; only keys Orbit alone holds, never a debug keystore's), Turnstile on Galaxy with `TURNSTILE_SECRET` (and `TURNSTILE_SITE_KEY` in `galaxy.env`). `PROOF=enforce` refuses requests without one; unset, failures are only logged.
  - `CODE_DAILY_CAP` (default 500): at this many codes in a day (from midnight IST) on a channel, the API logs an alert, and WhatsApp codes stop until midnight; email codes go on.
  - Off production, a channel without its settings prints codes to the API's log instead.

## PM board and Claude Code

Galaxy's PM board (`/pm-board`, for staff with the Platform feature) and Claude Code share one board through the API (`api/src/pm`). Claude Code reaches it as the MCP server `orbit-pm` at `https://api.heyorbit.in/pm/mcp`, with the same tools as Unifesto's old `unifesto-pm`.

- To connect a computer, the platform owner makes a token in Galaxy, PM board, Connect Claude, and runs the command shown there once:

  ```bash
  claude mcp add --scope user --transport http orbit-pm https://api.heyorbit.in/pm/mcp --header "Authorization: Bearer <token>"
  ```

- A token works only while the account that made it is the platform owner. When ownership is handed over (by SQL; no route sets `platform_owner`), revoke every token in the same step:

  ```sql
  update pm_tokens set revoked_at = now() where revoked_at is null;
  ```

- After the first deploy, check that Caddy's access log doesn't keep the `Authorization` header (`grep opm_` in it finds nothing), and that Cloudflare lets Claude Code's POSTs to `/pm/mcp` through without a challenge.
