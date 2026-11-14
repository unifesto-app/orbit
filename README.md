# Orbit by Unifesto

New app, API, website and contract for Orbit by Unifesto. Plan: see `docs/context/artifacts/orbit-rebuild-plan.md` (draft, not yet approved).

- `api/` - Node 24, Hono (Drizzle and Postgres to come)
- `app/` - Expo (TypeScript)
- `web/` - Next.js (TypeScript), the public site at orbit.unifesto.app
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

## Deploy

- `api/Dockerfile` and `web/Dockerfile` build from the repo root.
- CI (`.github/workflows/ci.yml`) runs typecheck, tests, build and both Docker builds on every push and PR.
- `.github/workflows/deploy.yml` pushes images to GHCR on `main`. Running them on the AWS box is not set up yet.
