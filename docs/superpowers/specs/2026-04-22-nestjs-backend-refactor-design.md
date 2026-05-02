> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# NestJS Backend Refactor — Industrial Rewrite

**Status:** Approved design — ready for implementation planning
**Date:** 2026-04-22
**Predecessor:** Spec 1 (`2026-04-20-modeldoctor-restructure-design.md`) — frontend rewrite to Vite + React + TypeScript. Backend remained CommonJS Express.
**Successor:** None yet. Subsequent specs will extend auth (SSO/OIDC), add async run queue (BullMQ), and ship additional feature tabs (Soak, Streaming TTFT, Regression, Health Monitor, History) using the infrastructure this spec establishes.

## 1. Purpose and Scope

### 1.1 Problem Statement

The frontend is fully TypeScript and production-ready. The backend is not. It is:

- **Plain JavaScript, CommonJS**, no type-checking (`pnpm type-check` only covers `web/`).
- **Unstructured Express** — 4 route files, hand-wired middleware, no DI, no module boundaries.
- **Stateless** — no database, no authentication, no persisted history. Every run is ephemeral.
- **Not ready for industrial deployment** — no structured logging, no request correlation, no OpenAPI, no rate limiting, no health checks beyond a static `{ok:true}`.

ModelDoctor is now positioned as an industrial-grade product. The backend must support multi-user authentication, persisted history, RBAC, observability, and a stable API contract. A framework rewrite to **NestJS** is justified at this scale because:

- Planned growth exceeds 20+ endpoints across 8 feature tabs.
- Auth, DB, background jobs, and WebSocket needs are all in roadmap.
- A shared TypeScript contract with the frontend eliminates an entire class of bugs.

### 1.2 This Spec's Delivery Scope

This spec delivers a **full backend rewrite from Express/JS to NestJS/TS**, plus the supporting workspace restructure. It is delivered in 7 numbered phases (Phase 0–6), each independently reviewable and PR-able.

High-level deliverables:

- **pnpm workspace** restructure: `apps/web`, `apps/api`, `packages/contracts`.
- **NestJS 10 API** at `apps/api`, replacing `server.js` + `src/`.
- **Wire-format parity** — the 4 existing endpoints (`/api/health`, `/api/e2e-test`, `/api/load-test`, `/api/debug/proxy`) respond byte-identically to the current Express implementation. Frontend needs no changes to keep working.
- **Shared contracts package** — Zod schemas for every request/response pair, consumed by both FE and BE.
- **Infrastructure**: config validation, structured logging, OpenAPI at `/api/docs`, unified error shape, requestId correlation.
- **Database layer** (Postgres + Prisma) with initial entities: `User`, `RefreshToken`, `LoadTestRun`.
- **Authentication**: `@nestjs/passport` + JWT access + refresh tokens, `argon2` password hashing, `JwtAuthGuard` global + `@Public()` whitelist, `@Roles()` RBAC, `@nestjs/throttler` rate limiting.
- **Productionization**: multi-stage Dockerfile, GitHub Actions CI, `@nestjs/terminus` health with DB liveness probe.

### 1.3 Explicit Non-Goals

Recorded now so scope is unambiguous during implementation planning:

- **No FE product-feature additions.** The 3 implemented tabs (Load Test, E2E Smoke, Request Debug) behave the same to the end user, and no new tabs ship. Phase 3 swaps type imports (invisible to users) and Phase 5 adds login/register pages plus a login gate (auth infrastructure, not a product feature). No other FE UI changes.
- **No new feature tabs.** Soak, Streaming TTFT, Regression, Health Monitor, and History remain placeholders. They arrive in subsequent specs.
- **No async run queue in this spec.** `/api/load-test` continues to run Vegeta synchronously inside a single HTTP request. BullMQ + worker is deferred to a later spec (flagged as Phase 6+ follow-up, not part of this scope).
- **No WebSocket / streaming endpoints.** Streaming TTFT tab will need them; not here.
- **No SSO / OIDC / LDAP.** Local username/password only. Enterprise auth is a future spec.
- **No internationalization of backend error messages.** Error `code` is a stable machine-readable identifier; FE does the translation (existing `errors` i18n namespace).
- **No data migration from old ephemeral state.** Nothing is persisted today; there is nothing to migrate. First-run DB is empty.
- **No backwards compatibility with `node server.js`.** After cutover, that entry point and all of `src/*.js` are deleted.
- **No monitoring/tracing stack choice** (Prometheus / OpenTelemetry). Logs are structured JSON, which is sufficient for ingestion into any log aggregator; wiring to a specific stack is deferred.

### 1.4 Deployment Target

Unchanged from Spec 1: single-tenant, internal corporate network. Authentication added here is for multi-user *accountability* and API protection, not for untrusted-internet exposure.

## 2. Workspace Layout and Migration Strategy

### 2.1 Target Structure

```
modeldoctor/
├── apps/
│   ├── web/                            # Relocated from ./web/, FE code unchanged
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   ├── biome.json
│   │   ├── package.json                # name @modeldoctor/web
│   │   └── src/                        # (all FE code as-is)
│   └── api/                            # NEW — NestJS, replaces src/ + server.js
│       ├── src/
│       │   ├── main.ts                 # bootstrap (replaces server.js)
│       │   ├── app.module.ts
│       │   ├── modules/
│       │   │   ├── health/             # Phase 1 (+ DB probe in Phase 4)
│       │   │   ├── debug-proxy/        # Phase 1
│       │   │   ├── load-test/          # Phase 1 (+ persistence in Phase 4)
│       │   │   ├── e2e-test/           # Phase 1
│       │   │   ├── auth/               # Phase 5
│       │   │   └── users/              # Phase 5
│       │   ├── common/                 # Phase 2
│       │   │   ├── filters/            # AllExceptionsFilter
│       │   │   ├── interceptors/       # RequestIdInterceptor, LoggingInterceptor
│       │   │   ├── middleware/         # RequestIdMiddleware
│       │   │   ├── pipes/              # ZodValidationPipe
│       │   │   ├── decorators/         # @Public(), @Roles(), @CurrentUser()
│       │   │   └── guards/             # JwtAuthGuard, RolesGuard (Phase 5)
│       │   ├── config/                 # Phase 2 — env schema, ConfigModule wiring
│       │   ├── database/               # Phase 4 — PrismaModule, PrismaService
│       │   └── integrations/           # Ported pure-function layers (no DI, no state)
│       │       ├── builders/           # chat, embeddings, rerank, images, multimodal
│       │       ├── probes/             # text, image, audio
│       │       ├── parsers/            # vegeta-report
│       │       └── utils/              # tiny-png, wav
│       ├── prisma/
│       │   ├── schema.prisma           # Phase 4
│       │   └── migrations/
│       ├── test/
│       │   ├── fixtures/               # Captured Express responses (see §2.3)
│       │   └── e2e/                    # supertest against INestApplication
│       ├── nest-cli.json
│       ├── tsconfig.json
│       ├── tsconfig.build.json
│       └── package.json                # name @modeldoctor/api
├── packages/
│   └── contracts/                      # Shared Zod schemas → TS types
│       ├── src/
│       │   ├── index.ts
│       │   ├── health.ts
│       │   ├── e2e-test.ts
│       │   ├── load-test.ts
│       │   ├── debug-proxy.ts
│       │   ├── auth.ts                 # Phase 5
│       │   └── errors.ts               # Standard error code enum
│       ├── tsconfig.json
│       └── package.json                # name @modeldoctor/contracts
├── docker-compose.yml                  # Phase 4 — local Postgres
├── Dockerfile                          # Phase 6 — multi-stage build
├── .github/workflows/ci.yml            # Phase 6
├── package.json                        # Root workspace definition
├── pnpm-workspace.yaml
├── tsconfig.base.json                  # Shared compiler options
└── README.md                           # Rewrite once per phase that affects it
```

**Workspace manifest (`pnpm-workspace.yaml`):**

```yaml
packages:
  - apps/*
  - packages/*
```

**Root `package.json` scripts** (concrete values):

| Script | Command |
|---|---|
| `dev` | `concurrently -k -n web,api -c cyan,magenta "pnpm -F @modeldoctor/web dev" "pnpm -F @modeldoctor/api start:dev"` |
| `build` | `pnpm -F @modeldoctor/contracts build && pnpm -F @modeldoctor/web build && pnpm -F @modeldoctor/api build` |
| `start` | `node apps/api/dist/main.js` |
| `lint` | `pnpm -r lint` |
| `format` | `pnpm -r format` |
| `type-check` | `pnpm -r type-check` |
| `test` | `pnpm -r test` |
| `test:e2e` | `pnpm -F @modeldoctor/api test:e2e` |

### 2.2 Migration Strategy — Big-Bang Cutover

A **parallel branch, big-bang cutover** is chosen over strangler/gradual. Justification:

1. **No persistent state** — zero data migration risk.
2. **Small surface** — 4 endpoints, all stateless glue code. Full rewrite fits in a single focused effort.
3. **Wire-format parity guarantees** that the FE continues to work unchanged when cutover lands.
4. **Strangler's cost is not recouped** here: running Express and Nest simultaneously behind a reverse proxy adds configuration burden for an endpoint set that completes in 1–2 days.

Mechanism:

- All work happens on a feature branch (current or a fresh `feat/nestjs-rewrite`) in a git worktree.
- Phase 0–1 end with the new Nest API matching the old Express API's wire format. Old files remain in-tree through Phase 0; Phase 1's PR deletes them.
- If any Phase 1 e2e test diverges from the captured Express fixture, the new implementation is fixed — the old Express behavior is treated as the source of truth.

### 2.3 Fixture Capture (Prerequisite Before Phase 1)

Before the first Nest controller is written, a capture step runs against the current Express server:

1. Start current `node server.js`.
2. For each of the 4 endpoints, hit them with representative valid and invalid payloads.
3. Record request + response (status, headers relevant to behavior, body) into JSON files under `apps/api/test/fixtures/`.
4. These fixtures become the basis for Phase 1 e2e assertions.

This is a small, one-person effort (~30 min) but is non-negotiable — without it, "wire-format parity" becomes a claim rather than a verified property.

### 2.4 Files Deleted, Moved, Kept

**Deleted (in Phase 1 final PR, not earlier):**

- `server.js`
- `src/` (entire tree — `builders/`, `parsers/`, `probes/`, `routes/`, `utils/`)
- `vitest.backend.config.ts` (superseded by `apps/api/vitest.config.ts`)
- Root `tsconfig.json` if it exists (moved to `tsconfig.base.json`)

**Moved (in Phase 0):**

- `web/*` → `apps/web/*` (verbatim move; `git mv` to preserve history)

**Kept:**

- `ai-docs/` — retained as-is.
- `docs/` — retained; this spec and its predecessor live under `docs/superpowers/specs/`.
- `tmp/` — retained (runtime artifacts directory).
- `.gitignore` — extended to cover `apps/api/dist/`, `apps/*/node_modules/`, `packages/*/node_modules/`, `packages/*/dist/`, `*.tsbuildinfo`, and the Docker volume for local Postgres. Prisma migration files **are** committed (`apps/api/prisma/migrations/` is tracked) — only local DB data is ignored.
- `README.md` — rewritten in Phase 0 and again in Phase 6.

## 3. Technology Stack (Frozen)

| Concern | Choice | Rationale (one line) |
|---------|--------|---------------------|
| Runtime | Node ≥ 20 | LTS, native fetch / test runner, Nest 10 compat |
| Framework | NestJS 10 with Express adapter | Matches current stack, maximal plugin ecosystem |
| Language | TypeScript 5.4+, `strict: true` | Parity with FE tsconfig |
| Validation | Zod + `nestjs-zod` | Shared schemas with FE; single source of truth |
| ORM | Prisma 5 | Best-in-class TS DX, mature migrations, typed client |
| Database | PostgreSQL 16 | Industrial default; JSON, full-text, row-level locks |
| Auth | `@nestjs/passport` + `@nestjs/jwt` + `argon2` | Standard Nest pattern; argon2 > bcrypt |
| Config | `@nestjs/config` + Zod env schema | Fail-fast on bad env; typed `ConfigService<AppConfig>` |
| Logging | `nestjs-pino` | 5–10× faster than Winston; structured JSON; requestId support |
| API docs | `@nestjs/swagger` + `nestjs-zod` integration | Auto OpenAPI from Zod, `/api/docs` |
| HTTP client | Native `fetch` (Node 20+) | No axios; used by `debug-proxy` |
| Rate limiting | `@nestjs/throttler` | Official Nest rate limiter |
| Testing (unit) | Vitest + `@nestjs/testing` | Reuse existing Vitest setup; DI-aware mocks |
| Testing (e2e) | `supertest` against `INestApplication` | Already in devDeps |
| Testing (DB) | `testcontainers` | Real Postgres in CI, no in-memory cheating |
| Health checks | `@nestjs/terminus` | Phase 6 DB liveness probe |
| Container | Multi-stage `Dockerfile` | Final image runs compiled `dist/main.js` + static web bundle |

**Deliberately excluded:**

| Excluded | Why |
|---|---|
| `class-validator` / `class-transformer` | Would create a second validation system alongside FE's Zod. Zod-only is a hard requirement. |
| TypeORM / MikroORM | Prisma has significantly better TS DX and simpler migrations. |
| axios / `@nestjs/axios` | Native fetch suffices. |
| Redis (in this spec) | Not needed until rate-limit backend or queues arrive. Throttler can use in-memory store in Phase 5. |
| BullMQ | Async run queue is a follow-up spec. |
| Kafka / RabbitMQ | No event-driven need yet. |
| GraphQL | All endpoints are simple REST; no consumer demand. |

## 4. Cross-Cutting Design Decisions

### 4.1 Shared Contracts (`packages/contracts`)

**What goes in:**

- Every request and response schema for HTTP endpoints.
- Standard error code enum (string literal union, stable identifiers, e.g. `"AUTH_INVALID_CREDENTIALS"`).
- Cross-cutting types that exist on the wire: `ApiError`, `Pagination`, `SortOrder`.

**What does NOT go in:**

- DB/Prisma types. `Prisma.User` is an internal representation; the API exposes a `PublicUser` DTO that strips `passwordHash`.
- FE-only types (UI state, form state, Zustand slice shapes).
- BE-only types (internal service interfaces, domain objects).

**Naming convention:**

```typescript
// packages/contracts/src/load-test.ts
export const LoadTestRunRequestSchema = z.object({ ... });
export type LoadTestRunRequest = z.infer<typeof LoadTestRunRequestSchema>;

export const LoadTestRunResponseSchema = z.object({ ... });
export type LoadTestRunResponse = z.infer<typeof LoadTestRunResponseSchema>;
```

**Consumption:**

- API: `@UsePipes(new ZodValidationPipe(LoadTestRunRequestSchema))` on controller method; `z.infer` type on the handler parameter.
- FE: `const parsed = LoadTestRunResponseSchema.parse(await res.json())` in `api-client.ts` wrappers, returning the inferred type.

### 4.2 Module Layout Inside `apps/api`

- Each **feature module** (health, debug-proxy, load-test, e2e-test, auth, users) owns its folder: `module.ts`, `controller.ts`, `service.ts`, and optionally `dto/`, `guards/`, `strategies/`.
- Feature modules do not import each other directly. Cross-feature needs go through a shared module.
- **Common module (`common/`)** exports filters, interceptors, middleware, pipes, decorators, guards. Registered globally in `AppModule`.
- **Database module (`database/`)** exports `PrismaService`; imported by feature modules that need DB access.
- **Integrations layer (`integrations/`)** is **not** a Nest module — it's plain TS functions (builders, parsers, probes, utils) ported from old `src/`. Services import them like any library.

### 4.3 Unified Error Response Shape

Every error response — validation, auth, business logic, uncaught — has this body:

```typescript
{
  error: {
    code: string;              // stable identifier, e.g. "VALIDATION_FAILED", "AUTH_INVALID_TOKEN"
    message: string;           // human-readable, English, not localized
    details?: unknown;         // optional structured detail (e.g. Zod issues array)
    requestId: string;         // correlation id, echoed from X-Request-Id header
  }
}
```

Implementation:

- `AllExceptionsFilter` catches everything and maps to this shape.
- Custom `AppException` base class carries `code` + HTTP status; domain modules throw subclasses.
- `ZodValidationPipe` failures map to `VALIDATION_FAILED` with `details = zodError.issues`.
- `HttpException` from Nest keeps its status code; `code` defaults to the HTTP reason phrase uppercased.
- Uncaught throwables return 500 with `code: "INTERNAL_SERVER_ERROR"`; stack is logged, never returned in the body.

### 4.4 Authentication Model

**Token strategy:**

- **Access token**: JWT, 15-minute lifetime, signed with `JWT_ACCESS_SECRET`. Claims: `sub` (user id), `roles`, `iat`, `exp`. Transmitted as `Authorization: Bearer <token>`.
- **Refresh token**: opaque random 256-bit string, stored hashed (`argon2`) in the `RefreshToken` table with `userId`, `expiresAt` (7 days), `createdAt`, `revokedAt?`. Transmitted as an `HttpOnly; Secure; SameSite=Strict` cookie so JS cannot exfiltrate it.
- **Refresh endpoint** (`POST /api/auth/refresh`): validates cookie, rotates refresh (old is revoked, new issued), returns new access token.
- **Logout** (`POST /api/auth/logout`): revokes the refresh token, clears the cookie.
- **Suspicious refresh detection**: if a revoked refresh token is reused, all tokens for that user are revoked (indicates theft).

**Password hashing:** `argon2id` with library defaults (appropriate for modern CPUs). No pepper (deferred to future spec if key-management infra lands).

**Guards:**

- `JwtAuthGuard` registered as **global** guard in `AppModule`.
- `@Public()` decorator (sets metadata) whitelists: `/api/health`, `/api/docs` and its assets, `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`.
- `@Roles('admin')` + `RolesGuard` for admin-only endpoints. Bootstrap policy: **the first user to register receives the `admin` role automatically**; all subsequent users receive `user`. An admin can later promote/demote others via `POST /api/users/:id/roles`. This auto-bootstrap exists so a fresh deployment is usable without a manual DB seed; production operators may disable it via `DISABLE_FIRST_USER_ADMIN=true` and seed an admin manually.

**Rate limiting:** `@nestjs/throttler` with per-IP limits. `/api/auth/login` and `/api/auth/refresh`: 10 requests / 60 seconds. Other endpoints: 100 / 60s. In-memory storage is acceptable for Phase 5; Redis backend is a later upgrade.

### 4.5 Logging, Request Correlation, Observability

**Logger:** `nestjs-pino` replaces Nest's default logger.

**Request correlation:**

- `RequestIdMiddleware` runs first: reads `X-Request-Id` header if present and well-formed (UUID v4 regex), else generates a new UUID v4. Writes it to `req.id` and to the response header.
- Pino child logger is bound per-request with `{ requestId, userId?, ip, method, url }`. Every log line in the request lifecycle carries these.

**Log levels (env-controlled):**

- Dev: `debug`, transport = `pino-pretty`.
- Prod: `info`, transport = stdout JSON.
- Health-check requests suppressed from access logs (too noisy; explicit allowlist).

**No tracing library in this spec.** OpenTelemetry is a future follow-up.

### 4.6 OpenAPI

- Mounted at `/api/docs` (Swagger UI) and `/api/docs-json` (raw JSON).
- Authentication for the docs: none in Phase 2 (internal-network deployment). A future spec may gate behind admin auth.
- Schemas drawn automatically from `nestjs-zod` via `@ApiBody(zodToOpenAPI(...))` or its auto-extraction helper. Example in one controller during Phase 2 sets the pattern; remaining modules follow it.
- Auth header shows up in Swagger UI via `builder.addBearerAuth()` (Phase 5).

### 4.7 Testing Strategy

**Pyramid (from bottom up):**

1. **Unit tests** — pure functions in `integrations/` (builders, parsers, probes, utils). Vitest, no Nest runtime. Cover full branch space.
2. **Module/service tests** — `Test.createTestingModule` with mocked dependencies. Assert business logic in services.
3. **e2e tests (HTTP)** — `supertest(app.getHttpServer())` against a bootstrapped `INestApplication`. Mock only external calls (vegeta, upstream model APIs). DB in e2e tests uses testcontainers Postgres.
4. **Contract tests** — Zod schemas in `packages/contracts` have their own tests: parse good samples, reject bad ones. Catches breaking schema changes.

**Fixtures:** captured Express responses (§2.3) become Vitest snapshots for Phase 1 e2e. Once parity is verified they can be retired or kept as regression oracle.

**CI gates (all must pass):**

- `pnpm -r type-check`
- `pnpm -r lint`
- `pnpm -r test`
- `pnpm -F @modeldoctor/api test:e2e`
- `pnpm build`

### 4.8 Configuration

Single source of truth: `apps/api/src/config/env.schema.ts` — a Zod schema of the complete environment.

```typescript
// Illustrative; actual set finalized per-phase
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["trace","debug","info","warn","error"]).default("info"),

  // Phase 4+
  DATABASE_URL: z.string().url(),

  // Phase 5+
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  DISABLE_FIRST_USER_ADMIN: z.coerce.boolean().default(false),
});
export type Env = z.infer<typeof EnvSchema>;
```

- `ConfigModule.forRoot({ validate: (raw) => EnvSchema.parse(raw), isGlobal: true })`.
- `.env.example` committed at repo root; `.env` gitignored.
- Missing required env vars fail the bootstrap — no "silent default to insecure value."

## 5. Phased Roadmap

Each phase is self-contained: one PR, one review, one merge, one deploy (in principle). Effort estimates assume one experienced full-stack engineer, uninterrupted.

### Phase 0 — Workspace Scaffold (~0.5 day)

**Scope:**

- Create `pnpm-workspace.yaml`, root `package.json` with scripts table from §2.1.
- `tsconfig.base.json` with shared compiler options.
- Create `apps/web/` by `git mv web/* apps/web/`; adjust `vite.config.ts` `root` if needed; adjust path alias.
- Create `apps/api/` via `pnpm dlx @nestjs/cli@10 new api --package-manager pnpm` (then relocate), add stack dependencies from §3 **except Prisma, Passport, JWT, throttler, terminus** (those come in their own phases).
- **Replace Nest's default Jest scaffold with Vitest** (remove `jest.config`, `test/` Jest setup, `@nestjs/testing`'s Jest-tied peers; add `vitest`, `vite-tsconfig-paths`, `apps/api/vitest.config.ts`). Rationale: repo already uses Vitest; one runner is cheaper than two.
- Bump `engines.node` in root `package.json` from `>=18.0.0` to `>=20.0.0`. Document the bump in README.
- Create `packages/contracts/` with empty index and a placeholder schema, wire tsconfig.
- Old `web/`, `src/`, `server.js`, `vitest.backend.config.ts` still exist. They are deleted in Phase 1's final commit.
- README updated with new dev commands.

**DoD:**

- `pnpm install` succeeds at repo root with zero warnings treated as errors.
- `pnpm dev` starts both web (5173) and api (3001); visiting `http://localhost:5173` loads the existing FE; FE's `/api/*` proxies to the new Nest server's default `/api/hello` (for now it's just the scaffold).
- `pnpm -r type-check` passes.
- Old `node server.js` is still runnable as a fallback if needed.

### Phase 1 — Port 4 Routes (~1.5–2 days)

**Prerequisite:** fixture capture (§2.3) complete.

**Scope:**

- Translate `src/builders/`, `src/parsers/`, `src/probes/`, `src/utils/` from CommonJS JS to strict TS under `apps/api/src/integrations/`. Pure mechanical translation; add types, keep logic byte-identical.
- Build 4 feature modules: `HealthModule`, `DebugProxyModule`, `LoadTestModule`, `E2eTestModule`. Controllers thin, services do the work.
- Write Zod schemas in `packages/contracts` for all 4 endpoints (request + response).
- Register `ZodValidationPipe` globally (via `APP_PIPE` provider).
- e2e tests per endpoint assert responses match captured fixtures exactly.
- **Final commit of this PR deletes:** `server.js`, `src/`, `vitest.backend.config.ts`, root-level Express-specific deps from `package.json`.

**Key risk mitigations:**

- **Vegeta subprocess**: use `child_process.spawn` with `AbortController`; write a dedicated unit test that kills the child and asserts cleanup; test Vegeta-missing case.
- **Debug proxy header passthrough**: test strips `host`, `content-length`; test follows redirects (5 max); test binary body → base64; test 20MB limit enforced; test 60s timeout enforced.

**DoD:**

- All 4 endpoints e2e tests green.
- FE in **dev mode** (`pnpm dev`), unchanged, successfully drives all 3 implemented tabs against the new Nest API.
- Legacy files are gone: `test -e server.js` fails; `test -d src` fails. Tree-wide `git grep -E "^(const|let|var) .* = require\(" apps/api/src packages/contracts/src` returns nothing (no CommonJS leaked into TS code).
- `pnpm -r type-check && pnpm -r test` green.

**Known temporary regression:** production mode (`pnpm build && pnpm start`) does **not** serve the FE static bundle from Nest between the end of Phase 1 and the end of Phase 2 — `server.js`'s `express.static` is gone and `ServeStaticModule` is not yet wired. This is intentional and acceptable because Phase 1 is never deployed on its own; Phase 2 closes the gap. Dev mode is unaffected.

### Phase 2 — Infrastructure (~1 day)

**Scope:**

- `ConfigModule` with Zod env validation (`EnvSchema` from §4.8 at the Phase 2 subset: NODE_ENV, PORT, LOG_LEVEL).
- `nestjs-pino` wired as the Nest logger; `pino-pretty` in dev.
- `RequestIdMiddleware` generates/propagates `X-Request-Id`.
- `AllExceptionsFilter` globally registered; all errors conform to §4.3 shape.
- `@nestjs/swagger` mounted at `/api/docs`, `/api/docs-json`. Health, e2e-test, load-test, debug-proxy controllers annotated; schemas auto-drawn from Zod.
- Replace `express.static(DIST_DIR)` with `ServeStaticModule`, preserving SPA fallback (`index.html` on non-`/api` 404s).

**DoD:**

- `curl -s localhost:3001/api/docs-json | jq '.paths | keys'` lists all 4 endpoints with schemas.
- Provoking a validation error returns `{error:{code:"VALIDATION_FAILED",...,requestId:"..."}}`; same `requestId` visible in structured logs.
- `pnpm build && node apps/api/dist/main.js` serves both `/api/*` and the FE static bundle on port 3001 with one process.

### Phase 3 — FE Consumes `packages/contracts` (~0.5–1 day)

**Scope:**

- `apps/web/src/features/*/types.ts` and `schema.ts` refactored to re-export (or replace) with imports from `@modeldoctor/contracts`.
- `api-client.ts` return types derived from Zod `z.infer<typeof ResponseSchema>`.
- Remove duplicated types in FE. `tsconfig` path alias `@modeldoctor/contracts` resolves through workspace linking.
- Keep per-tab UI-only types (Zustand slices, form state) in FE as before.

**DoD:**

- Changing a field name in `packages/contracts/src/load-test.ts` breaks `pnpm -r type-check` in both FE and API with clear type errors.
- FE `fetch('/api/...')` call sites have no `any` in their return path.
- All FE component behavior unchanged; tests pass.

### Phase 4 — Database (Prisma + Postgres) (~2 days)

**Scope:**

- `docker-compose.yml` at repo root with a `postgres:16` service, env `POSTGRES_USER`, `_PASSWORD`, `_DB`, volume for local persistence. A `.env.example` entry for `DATABASE_URL`.
- `apps/api/prisma/schema.prisma` with initial models:
  - `User { id, email, passwordHash, roles String[], createdAt, updatedAt }`
  - `RefreshToken { id, userId, tokenHash, expiresAt, revokedAt?, createdAt }`
  - `LoadTestRun { id, userId?, apiType, rate, duration, status, summaryJson Json, rawReport, createdAt, completedAt? }`
- `PrismaService` extending `PrismaClient` with `onModuleInit` connect, `onModuleDestroy` disconnect, `enableShutdownHooks` wired.
- `LoadTestService` persists each run to `LoadTestRun` on completion. A `userId` column exists but is nullable in Phase 4 (no auth yet); populated starting Phase 5.
- New endpoint: `GET /api/load-test/runs` — paginated list of historical runs (most recent first). Schema in `packages/contracts`. Phase 4 semantics: returns all rows unconditionally. Phase 5 will tighten this to per-user scoping (admins continue to see all).
- **Handling of pre-auth rows:** rows created during Phase 4 have `userId = null`. When Phase 5 ships, these rows are only visible to admin role (treated as "legacy/ownerless"). No retroactive assignment. A migration step in Phase 5 may optionally delete them; the default is to keep them read-only.
- Integration tests with `testcontainers` spin up Postgres per-suite; `prisma migrate deploy` runs against it.

**DoD:**

- `docker compose up -d` + `pnpm -F @modeldoctor/api prisma migrate dev` creates the schema.
- POSTing `/api/load-test` produces a row in `LoadTestRun`; `GET /api/load-test/runs` returns it.
- `pnpm test` runs the testcontainers-backed integration suite locally and in CI.

### Phase 5 — Auth (~2–3 days)

**Scope:**

- `AuthModule` + `UsersModule`:
  - `POST /api/auth/register` — email + password; argon2 hash; first user → `admin` role; subsequent → `user`.
  - `POST /api/auth/login` — verifies password; issues access JWT + sets refresh cookie.
  - `POST /api/auth/refresh` — rotates refresh, returns new access.
  - `POST /api/auth/logout` — revokes refresh token, clears cookie.
  - `GET /api/auth/me` — returns `PublicUser` from access token.
- `JwtStrategy` (`@nestjs/passport`), `JwtAuthGuard` as global guard.
- `@Public()` decorator whitelists: `/api/health`, `/api/docs*`, `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`.
- `@Roles('admin')` + `RolesGuard`. Admin-only: `GET /api/users` (list), `POST /api/users/:id/roles` (modify roles).
- `@nestjs/throttler` per §4.4 limits.
- Populate `LoadTestRun.userId` from `req.user.sub` on new runs. `GET /api/load-test/runs` scoped to current user (admins see all).
- `packages/contracts/src/auth.ts` with all request/response schemas.
- **Frontend integration** (coupled into this phase's PR):
  - `/login` and `/register` pages.
  - `auth-store` (Zustand) holding access token (in memory only — never localStorage). Refresh via HttpOnly cookie which JS cannot read.
  - `api-client.ts` fetch wrapper attaches `Authorization: Bearer <access>`; on 401 attempts refresh once, retries, else redirects to `/login`.
  - Protected route wrapper redirects unauthenticated users to `/login`.

**DoD:**

- Unauthenticated request to any protected endpoint returns 401 in the unified error shape.
- Login → access + refresh cookie issued; refresh rotates and the old token is no longer accepted.
- 11th login attempt in 60 seconds from same IP returns 429.
- Re-using a revoked refresh triggers full user token revocation (logged at `warn`).
- FE login flow works end-to-end; Load Test's run list shows only the current user's runs.

### Phase 6 — Productionization (~1–2 days)

**Scope:**

- **Multi-stage `Dockerfile`:**
  1. Install stage: copy `pnpm-lock.yaml` + workspace manifests, `pnpm install --frozen-lockfile`.
  2. Build stage: `pnpm -F contracts build`, `pnpm -F web build`, `pnpm -F api build`; `prisma generate`.
  3. Run stage: `node:20-alpine`, copy only `apps/api/dist`, `apps/web/dist` (served by ServeStaticModule), `node_modules` (prod only), `prisma/` (for migrations at startup). Entrypoint runs `prisma migrate deploy` then `node dist/main.js`.
- **GitHub Actions** (`.github/workflows/ci.yml`):
  - Matrix job on Node 20: install, type-check, lint, test, build.
  - Separate job spins up a Postgres service and runs `test:e2e`.
  - Docker build job (builds image but does not push in this spec).
- **`@nestjs/terminus` health check** extends `/api/health`:
  - Always-on: process info.
  - DB probe: `prisma.$queryRaw\`SELECT 1\`` with 500ms timeout.
  - Returns 503 if DB down.
- **`.env.example`** at repo root listing every required variable with a placeholder comment.
- **README** rewrite: deploy section, Docker usage, env variable documentation, architecture diagram (text/mermaid).

**DoD:**

- `docker build -t modeldoctor:local .` succeeds; `docker run -p 3001:3001 --env-file .env modeldoctor:local` brings up API + FE on a clean machine.
- CI green on a fresh push including Postgres-backed e2e.
- Stopping Postgres → `GET /api/health` returns 503 with error shape containing `code: "DB_UNAVAILABLE"`; restarting Postgres → 200 resumes.

### Phase Dependency Graph

```
Phase 0 ──▶ Phase 1 ──▶ Phase 2 ──▶ Phase 4 ──▶ Phase 5 ──▶ Phase 6
                            │
                            └────▶ Phase 3 (parallelizable with Phase 4)
```

- Critical path: 0 → 1 → 2 → 4 → 5 → 6, ≈ 9–12 person-days.
- Phase 3 can start as soon as Phase 2 merges and run concurrently with Phase 4 if two people are available.

## 6. Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| R1 | Phase 1 wire-format drift breaks FE silently | Med | High | Fixture capture (§2.3) mandatory before Phase 1 start; per-endpoint e2e asserts fixture parity |
| R2 | Vegeta subprocess leaks or misbehaves in Nest lifecycle | Med | Med | `AbortController`-bound spawn; unit + integration tests covering happy path, cancel, Vegeta-missing |
| R3 | Path alias inconsistency across Vite / Nest / Vitest | High | Low-Med | Phase 0 sets aliases in all three configs at once; CI type-check catches drift |
| R4 | Prisma dev deps bloat Docker image | Low | Low | Multi-stage build; `prisma` stays in `devDependencies` except the generated client |
| R5 | Auth implementation gaps (CSRF, refresh rotation, token theft detection) | Med | High | Follow OWASP ASVS L2 checklist as Phase 5 DoD; no custom crypto; argon2id, not bcrypt |
| R6 | testcontainers flakiness in CI | Low-Med | Med | Pin Postgres tag; add retry in CI; provide GitHub Actions service-based fallback config |
| R7 | Scope creep — "while we're rewriting, let's also do X" | High | High | Non-goals in §1.3 are binding; scope expansion requires a new spec, not a bigger PR |
| R8 | Single-process FE+API cutover makes rollback painful | Low | Med | Phase 1 PR is revertable (nothing persisted yet); Phases 4+ require a DB rollback plan (use `prisma migrate resolve` + keep last 2 migrations backward-compatible) |
| R9 | `nestjs-zod` API drift or unmaintained | Low | Med | Version pinned; if abandoned, fall back to hand-rolled `ZodValidationPipe` (already in scope) |
| R10 | Refresh cookie settings wrong in dev (different origin) | Med | Low-Med | `SameSite=Strict` is too strict if FE dev server is on 5173 and API on 3001; use `SameSite=Lax` in dev via env-driven cookie options |

## 7. Acceptance Criteria (Per Phase)

Each phase's DoD in §5 is the acceptance criterion for that phase. Additionally, the spec as a whole is considered complete when:

- [ ] All 7 phases are merged on the main branch.
- [ ] `pnpm install && pnpm dev` on a clean clone brings up a working FE + API.
- [ ] `docker build . && docker run -p 3001:3001 --env-file .env ...` produces a single-container deployment.
- [ ] All FE features from Spec 1 (Load Test, E2E Smoke, Request Debug, Connections, Settings) work against the new Nest backend, including login gate.
- [ ] CI green on main. No skipped tests.
- [ ] README documents: dev setup, prod deploy, env variables, architecture overview, auth flow, API docs URL.
- [ ] `pnpm -r type-check` passes across `apps/web`, `apps/api`, `packages/contracts`.
- [ ] `grep -R "require(" apps/api/src packages/contracts/src` returns nothing. (ESM verified.)
- [ ] OWASP ASVS L2 auth checklist reviewed; any unmet items explicitly logged as technical debt for a follow-up spec.

## 8. Implementation Phases (Hand-off to Writing-Plans)

The `writing-plans` skill will take this spec and produce a detailed task-by-task implementation plan. It should:

1. **Respect phase boundaries.** Each of Phase 0–6 is its own section in the plan. Tasks within a phase may parallelize; phases do not, except where §5's dependency graph permits (Phase 3 ‖ Phase 4).
2. **For each phase, produce:**
   - Ordered task list, each task a single-PR-sized unit of work.
   - Concrete file paths to create or edit.
   - Test(s) that must exist at phase end.
   - Verification commands mapped to each DoD bullet.
3. **Call out cutover points explicitly.** Phase 1's final PR deletes old Express files — this is a cutover, not a cleanup task, and deserves its own named step with a pre-cutover checklist.
4. **Not re-litigate spec decisions.** If the plan encounters a design ambiguity, the plan lists it as a clarifying question back to the spec author rather than silently picking an interpretation.
5. **Include rollback notes** for Phase 4+ (migrations) and Phase 5 (auth) — what the rollback command looks like and when to use it.

---

**End of NestJS Backend Refactor design.**
