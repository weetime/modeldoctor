# API HTTP e2e (Vitest + supertest)

These specs run the full NestJS app in-process and hit it over HTTP via
supertest. **No browser**, no Vite dev server — just nest + Postgres
`modeldoctor_test`.

> Not the same as `e2e/` at the repo root (Playwright, browser-level).
> See [CLAUDE.md → Testing layers](../../../../CLAUDE.md) for the layer
> breakdown and the rule that these two suites share the test DB and
> **must not run concurrently**.

## When to add a spec here

- The flow is purely about the api: request shape, response shape, auth,
  role guards, DB side effects, error codes.
- You can describe what to test as a sequence of HTTP calls — no UI
  state, no clicks.
- An equivalent test as a unit (mocking Prisma / services) would lose
  meaningful coverage of the wiring (Module config, pipes, guards).

## When NOT to add a spec here

- You're testing service / controller logic in isolation → use Vitest
  unit tests next to the file (`*.spec.ts`).
- You need to verify the UI stays wired up → use
  `e2e/` (Playwright) at the repo root.

## Layout

```
apps/api/test/
├── e2e/                                Spec suite — one *.e2e-spec.ts per route group
│   ├── auth.e2e-spec.ts
│   ├── auth-flow.e2e-spec.ts
│   ├── benchmark-template.e2e-spec.ts
│   ├── debug-proxy.e2e-spec.ts
│   ├── diagnostics.e2e-spec.ts
│   └── health.e2e-spec.ts
├── helpers/                            DB seed / auth helper / supertest factory
├── setup/                              global-setup / db-guard / pick-test-db-url
└── connection-lifecycle.e2e-spec.ts    Cross-cutting flow that doesn't fit one route group
```

## Running

```bash
# One-time per fresh worktree
pnpm install
pnpm -r build                            # packages/*/dist required for typecheck
pnpm -F @modeldoctor/api db:setup:test   # creates modeldoctor_test + migrate deploy

# Run the suite
pnpm test:e2e:api

# Single file
pnpm test:e2e:api -- test/e2e/auth.e2e-spec.ts
```

## Conventions

- Each spec gets a fresh-ish DB via `helpers/seed.ts` — see existing
  specs for the truncate-then-create pattern.
- `vitest.e2e.config.mts` enforces `fileParallelism: false` because all
  specs share one Postgres database. Per-worker DB schemas are tracked
  as a future improvement (issue #53 follow-up).
- The env loaded for the e2e process (`test/setup/global-setup.mts`)
  uses the same `pickTestDatabaseUrl()` resolver as the playwright
  config — both routes set `TEST_DATABASE_URL` or fall back to
  `modeldoctor_test`.
- A `db-guard.ts` asserts that whatever URL we end up with names a
  `_test` database — second-line safety against running specs against
  the dev DB and `deleteMany`-ing real user data.
