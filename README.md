# ModelDoctor

Troubleshooting toolkit for model-serving APIs.

**Current state:** The NestJS refactor is complete (Phases 0-6). The API is a NestJS 10 app with Prisma-backed Postgres, JWT + refresh-cookie auth, RBAC scaffolding, rate limiting, Terminus health probes, and a Vite-built React SPA served from the same container in production. Frontend tabs: Load Test, E2E Smoke, Request Debug, Connections, Settings; the sidebar's remaining tabs (Soak, Streaming TTFT, Regression, Health Monitor, History) are placeholders for later specs. Connection credentials (API keys the user tests against their own upstreams) are still browser-local `localStorage`; moving them to an encrypted backend store is tracked as a separate spec.

## Prerequisites

- Node.js **≥ 20**
- pnpm **10** (`corepack enable && corepack prepare pnpm@10 --activate`, or `npm install -g pnpm@10`)
- Docker (for the e2e test suite, which uses testcontainers, and for the production container build)
- Postgres 16 locally (Homebrew `postgresql@18` works; any ≥14 is fine) — see [Start Postgres](#start-postgres-local-dev)
- Vegeta for Load Test (`brew install vegeta` on macOS, or releases at <https://github.com/tsenart/vegeta/releases>)

## Install

```bash
pnpm install
```

## Start Postgres (local dev)

ModelDoctor's backend persists load-test runs and users to Postgres from Phase 4 onward. The backend expects a database reachable at the `DATABASE_URL` you set in `.env` — the default value points at a locally-running Postgres on `localhost:5432`.

Pick whichever local Postgres suits your machine (Homebrew service, native install, docker run, etc.) and provision the role + database once:

```bash
# Example: from any psql session with superuser rights
CREATE ROLE modeldoctor WITH LOGIN PASSWORD 'modeldoctor' CREATEDB;
CREATE DATABASE modeldoctor OWNER modeldoctor;
```

Then apply the Prisma schema:

```bash
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  pnpm -F @modeldoctor/api db:migrate:deploy
```

For everyday `pnpm dev`, copy `.env.example` to `.env` at the repo root so NestJS picks up `DATABASE_URL` automatically (`.env` is gitignored).

Running e2e tests (`pnpm test:e2e`) spins up throwaway Postgres containers via testcontainers and does not touch your local database.

## Develop

```bash
pnpm dev
```

Vite serves the frontend on <http://localhost:5173>. NestJS serves the API on <http://localhost:3001>. Vite proxies `/api/*` through to NestJS.

### Running multiple worktrees in parallel

Each worktree has its own `node_modules` and can run `pnpm dev` independently **as long as the ports differ**. Override via env:

```bash
# worktree A (defaults)
pnpm dev

# worktree B (in another shell)
VITE_PORT=5174 API_PORT=3002 pnpm dev
```

`strictPort: true` in Vite and an explicit port in Nest's `main.ts` mean a wrong setting fails loudly instead of auto-falling-back.

## Production build

```bash
pnpm build
pnpm start
```

`pnpm build` compiles `@modeldoctor/contracts` (`tsc`), then `apps/web` (Vite → `apps/web/dist/`), then `apps/api` (Nest → `apps/api/dist/`). `pnpm start` runs the compiled API (`node apps/api/dist/main.js`); in production (`NODE_ENV=production`) it also serves `apps/web/dist` as an SPA fallback via `ServeStaticModule`, so the single process covers both `/api/*` and the web UI.

## Deploy

Single-container deploy:

```bash
docker build -t modeldoctor .
docker run -d \
  -e DATABASE_URL=postgresql://user:pass@host:5432/modeldoctor \
  -e JWT_ACCESS_SECRET=$(openssl rand -base64 48) \
  -e CORS_ORIGINS=https://your.domain \
  -e NODE_ENV=production \
  -p 3001:3001 \
  --name modeldoctor modeldoctor
```

The container runs `prisma migrate deploy` on boot, then serves:

- `/api/*` from NestJS
- everything else from the Vite-built `apps/web/dist` (SPA fallback)

Health check: `GET /api/health` returns 200 with `{"status":"ok","info":{"database":{"status":"up"}},...}` if Postgres is reachable, 503 otherwise (Terminus + Prisma liveness probe).

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Logging format, CORS strictness, cookie `secure`/`sameSite` flags |
| `PORT` | No | `3001` | API listener |
| `LOG_LEVEL` | No | `info` | pino log level |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated allowlist |
| `DATABASE_URL` | **Yes** (non-test) | — | Postgres connection string |
| `JWT_ACCESS_SECRET` | **Yes** (non-test) | — | Min 32 chars; rotate by restart (invalidates all active access tokens) |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | jsonwebtoken-style duration for access tokens |
| `JWT_REFRESH_EXPIRES_DAYS` | No | `7` | Refresh-token TTL (also the `md_refresh` cookie's Max-Age) |
| `DISABLE_FIRST_USER_ADMIN` | No | `false` | When `true`, the first user registered is NOT auto-promoted to the `admin` role |

In `NODE_ENV=test`, both `DATABASE_URL` and `JWT_ACCESS_SECRET` become optional so unit tests can boot `AppModule` without a real database. The e2e suite sets both itself via `vitest.e2e.config.mts` + testcontainers.

## Repo layout

```
modeldoctor/
├── apps/
│   ├── web/                # React + Vite + TS frontend (@modeldoctor/web)
│   └── api/                # NestJS 10 backend (@modeldoctor/api): auth, load-test, debug-proxy, e2e-test, health
├── packages/
│   └── contracts/          # Shared Zod schemas (@modeldoctor/contracts): auth, health, load-test, debug-proxy, errors, ...
├── .github/workflows/      # CI: type-check, lint, test, e2e (with postgres service), docker build
├── docs/superpowers/       # Specs and implementation plans
├── tmp/                    # Runtime artifacts (Vegeta request.txt)
├── Dockerfile              # Multi-stage (deps → build → runtime, node:20-alpine, pnpm@10)
├── .dockerignore
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json            # Workspace coordinator
```

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Run Vite + NestJS together |
| `pnpm build` | Build contracts, web, and api |
| `pnpm start` | Run compiled NestJS (`node apps/api/dist/main.js`) |
| `pnpm lint` | Biome lint across all packages |
| `pnpm format` | Biome format across all packages |
| `pnpm type-check` | `tsc --noEmit` across all packages |
| `pnpm test` | Vitest across all packages |
| `pnpm test:e2e` | NestJS e2e suite (supertest + testcontainers Postgres; needs Docker running) |

Before a PR lands, all three must pass:

```bash
pnpm type-check
pnpm lint
pnpm test
```

Conventions and the full debt list live in [`docs/project-standards.md`](docs/project-standards.md).

## License

MIT
