# Orbit by Unifesto

New app, API, website and contract for Orbit by Unifesto. Plan: see `docs/context/artifacts/orbit-rebuild-plan.md` (draft, not yet approved).

- `api/` - Node 24, Hono, Drizzle on Postgres
- `app/` - Expo (TypeScript)
- `web/` - Next.js (TypeScript), the public site at orbit.unifesto.app
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
- `.github/workflows/deploy.yml` pushes images to GHCR on `main`. Running them on the AWS box is not set up yet.
- On the box, `~/orbit/api.env` holds `DATABASE_URL` (the `orbit` database on the shared RDS, login `orbit_app`), `AUTH_SECRET` and `REDIS_URL=redis://orbit-redis:6379`, Orbit's own Valkey container from `deploy/docker-compose.yml`.
