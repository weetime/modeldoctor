> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# NestJS Refactor — Phases 2 / 4 / 5 / 6 Combined Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining four phases of the NestJS backend refactor: infrastructure (Phase 2), persistence (Phase 4), authentication (Phase 5), and productionization (Phase 6). Phase 3's scope (FE consuming `@modeldoctor/contracts`) was already absorbed into Phase 1 Task 10, so no Phase 3 section appears below.

**Architecture:** Incremental, layered. Each phase is self-contained and **ships as its own PR** — do NOT interleave phase commits. The critical path is 2 → 4 → 5 → 6. Phase 3's leftover (having FE's `api-client.ts` actually `.parse()` responses with Zod rather than just type-asserting) is folded into Phase 2 since the global error-shape change affects FE parsing anyway.

**Tech Stack additions (by phase):**
- **Phase 2**: `@nestjs/config` (already in deps), `nestjs-pino` + `pino` + `pino-http` + `pino-pretty` (already), `@nestjs/swagger` (already), `nestjs-zod` (already), `nanoid` (new, for requestId), `@fastify/static`/`@nestjs/serve-static` (new).
- **Phase 4**: `prisma` + `@prisma/client` (new), `@testcontainers/postgresql` (new dev), `postgres:16` Docker image.
- **Phase 5**: `@nestjs/passport` + `@nestjs/jwt` + `passport` + `passport-jwt` + `argon2` + `@nestjs/throttler` (all new), `cookie-parser` (new).
- **Phase 6**: `@nestjs/terminus` (new), Docker, GitHub Actions.

**Source spec:** `docs/superpowers/specs/2026-04-22-nestjs-backend-refactor-design.md`
**Predecessor plans (already merged or in PR):**
- `docs/superpowers/plans/2026-04-22-nestjs-refactor-phase-0-workspace-scaffold.md` (merged in PR #3)
- `docs/superpowers/plans/2026-04-22-nestjs-refactor-phase-1-route-port.md` (PR #4 — assume merged by the time execution starts)

**What Phase 0 + Phase 1 delivered (context for the executor):**
- `apps/web/` — React + Vite FE (unchanged visually)
- `apps/api/` — NestJS 10, Express adapter
- `packages/contracts/` — Zod schemas, **builds to `dist/`** (via `tsc -p tsconfig.build.json`)
- `apps/api/src/modules/{health,debug-proxy,e2e-test,load-test}/` — 4 feature modules, each with controller + service
- `apps/api/src/common/{pipes,filters}/` — `ZodValidationPipe` (per-endpoint) + `AllExceptionsFilter` (global; Phase 1 stop-gap, emits `{success:false,error:string}`)
- `apps/api/src/integrations/{builders,parsers,probes,utils,assets}/` — pure-function layer ported from legacy JS
- `pnpm dev` brings up Vite 5173 + Nest 3001
- `pnpm build` → `apps/web/dist/` + `apps/api/dist/`
- `pnpm start` runs compiled Nest (no FE static serving yet)

**Critical constraints inherited from Phase 0 / 1 (do NOT violate):**

1. **No `incremental: true`** in `apps/api/tsconfig.json` — conflicts with `nest-cli.json`'s `deleteOutDir: true`.
2. **Vitest config files in `apps/api/` must be `.mts`** — ESM-only plugins (`vite-tsconfig-paths`, `unplugin-swc`) need it.
3. **`apps/api` uses vitest@2; `apps/web` uses vitest@1** — do NOT try to unify here.
4. **Only `apps/web` has `biome.json` / lint+format scripts** — Phase 2 Task 2.0 adds shared Biome config, don't anticipate it elsewhere.
5. **`apps/api/tsconfig.json` and `tsconfig.build.json` `include` must stay narrow** (`["src/**/*"]`) — widening breaks `nest build`'s rootDir inference.
6. **Error response shape** today is `{success:false, error:string}` (Phase 1). Phase 2 Task 2.4 upgrades it to the spec §4.3 shape `{error:{code,message,requestId,details?}}`. This is a **breaking wire-format change** — FE `api-client.ts` updates in the same Phase 2 PR.

**Global commit cadence:** one commit per task. Prefix convention from Phase 0:
- `feat:` new user-visible functionality
- `build:` tooling / config
- `refactor:` structural changes with no behaviour change
- `test:` test-only
- `fix:` bug fix
- `docs:` README / plan / spec updates
- `chore:` housekeeping

**Global rule: one phase = one PR.** After each phase's DoD passes, push the branch, open a PR, merge, **then** start the next phase from the updated main. Branch names: `feat/nestjs-phase-2`, `feat/nestjs-phase-4`, etc. Mix commits from two phases in one branch → reviewer will ask you to split.

**Worktree setup** (do ONCE per phase, before Pre-flight):

```bash
# After previous phase merged to main
git fetch origin
git -C /Users/fangyong/vllm/modeldoctor/main pull --ff-only origin main
git worktree add /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-<N> \
  -b feat/nestjs-phase-<N> main
cd /Users/fangyong/vllm/modeldoctor/feat/nestjs-phase-<N>
pnpm install
pnpm -r type-check   # baseline must be green
pnpm -r test         # baseline must be green
```

---

# Phase 2 — Infrastructure (config / logging / OpenAPI / error-shape upgrade / static serving)

**Phase goal:** make the API production-shaped: typed config loaded and validated at boot, structured JSON logs with per-request correlation id, OpenAPI browsable at `/api/docs`, unified error envelope matching spec §4.3, and static FE bundle served by Nest in production (single-process deploy).

**Estimated effort:** ~1 day for one engineer.

**Deliverables summary:**
- `apps/api/src/config/env.schema.ts` — Zod schema of every env var, validated on boot
- `apps/api/src/common/middleware/request-id.middleware.ts` — generates/propagates `X-Request-Id`
- `apps/api/src/common/filters/all-exceptions.filter.ts` — **upgraded** to spec §4.3 shape (replaces the Phase 1 version)
- `nestjs-pino` wired as the Nest logger; `pino-pretty` in dev
- `@nestjs/swagger` mounted at `/api/docs` and `/api/docs-json`
- `ServeStaticModule` serving `apps/web/dist/` in prod
- `apps/web/src/lib/api-client.ts` updated to parse new error shape
- Shared Biome config at repo root; `apps/api` and `packages/contracts` get `lint`/`format` scripts

## Phase 2 Pre-flight

- [ ] **Step P2.0.1: Worktree and baseline**

Follow the "Worktree setup" block at the top of this document, with `<N>=2`. Confirm:

```bash
pnpm -r type-check && pnpm -r test && pnpm -F @modeldoctor/api test:e2e
```
All green. Phase 2 starts from here.

- [ ] **Step P2.0.2: Confirm required deps are already installed**

```bash
pnpm -F @modeldoctor/api list @nestjs/config nestjs-pino pino pino-http pino-pretty @nestjs/swagger nestjs-zod | head -40
```
Expected: all of them resolve to versions from Phase 0's install (`@nestjs/config ^3`, `nestjs-pino ^4`, `pino ^9`, `pino-http ^10`, `pino-pretty ^11`, `@nestjs/swagger ^7`, `nestjs-zod ^3`). If any is missing, something drifted — run `pnpm install` and recheck.

## Task 2.0: Shared Biome config (enables lint/format in apps/api and packages/contracts)

**Files:**
- Create: `biome.json` (repo root)
- Delete: `apps/web/biome.json` (supersede with root)
- Modify: `apps/web/package.json` (lint/format scripts unchanged path-wise; they still target `src`)
- Modify: `apps/api/package.json` (add `lint` + `format` scripts)
- Modify: `packages/contracts/package.json` (add `lint` + `format` scripts)

**Why now:** later Phase 2 tasks touch both `apps/api/src/` and FE code. A shared lint config prevents "lint passes locally, fails in CI" drift.

- [ ] **Step P2.0.1: Move `apps/web/biome.json` to repo root and widen scope**

Read `apps/web/biome.json`, extend its `files.include`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["**/dist", "**/node_modules", "**/coverage", "**/.vite"]
  },
  "organizeImports": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "jsxQuoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "noUselessElse": "warn", "useConst": "warn" },
      "suspicious": { "noExplicitAny": "warn", "noArrayIndexKey": "warn" },
      "correctness": { "useExhaustiveDependencies": "warn" }
    }
  }
}
```
Write this file at the repo root as `biome.json`. Then:
```bash
rm apps/web/biome.json
```

- [ ] **Step P2.0.2: Add `lint`/`format` scripts to `apps/api/package.json`**

In the `scripts` block, add:
```json
    "lint": "biome check src",
    "format": "biome format --write src",
```

- [ ] **Step P2.0.3: Same for `packages/contracts/package.json`**

```json
    "lint": "biome check src",
    "format": "biome format --write src",
```

- [ ] **Step P2.0.4: Run lint across the workspace**

```bash
pnpm lint
```
Expect: apps/api and packages/contracts both report "Checked N files" cleanly. If they find formatting drift, run `pnpm format` and re-lint (commit in this task). **Do NOT** try to hand-fix — trust the formatter.

- [ ] **Step P2.0.5: Commit**

```bash
git add biome.json apps/web/biome.json apps/api/package.json packages/contracts/package.json
# Include any formatter-touched files:
git add apps/api/src packages/contracts/src 2>/dev/null || true
git commit -m "build: shared Biome config at repo root; enable lint/format in api + contracts"
```

## Task 2.1: Env schema + `@nestjs/config`

**Files:**
- Create: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/config/config.module.ts`
- Create: `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import AppConfigModule)
- Create: `.env.example` (repo root)

- [ ] **Step P2.1.1: Write `env.schema.ts`**

```typescript
// apps/api/src/config/env.schema.ts
import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  // CORS in non-production — comma-separated origin list
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((s) => s.split(",").map((o) => o.trim()).filter(Boolean)),

  // Placeholders for later phases — required fields land in their respective phase tasks.
  // Keep optional here so Phase 2 doesn't force operators to set them prematurely.
  DATABASE_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().positive().default(7),
  DISABLE_FIRST_USER_ADMIN: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step P2.1.2: Write `config.module.ts`**

```typescript
// apps/api/src/config/config.module.ts
import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "./env.schema.js";

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
```

- [ ] **Step P2.1.3: TDD the validator**

```typescript
// apps/api/src/config/env.spec.ts
import { describe, it, expect } from "vitest";
import { validateEnv } from "./env.schema.js";

describe("validateEnv", () => {
  it("accepts minimal env", () => {
    const env = validateEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("coerces PORT string to number", () => {
    const env = validateEnv({ PORT: "8080" });
    expect(env.PORT).toBe(8080);
  });

  it("rejects bad LOG_LEVEL", () => {
    expect(() => validateEnv({ LOG_LEVEL: "chatty" })).toThrow(/LOG_LEVEL/);
  });

  it("splits CORS_ORIGINS on comma", () => {
    const env = validateEnv({ CORS_ORIGINS: "http://a,http://b" });
    expect(env.CORS_ORIGINS).toEqual(["http://a", "http://b"]);
  });

  it("rejects JWT_ACCESS_SECRET shorter than 32 chars when provided", () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
  });
});
```

- [ ] **Step P2.1.4: Register `AppConfigModule` in `AppModule`**

Edit `apps/api/src/app.module.ts` — add `AppConfigModule` to imports at the top of the list (it's `isGlobal: true` so order doesn't matter functionally, but convention is to put config first).

- [ ] **Step P2.1.5: Create `.env.example`**

At repo root:
```
# apps/api — loaded by @nestjs/config in apps/api/src/main.ts

NODE_ENV=development
PORT=3001
LOG_LEVEL=info
CORS_ORIGINS=http://localhost:5173

# Phase 4+ (uncomment when DB arrives)
# DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor

# Phase 5+ (uncomment when auth arrives; must be >= 32 chars random)
# JWT_ACCESS_SECRET=
# JWT_ACCESS_EXPIRES_IN=15m
# JWT_REFRESH_EXPIRES_DAYS=7
# DISABLE_FIRST_USER_ADMIN=false
```

- [ ] **Step P2.1.6: Run tests + type-check**

```bash
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api type-check
```
Green.

- [ ] **Step P2.1.7: Commit**

```bash
git add apps/api/src/config apps/api/src/app.module.ts .env.example
git commit -m "feat(api): typed env schema + @nestjs/config with fail-fast validation"
```

## Task 2.2: RequestId middleware + interceptor binding

**Files:**
- Create: `apps/api/src/common/middleware/request-id.middleware.ts`
- Create: `apps/api/src/common/middleware/request-id.middleware.spec.ts`
- Modify: `apps/api/src/app.module.ts` (apply middleware globally)

- [ ] **Step P2.2.1: Install `nanoid`**

```bash
pnpm -F @modeldoctor/api add nanoid
```

- [ ] **Step P2.2.2: Write the middleware**

```typescript
// apps/api/src/common/middleware/request-id.middleware.ts
import { Injectable, NestMiddleware } from "@nestjs/common";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";

const HEADER_NAME = "x-request-id";
/** Accept client-provided request ids that look "safe" — alphanumeric + dashes, 8-64 chars. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER_NAME);
    const id = incoming && SAFE_ID.test(incoming) ? incoming : nanoid(16);
    req.id = id;
    res.setHeader(HEADER_NAME, id);
    next();
  }
}
```

- [ ] **Step P2.2.3: Apply globally in `AppModule`**

```typescript
// in AppModule:
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware.js";
// ... existing imports

@Module({ /* ... */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
```

- [ ] **Step P2.2.4: Unit test the middleware**

```typescript
// apps/api/src/common/middleware/request-id.middleware.spec.ts
import { describe, it, expect, vi } from "vitest";
import { RequestIdMiddleware } from "./request-id.middleware.js";

describe("RequestIdMiddleware", () => {
  const mw = new RequestIdMiddleware();

  function makeReq(header?: string): { req: any; res: any; next: any } {
    const req: any = { header: vi.fn().mockReturnValue(header) };
    const res: any = { setHeader: vi.fn() };
    const next = vi.fn();
    return { req, res, next };
  }

  it("generates a 16-char id when header is absent", () => {
    const { req, res, next } = makeReq(undefined);
    mw.use(req, res, next);
    expect(req.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", req.id);
    expect(next).toHaveBeenCalled();
  });

  it("echoes a safe incoming id", () => {
    const { req, res, next } = makeReq("trace-abc123xyz");
    mw.use(req, res, next);
    expect(req.id).toBe("trace-abc123xyz");
    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "trace-abc123xyz");
  });

  it("rejects unsafe incoming id and generates new one", () => {
    const { req, res, next } = makeReq("../etc/passwd");
    mw.use(req, res, next);
    expect(req.id).not.toBe("../etc/passwd");
    expect(req.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
```

- [ ] **Step P2.2.5: Run tests**

```bash
pnpm -F @modeldoctor/api test
```
Green.

- [ ] **Step P2.2.6: Commit**

```bash
git add apps/api/src/common/middleware apps/api/src/app.module.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): RequestId middleware (generates/propagates X-Request-Id)"
```

## Task 2.3: nestjs-pino logger replacing Nest's default

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

- [ ] **Step P2.3.1: Wire `LoggerModule` in `AppModule`**

Edit `apps/api/src/app.module.ts`:

```typescript
import { LoggerModule } from "nestjs-pino";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./config/env.schema.js";

// In the imports array, append:
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get("LOG_LEVEL", { infer: true }),
          // Correlate with the RequestId middleware
          genReqId: (req) => (req as { id?: string }).id ?? "",
          customProps: (req) => ({ requestId: (req as { id?: string }).id }),
          transport:
            config.get("NODE_ENV", { infer: true }) === "development"
              ? { target: "pino-pretty", options: { singleLine: true, colorize: true } }
              : undefined,
          // Suppress /api/health access logs — too noisy
          autoLogging: {
            ignore: (req) => req.url === "/api/health",
          },
        },
      }),
    }),
```

- [ ] **Step P2.3.2: Tell Nest to use Pino as its logger**

Edit `apps/api/src/main.ts`:

```typescript
import { Logger } from "nestjs-pino";
// ...

async function bootstrap(): Promise<void> {
  const app: INestApplication = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix("api");
  // ... (rest unchanged; CORS block replaced in Task 2.5)
}
```

- [ ] **Step P2.3.3: Manual smoke**

```bash
pnpm -F @modeldoctor/api start:dev
```
Expected: pretty-printed, colorful dev logs instead of Nest's default. Hit `GET /api/health` from another terminal:
```bash
curl -s http://localhost:3001/api/health
```
Expected: no log line for this request (autoLogging.ignore skipped it). Hit any other endpoint to see the JSON / pretty log with `requestId`.

Kill the dev process.

- [ ] **Step P2.3.4: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(api): nestjs-pino logger with requestId correlation and dev pretty print"
```

## Task 2.4: Upgrade `AllExceptionsFilter` to spec §4.3 shape + update FE

**Files:**
- Modify: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Modify: `apps/api/test/e2e/*.e2e-spec.ts` (existing e2e assertions that check `res.body.error` as string must update)
- Create: `packages/contracts/src/errors.ts` (extend existing file with new shape)
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.spec.ts` OR equivalent (write one if missing)

**Why this is one task** (across BE + contracts + FE): the shape change is atomic. A PR that upgrades BE without FE breaks the UI; a PR that updates FE without BE breaks error rendering. Ship them together.

**Target shape** (from spec §4.3):
```typescript
{
  error: {
    code: string;        // stable identifier: "VALIDATION_FAILED", "INTERNAL_SERVER_ERROR", ...
    message: string;     // human-readable
    details?: unknown;   // structured detail (Zod issues array, etc.)
    requestId: string;   // from RequestId middleware
  }
}
```

- [ ] **Step P2.4.1: Add the new Zod contract**

Append to `packages/contracts/src/errors.ts`:

```typescript
export const StandardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type StandardErrorResponse = z.infer<typeof StandardErrorResponseSchema>;

/** Stable error codes. Append-only — never change the string of an existing code. */
export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

Keep the old `ApiErrorResponseSchema` for Phase 1 clients — mark it `@deprecated` in a comment. Remove it in a later cleanup phase.

- [ ] **Step P2.4.2: Rewrite `AllExceptionsFilter`**

```typescript
// apps/api/src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorCodes, type ErrorCode } from "@modeldoctor/contracts";

function httpStatusToCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCodes.BAD_REQUEST;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCodes.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCodes.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCodes.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCodes.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCodes.TOO_MANY_REQUESTS;
    default:
      return ErrorCodes.INTERNAL_SERVER_ERROR;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as { id?: string }).id ?? "";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCodes.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = httpStatusToCode(status);
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const rec = body as Record<string, unknown>;
        // ZodValidationPipe throws BadRequestException("path: message") — preserve
        if (typeof rec.message === "string") {
          message = rec.message;
        } else if (Array.isArray(rec.message)) {
          message = rec.message.join("; ");
        } else {
          message = exception.message;
        }
        if ("details" in rec) details = rec.details;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      // Never leak stack to client
      this.logger.error({ requestId, err: exception }, "Unhandled exception");
    }

    response.status(status).json({
      error: { code, message, ...(details !== undefined ? { details } : {}), requestId },
    });
  }
}
```

The filter is **already registered globally** in `main.ts` (Phase 1 wired it), so no main.ts change needed — just the class body swap.

- [ ] **Step P2.4.3: Extend `ZodValidationPipe` to include structured details**

```typescript
// apps/api/src/common/pipes/zod-validation.pipe.ts
import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const first = result.error.issues[0];
    const path = first?.path.join(".") || "body";
    const message = first?.message || "Validation failed";
    throw new BadRequestException({
      message: `${path}: ${message}`,
      details: result.error.issues, // becomes `details` in the final envelope
    });
  }
}
```
The `details` key inside the `BadRequestException` body is picked up by `AllExceptionsFilter.catch` in Step P2.4.2. Also bump `code` → `VALIDATION_FAILED` for this specific case by adding a branch in the filter:

```typescript
// Inside AllExceptionsFilter, after `code = httpStatusToCode(status)`:
if (
  status === HttpStatus.BAD_REQUEST &&
  body && typeof body === "object" &&
  "details" in (body as Record<string, unknown>)
) {
  code = ErrorCodes.VALIDATION_FAILED;
}
```

- [ ] **Step P2.4.4: Update existing e2e assertions**

Every e2e spec in `apps/api/test/e2e/` that asserts on `res.body.error` as a string OR `res.body.success === false` must update. For example, in `health.e2e-spec.ts` there's no error assertion to change. In `debug-proxy.e2e-spec.ts` Task 6.5 had:

```typescript
expect(res.body).toEqual({ success: false, error: expect.stringContaining("url") });
```
Becomes:
```typescript
expect(res.body.error.code).toBe("VALIDATION_FAILED");
expect(res.body.error.message).toMatch(/url/);
expect(res.body.error.requestId).toMatch(/^[A-Za-z0-9_-]+$/);
```

Sweep all e2e specs via:
```bash
grep -nR "success: false" apps/api/test/ | head -20
grep -nR "body.error" apps/api/test/ | head -20
```
Update each to the new shape.

Similarly for the timeout-case `/api/debug/proxy` which **returns 200 with `{success:false,error}`** (the endpoint's own wire format, NOT an exception) — that one stays as-is, it's a domain response not an error envelope.

- [ ] **Step P2.4.5: Update FE `api-client.ts` to parse the new shape**

```typescript
// apps/web/src/lib/api-client.ts
import { StandardErrorResponseSchema } from "@modeldoctor/contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, text || `HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    const parsed = StandardErrorResponseSchema.safeParse(data);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.message,
        parsed.data.error.code,
        parsed.data.error.requestId,
        parsed.data.error.details,
      );
    }
    // Fall through for non-conforming responses (e.g. Vite proxy errors)
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
};
```

- [ ] **Step P2.4.6: Update FE tests that assert error handling**

Search:
```bash
grep -nR "ApiError" apps/web/src | head -20
grep -nR '"error"' apps/web/src | head -20
```
Fix any test mocks that return `{success:false,error:"..."}` to instead return `{error:{code,message,requestId}}` so the FE parser accepts them. If there's a test at `apps/web/src/lib/api-client.test.ts`, update. If there isn't, **write one** covering both shapes (new envelope + fallback for non-conforming text).

- [ ] **Step P2.4.7: Run full stack**

```bash
pnpm -r type-check
pnpm -r test
pnpm -F @modeldoctor/api test:e2e
```
All green.

- [ ] **Step P2.4.8: Manual FE smoke**

```bash
pnpm dev
```
Open browser → Request Debug tab → send an invalid curl (e.g. empty URL). The UI should display an error whose message is the new `error.message` field. No regressions.

Kill.

- [ ] **Step P2.4.9: Commit**

```bash
git add packages/contracts/src apps/api/src/common apps/api/test apps/web/src/lib
git commit -m "feat: upgrade error response to {error:{code,message,requestId,details?}} (breaking wire change)"
```

## Task 2.5: Env-driven CORS

**Files:**
- Modify: `apps/api/src/main.ts`

- [ ] **Step P2.5.1: Replace the hardcoded CORS block**

```typescript
// apps/api/src/main.ts (inside bootstrap, replacing the existing `if (process.env.NODE_ENV !== "production")` block)
import { ConfigService } from "@nestjs/config";
import type { Env } from "./config/env.schema.js";

// after app.setGlobalPrefix("api"):
const config = app.get(ConfigService<Env, true>);
const origins = config.get("CORS_ORIGINS", { infer: true });
app.enableCors({
  origin: origins,
  credentials: true,
});

const port = config.get("PORT", { infer: true });
```

Replace the old `const port = Number(process.env.PORT ?? 3001);` line with the new one.

- [ ] **Step P2.5.2: Smoke**

```bash
CORS_ORIGINS=http://localhost:5173,http://localhost:4000 pnpm -F @modeldoctor/api start:dev
```
Expected: start with no errors. `curl -H "Origin: http://localhost:4000" ...` should be allowed.

- [ ] **Step P2.5.3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "refactor(api): drive CORS origins + port from typed ConfigService"
```

## Task 2.6: OpenAPI at `/api/docs`

**Files:**
- Modify: `apps/api/src/main.ts`
- Optionally create: `apps/api/src/common/swagger.ts` (helper)
- Modify: each controller in `apps/api/src/modules/*` (add `@ApiTags`, `@ApiOperation`, `@ApiBody`, `@ApiResponse` decorators)

- [ ] **Step P2.6.1: Wire `SwaggerModule` in `main.ts`**

Inside `bootstrap()`, before `app.listen(port)`:

```typescript
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { patchNestJsSwagger } from "nestjs-zod";

// Once-only global Zod ↔ OpenAPI schema patching:
patchNestJsSwagger();

const swaggerConfig = new DocumentBuilder()
  .setTitle("ModelDoctor API")
  .setDescription("Troubleshooting toolkit for model-serving APIs")
  .setVersion("0.1.0")
  .addBearerAuth() // used starting Phase 5
  .build();

const document = SwaggerModule.createDocument(app, swaggerConfig);
SwaggerModule.setup("api/docs", app, document, {
  jsonDocumentUrl: "api/docs-json",
});
```

`patchNestJsSwagger()` is **required** to teach Swagger how to render Zod schemas — without it, request/response bodies in the UI appear as empty `{}`. See nestjs-zod README.

- [ ] **Step P2.6.2: Annotate each controller**

For one controller, show the pattern. The executor applies the same to all four.

Example — `health.controller.ts`:

```typescript
import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service.js";
import {
  HealthResponseSchema,
  CheckVegetaResponseSchema,
  type HealthResponse,
  type CheckVegetaResponse,
} from "@modeldoctor/contracts";
import { createZodDto } from "nestjs-zod";

class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
class CheckVegetaResponseDto extends createZodDto(CheckVegetaResponseSchema) {}

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @ApiOperation({ summary: "Liveness probe" })
  @ApiOkResponse({ type: HealthResponseDto })
  @Get("health")
  getHealth(): HealthResponse {
    return this.health.getHealth();
  }

  @ApiOperation({ summary: "Check if Vegeta CLI is installed on the host" })
  @ApiOkResponse({ type: CheckVegetaResponseDto })
  @Get("check-vegeta")
  checkVegeta(): Promise<CheckVegetaResponse> {
    return this.health.checkVegeta();
  }
}
```

For POST endpoints, use `@ApiBody({ type: <RequestDto> })` and `@ApiCreatedResponse` or `@ApiOkResponse`. Build `<xxx>Dto` classes via `createZodDto` for every request/response schema.

Apply to: `DebugProxyController`, `E2ETestController`, `LoadTestController`.

- [ ] **Step P2.6.3: Smoke docs**

```bash
pnpm -F @modeldoctor/api start:dev
```
Open `http://localhost:3001/api/docs`. Expect: all 4 tags (health, debug-proxy, e2e-test, load-test) present; each endpoint's schema rendered with fields, types, required markers.

```bash
curl -s http://localhost:3001/api/docs-json | jq '.paths | keys'
```
Expected: JSON listing `["/api/check-vegeta","/api/debug/proxy","/api/e2e-test","/api/health","/api/load-test"]`.

Kill.

- [ ] **Step P2.6.4: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/modules
git commit -m "feat(api): OpenAPI at /api/docs via @nestjs/swagger + nestjs-zod schema patcher"
```

## Task 2.7: `ServeStaticModule` — production-mode FE serving

**Files:**
- Modify: `apps/api/package.json` (add dep)
- Modify: `apps/api/src/app.module.ts`

**Behaviour:** in prod, Nest serves `apps/web/dist/index.html` for any non-`/api/*` path (SPA fallback). In dev, leave Vite alone.

- [ ] **Step P2.7.1: Install**

```bash
pnpm -F @modeldoctor/api add @nestjs/serve-static
```

- [ ] **Step P2.7.2: Register in `AppModule`**

```typescript
// apps/api/src/app.module.ts
import { ServeStaticModule } from "@nestjs/serve-static";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "./config/env.schema.js";
import path from "node:path";

// in imports array:
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        // Only serve static in production — in dev, Vite handles the FE.
        if (config.get("NODE_ENV", { infer: true }) !== "production") {
          return []; // empty → no static middleware registered
        }
        return [
          {
            // apps/api/dist/main.js is the runtime; apps/web/dist is ../../apps/web/dist relative to it.
            rootPath: path.resolve(process.cwd(), "apps/web/dist"),
            exclude: ["/api/(.*)", "/api/docs", "/api/docs-json"],
          },
        ];
      },
    }),
```

**Important**: `process.cwd()` assumption — `node apps/api/dist/main.js` is run from the repo root (the `pnpm start` script already does this). If Docker changes that, Task 6.1 revisits this path.

- [ ] **Step P2.7.3: Smoke prod build**

```bash
pnpm build
NODE_ENV=production pnpm start &
sleep 3
curl -s -o /dev/null -w "api: %{http_code}\n" http://localhost:3001/api/health
curl -s -o /dev/null -w "web: %{http_code}\n" http://localhost:3001/
curl -s -o /dev/null -w "spa-deep: %{http_code}\n" http://localhost:3001/some/spa/path
pkill -f "node apps/api/dist/main.js"
```
Expected: `api: 200`, `web: 200` (renders `apps/web/dist/index.html`), `spa-deep: 200` (SPA fallback). If `spa-deep` returns 404, the SPA fallback isn't wired — check `@nestjs/serve-static` docs for `serveRoot` / `renderPath`.

- [ ] **Step P2.7.4: Commit**

```bash
git add apps/api/package.json apps/api/src/app.module.ts pnpm-lock.yaml
git commit -m "feat(api): serve apps/web/dist in production via ServeStaticModule (SPA fallback)"
```

## Phase 2 DoD

- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r test` green (unit tests for env validator + requestId middleware + any updated api-client tests)
- [ ] `pnpm test:e2e` green (all 4 modules' e2e with new error shape)
- [ ] `pnpm build` green
- [ ] `NODE_ENV=production pnpm start` serves API on `/api/*` and FE on everything else, single process
- [ ] `/api/docs` renders all 4 endpoints with Zod-derived schemas
- [ ] Missing required env vars fail boot with a readable error
- [ ] Every error response includes a `requestId` matching the `X-Request-Id` response header
- [ ] `pnpm lint` green across all 3 packages (root biome config picked up everywhere)

## Phase 2 PR

Push branch, `gh pr create --base main --head feat/nestjs-phase-2 --title "Phase 2: infrastructure (config / pino / OpenAPI / error shape / static serving)"`. Merge. Then proceed to Phase 4.

---

# Phase 4 — Database (Postgres + Prisma)

**Phase goal:** introduce a persistent store. Define initial models (`User`, `RefreshToken`, `LoadTestRun`). Wire Prisma with lifecycle-managed connection. Persist every load-test run. Expose `GET /api/load-test/runs` for history. Set up testcontainers-backed integration tests in CI.

**Estimated effort:** ~2 days.

**Why skip Phase 3:** Phase 1 Task 10 already had FE import types from `@modeldoctor/contracts`. The remaining Phase 3 work (FE `api-client.ts` using Zod `.parse()`) was folded into Phase 2 Task 2.4 since the new error envelope needed parsing anyway.

## Phase 4 Pre-flight

- [ ] **Step P4.0.1: Worktree**: branch `feat/nestjs-phase-4` from main (with Phase 2 merged).

- [ ] **Step P4.0.2: Baseline**: `pnpm -r type-check && pnpm -r test && pnpm test:e2e` green.

- [ ] **Step P4.0.3: Local Docker available**: `docker info` succeeds. If not, install Docker Desktop or Colima (`brew install colima && colima start`).

## Task 4.1: Local Postgres via `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml` (repo root)
- Modify: `.env.example` (uncomment `DATABASE_URL`)
- Modify: `README.md` (add "Start Postgres" section)

- [ ] **Step P4.1.1: Write `docker-compose.yml`**

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: modeldoctor-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: modeldoctor
      POSTGRES_PASSWORD: modeldoctor
      POSTGRES_DB: modeldoctor
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U modeldoctor -d modeldoctor"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  postgres-data:
```

`postgres-data/` is already in `.gitignore` (Phase 0 Task 13). Confirm with `grep postgres-data .gitignore`.

- [ ] **Step P4.1.2: Update `.env.example`**

Replace the commented-out DATABASE_URL with:
```
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor
```

- [ ] **Step P4.1.3: Smoke**

```bash
docker compose up -d postgres
docker compose ps
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "SELECT 1;"
docker compose down
```
First two lines expect healthy container. `psql` expects `?column? = 1` (or similar) output.

- [ ] **Step P4.1.4: Commit**

```bash
git add docker-compose.yml .env.example README.md
git commit -m "build: add docker-compose.yml with Postgres 16 for local dev"
```

## Task 4.2: Install Prisma, write schema, wire `PrismaService`

**Files:**
- Modify: `apps/api/package.json` (add deps)
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/database/prisma.service.ts`
- Create: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/config/env.schema.ts` (make `DATABASE_URL` required when NODE_ENV !== "test")

- [ ] **Step P4.2.1: Install Prisma**

```bash
pnpm -F @modeldoctor/api add prisma @prisma/client
```
The `pnpm.onlyBuiltDependencies` in root `package.json` (added in Phase 0) must now also include `"@prisma/client"` and `"prisma"` — they have postinstall scripts:

```jsonc
// package.json (root)
"pnpm": {
  "onlyBuiltDependencies": ["@swc/core", "prisma", "@prisma/client"]
}
```

Reinstall:
```bash
pnpm install
```

- [ ] **Step P4.2.2: Write the initial schema**

```prisma
// apps/api/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  roles        String[] @default([])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  refreshTokens RefreshToken[]
  loadTestRuns  LoadTestRun[]

  @@index([email])
}

model RefreshToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, revokedAt])
  @@index([tokenHash])
}

model LoadTestRun {
  id          String    @id @default(cuid())
  userId      String?
  apiType     String
  apiUrl      String
  model       String
  rate        Int
  duration    Int
  status      String    @default("completed") // completed | failed
  summaryJson Json
  rawReport   String    @db.Text
  createdAt   DateTime  @default(now())
  completedAt DateTime?

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([createdAt])
}
```

`userId` is nullable in `LoadTestRun` because runs created before Phase 5 auth has no associated user.

- [ ] **Step P4.2.3: Generate client and create initial migration**

```bash
cd apps/api
pnpm exec prisma generate
docker compose up -d postgres
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  pnpm exec prisma migrate dev --name init
```
Migration file lands at `apps/api/prisma/migrations/<timestamp>_init/migration.sql`. **Do commit this file** (and all migrations going forward).

Confirm:
```bash
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor -c "\dt"
```
Expected: `User`, `RefreshToken`, `LoadTestRun`, `_prisma_migrations` tables visible.

- [ ] **Step P4.2.4: Write `PrismaService`**

```typescript
// apps/api/src/database/prisma.service.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Prisma connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log("Prisma disconnected");
  }
}
```

- [ ] **Step P4.2.5: Write `DatabaseModule`**

```typescript
// apps/api/src/database/database.module.ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

- [ ] **Step P4.2.6: Register globally in `AppModule`**

Add `DatabaseModule` to the imports array.

- [ ] **Step P4.2.7: Tighten env schema**

```typescript
// apps/api/src/config/env.schema.ts — find DATABASE_URL
DATABASE_URL: z.string().url().optional(),
// Replace with:
DATABASE_URL: z.string().url(),
```
(No more `.optional()` — DB is now required to boot.)

Update the existing `env.spec.ts`: the "accepts minimal env" test needs `DATABASE_URL` set to pass. Fix the test.

- [ ] **Step P4.2.8: Add scripts to `apps/api/package.json`**

```json
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:generate": "prisma generate"
```

- [ ] **Step P4.2.9: Smoke**

```bash
cd apps/api
pnpm db:generate
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor pnpm start:dev
```
Logs should show `[PrismaService] Prisma connected`. Kill.

- [ ] **Step P4.2.10: Commit**

```bash
git add apps/api/package.json apps/api/prisma apps/api/src/database apps/api/src/app.module.ts apps/api/src/config package.json pnpm-lock.yaml
git commit -m "feat(api): Prisma + Postgres (User, RefreshToken, LoadTestRun) + PrismaService lifecycle"
```

## Task 4.3: Persist every `/api/load-test` invocation

**Files:**
- Modify: `apps/api/src/modules/load-test/load-test.service.ts`
- Modify: `apps/api/src/modules/load-test/load-test.module.ts`
- Modify: `apps/api/test/e2e/load-test.e2e-spec.ts` (once we have testcontainers — Task 4.5)

- [ ] **Step P4.3.1: Inject `PrismaService`**

```typescript
// apps/api/src/modules/load-test/load-test.service.ts — top of class
constructor(private readonly prisma: PrismaService) {}
```

- [ ] **Step P4.3.2: Persist on success**

Inside the `run` method, after the vegeta process resolves and before the `return`, insert:

```typescript
const run = await this.prisma.loadTestRun.create({
  data: {
    userId: null, // populated starting Phase 5
    apiType,
    apiUrl: finalUrl,
    model: req.model,
    rate: req.rate,
    duration: req.duration,
    status: "completed",
    summaryJson: parsed as unknown as object, // Prisma Json column
    rawReport: stdout,
    completedAt: new Date(),
  },
});
// Optionally include the run id in the response. The spec doesn't require it,
// but the FE History tab will want it. Add `runId: run.id` to the response
// AND add to LoadTestResponseSchema in packages/contracts. Keep this change
// minimal — don't rename existing fields.
```

Update `LoadTestResponseSchema` in `packages/contracts/src/load-test.ts`:
```typescript
export const LoadTestResponseSchema = z.object({
  success: z.literal(true),
  runId: z.string().optional(), // NEW — present once DB is wired; optional so older consumers don't break
  report: z.string(),
  parsed: LoadTestParsedSchema,
  config: z.object({ /* ... existing ... */ }),
});
```

- [ ] **Step P4.3.3: Also persist failures**

Wrap the inner vegeta promise in a `try { ... } catch (err) { ... }`. On catch, `await prisma.loadTestRun.create(... status: "failed" ...)` then rethrow. This is straightforward; just mirror the success-path code.

- [ ] **Step P4.3.4: Commit**

```bash
git add apps/api/src/modules/load-test packages/contracts/src/load-test.ts
git commit -m "feat(api): persist every load-test run to DB (LoadTestRun rows)"
```

## Task 4.4: `GET /api/load-test/runs` — paginated list

**Files:**
- Modify: `packages/contracts/src/load-test.ts` (add request + response schemas)
- Modify: `apps/api/src/modules/load-test/load-test.controller.ts`
- Modify: `apps/api/src/modules/load-test/load-test.service.ts`

- [ ] **Step P4.4.1: Add Zod contracts**

```typescript
// packages/contracts/src/load-test.ts — append
export const LoadTestRunSummarySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  apiType: ApiTypeSchema,
  apiUrl: z.string(),
  model: z.string(),
  rate: z.number(),
  duration: z.number(),
  status: z.enum(["completed", "failed"]),
  summaryJson: LoadTestParsedSchema.nullable(),
  createdAt: z.string(), // ISO
  completedAt: z.string().nullable(), // ISO
});
export type LoadTestRunSummary = z.infer<typeof LoadTestRunSummarySchema>;

export const ListLoadTestRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListLoadTestRunsQuery = z.infer<typeof ListLoadTestRunsQuerySchema>;

export const ListLoadTestRunsResponseSchema = z.object({
  items: z.array(LoadTestRunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListLoadTestRunsResponse = z.infer<typeof ListLoadTestRunsResponseSchema>;
```

- [ ] **Step P4.4.2: Controller**

```typescript
// apps/api/src/modules/load-test/load-test.controller.ts — add
import { Get, Query, UsePipes } from "@nestjs/common";
import {
  ListLoadTestRunsQuerySchema,
  type ListLoadTestRunsQuery,
  type ListLoadTestRunsResponse,
} from "@modeldoctor/contracts";

@Get("load-test/runs")
@UsePipes(new ZodValidationPipe(ListLoadTestRunsQuerySchema))
listRuns(@Query() query: ListLoadTestRunsQuery): Promise<ListLoadTestRunsResponse> {
  return this.svc.listRuns(query);
}
```

- [ ] **Step P4.4.3: Service — cursor pagination**

```typescript
// apps/api/src/modules/load-test/load-test.service.ts — add method
async listRuns(query: ListLoadTestRunsQuery): Promise<ListLoadTestRunsResponse> {
  const limit = query.limit;
  const rows = await this.prisma.loadTestRun.findMany({
    take: limit + 1, // peek one past to know if there's a next page
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
  });
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    userId: r.userId,
    apiType: r.apiType as ApiType,
    apiUrl: r.apiUrl,
    model: r.model,
    rate: r.rate,
    duration: r.duration,
    status: r.status as "completed" | "failed",
    summaryJson: r.summaryJson as LoadTestParsed | null,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
  const nextCursor = rows.length > limit ? rows[limit - 1].id : null;
  return { items, nextCursor };
}
```

- [ ] **Step P4.4.4: e2e** (once testcontainers is set up in Task 4.5)

Defer e2e for this task; Task 4.5 adds testcontainers and the test covers list+create.

- [ ] **Step P4.4.5: Manual smoke**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor pnpm -F @modeldoctor/api start:dev &
sleep 3
# Assuming vegeta is installed, run a small load test to populate a row
curl -X POST http://localhost:3001/api/load-test \
  -H "Content-Type: application/json" \
  -d '{"apiUrl":"https://httpbin.org/post","apiKey":"x","model":"m","apiType":"chat","prompt":"hi","maxTokens":4,"rate":1,"duration":2}'
# List runs
curl -s "http://localhost:3001/api/load-test/runs?limit=5" | jq .
pkill -f "nest start"
```
Expected: list shows at least one item.

- [ ] **Step P4.4.6: Commit**

```bash
git add apps/api/src/modules/load-test packages/contracts/src/load-test.ts
git commit -m "feat(api): GET /api/load-test/runs with cursor pagination"
```

## Task 4.5: testcontainers integration tests

**Files:**
- Modify: `apps/api/package.json` (add dev dep)
- Create: `apps/api/test/helpers/postgres-container.ts`
- Modify: `apps/api/vitest.e2e.config.mts` (bump test timeouts / global setup)
- Create: `apps/api/test/e2e/load-test-runs.e2e-spec.ts`
- Modify: existing e2e specs that want DB → opt-in

- [ ] **Step P4.5.1: Install**

```bash
pnpm -F @modeldoctor/api add -D @testcontainers/postgresql testcontainers
```

- [ ] **Step P4.5.2: Write the container helper**

```typescript
// apps/api/test/helpers/postgres-container.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  url: string;
  teardown: () => Promise<void>;
}

export async function startPostgres(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgres:16")
    .withDatabase("modeldoctor_test")
    .withUsername("test")
    .withPassword("test")
    .start();
  const url = container.getConnectionUri();

  // Apply all migrations to the fresh DB
  execSync("pnpm exec prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  return {
    container,
    url,
    teardown: async () => {
      await container.stop();
    },
  };
}
```

- [ ] **Step P4.5.3: Write the e2e for runs**

```typescript
// apps/api/test/e2e/load-test-runs.e2e-spec.ts
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { startPostgres, type TestDatabase } from "../helpers/postgres-container.js";

describe("LoadTestRuns (e2e)", () => {
  let app: INestApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startPostgres();
    process.env.DATABASE_URL = db.url;
    // Also set any other required env so ConfigModule validates:
    process.env.CORS_ORIGINS = "http://localhost:5173";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.$disconnect();
    await app.close();
    await db.teardown();
  });

  it("returns an empty list when no runs exist", async () => {
    const res = await request(app.getHttpServer()).get("/api/load-test/runs").expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("inserts a row directly and lists it", async () => {
    const prisma = app.get(PrismaService);
    await prisma.loadTestRun.create({
      data: {
        apiType: "chat",
        apiUrl: "http://x",
        model: "m",
        rate: 1,
        duration: 1,
        status: "completed",
        summaryJson: { requests: 1, success: 1, throughput: 1, latencies: {} },
        rawReport: "raw",
      },
    });
    const res = await request(app.getHttpServer()).get("/api/load-test/runs").expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].apiType).toBe("chat");
  });

  it("paginates with cursor", async () => {
    const prisma = app.get(PrismaService);
    // seed 3 more (total 4 from previous test survives within suite? actually each test
    // block shares state — this is fine for a linear narrative test)
    for (let i = 0; i < 3; i++) {
      await prisma.loadTestRun.create({
        data: {
          apiType: "chat",
          apiUrl: `http://x/${i}`,
          model: "m",
          rate: 1,
          duration: 1,
          status: "completed",
          summaryJson: {},
          rawReport: "",
        },
      });
    }
    const first = await request(app.getHttpServer()).get("/api/load-test/runs?limit=2").expect(200);
    expect(first.body.items.length).toBe(2);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await request(app.getHttpServer())
      .get(`/api/load-test/runs?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);
    expect(second.body.items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step P4.5.4: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```
Expect all prior tests + new runs tests pass. First run pulls `postgres:16` image (~30s).

- [ ] **Step P4.5.5: Commit**

```bash
git add apps/api/package.json apps/api/test pnpm-lock.yaml
git commit -m "test(api): testcontainers Postgres + LoadTestRun e2e (list + pagination)"
```

## Task 4.6: FE wiring is out of scope

The FE History tab is a Phase 1+ UI concern. Phase 4's deliverable is **the endpoint**, not the History page. The FE keeps its "Coming Soon" placeholder.

If the executor wants to add a minimal consumer in Phase 4 to prove the endpoint is usable, write a small component that lists runs at `/runs-debug` (not linked from sidebar). Keep it out of the production navigation.

## Phase 4 DoD

- [ ] `docker compose up -d postgres` → healthy
- [ ] `pnpm db:migrate:dev` works; initial migration committed under `apps/api/prisma/migrations/`
- [ ] `pnpm start:dev` with `DATABASE_URL` set → Prisma connects on boot
- [ ] `POST /api/load-test` persists a row on both success and failure paths
- [ ] `GET /api/load-test/runs` lists rows, paginates via cursor
- [ ] `pnpm test:e2e` includes testcontainers-backed suite, green locally (and ready for CI in Phase 6)
- [ ] `.env.example` has `DATABASE_URL` documented and commented out? No — uncomment it (required now)
- [ ] README has a "Start Postgres" section pointing at `docker compose up -d postgres`

## Phase 4 PR

Same flow as before. `feat/nestjs-phase-4 → main`. Merge. Proceed to Phase 5.

---

# Phase 5 — Authentication (JWT + refresh + RBAC + FE login)

**Phase goal:** introduce local email/password auth. Access tokens are short-lived JWTs; refresh tokens are opaque strings stored hashed in DB with rotation + theft detection. FE gets `/login` and `/register` pages; a global guard gates every API call except a short whitelist. First-registered user becomes admin (operator-toggleable via env).

**Estimated effort:** ~2–3 days.

## Phase 5 Pre-flight

- [ ] Worktree `feat/nestjs-phase-5` from main (Phase 4 merged).
- [ ] `pnpm -r type-check && pnpm test:e2e` green.
- [ ] `docker compose up -d postgres` running.

## Task 5.1: Install deps + env schema updates

- [ ] **Step P5.1.1: Install**

```bash
pnpm -F @modeldoctor/api add \
  @nestjs/passport @nestjs/jwt passport passport-jwt \
  argon2 @nestjs/throttler cookie-parser
pnpm -F @modeldoctor/api add -D @types/passport-jwt @types/cookie-parser
```
Add `argon2` to `pnpm.onlyBuiltDependencies` in root `package.json`:
```jsonc
"onlyBuiltDependencies": ["@swc/core", "prisma", "@prisma/client", "argon2"]
```
Reinstall: `pnpm install`.

- [ ] **Step P5.1.2: Tighten env schema**

`JWT_ACCESS_SECRET` becomes required:
```typescript
// apps/api/src/config/env.schema.ts
JWT_ACCESS_SECRET: z.string().min(32),  // was optional
```
Update `env.spec.ts` accordingly and extend `.env.example`:
```
JWT_ACCESS_SECRET=<generate 32+ random chars: `openssl rand -base64 48`>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_DAYS=7
DISABLE_FIRST_USER_ADMIN=false
```

- [ ] **Step P5.1.3: Install `cookie-parser` middleware in `main.ts`**

```typescript
import cookieParser from "cookie-parser";
// ...
app.use(cookieParser());
```

- [ ] **Step P5.1.4: Commit**

```bash
git add apps/api/package.json apps/api/src/config apps/api/src/main.ts package.json pnpm-lock.yaml .env.example
git commit -m "build: install auth deps (passport/jwt/argon2/throttler/cookie-parser) + tighten env"
```

## Task 5.2: Zod contracts for auth

- [ ] **Step P5.2.1: Write `packages/contracts/src/auth.ts`**

```typescript
import { z } from "zod";

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  roles: z.array(z.string()),
  createdAt: z.string(), // ISO
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = RegisterRequestSchema;
export type LoginRequest = RegisterRequest;

export const AuthTokenResponseSchema = z.object({
  accessToken: z.string(),
  user: PublicUserSchema,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

export const MeResponseSchema = PublicUserSchema;
export type MeResponse = z.infer<typeof MeResponseSchema>;
```

Add `export * from "./auth.js";` to `packages/contracts/src/index.ts`.

- [ ] **Step P5.2.2: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): add auth schemas (register, login, token, public user)"
```

## Task 5.3: `UsersModule` (repository + find/create)

**Files:**
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.module.ts`

No controller yet; user-list admin endpoints land in Task 5.10.

- [ ] **Step P5.3.1: Service**

```typescript
// apps/api/src/modules/users/users.service.ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import * as argon2 from "argon2";
import type { PublicUser } from "@modeldoctor/contracts";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(email: string, password: string, roles: string[] = ["user"]): Promise<PublicUser> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: { email, passwordHash, roles },
    });
    return this.toPublic(user);
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException("User not found");
    return u;
  }

  async countAll(): Promise<number> {
    return this.prisma.user.count();
  }

  async verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return argon2.verify(passwordHash, plain);
  }

  toPublic(u: { id: string; email: string; roles: string[]; createdAt: Date }): PublicUser {
    return {
      id: u.id,
      email: u.email,
      roles: u.roles,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step P5.3.2: Module**

```typescript
// apps/api/src/modules/users/users.module.ts
import { Module } from "@nestjs/common";
import { UsersService } from "./users.service.js";

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Add to `AppModule.imports`.

- [ ] **Step P5.3.3: Commit**

```bash
git add apps/api/src/modules/users apps/api/src/app.module.ts
git commit -m "feat(api): UsersService (argon2id hashing, email lookup, first-user detection)"
```

## Task 5.4: `AuthModule` + JWT + refresh tokens + cookies

**Files:**
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/jwt.strategy.ts`

- [ ] **Step P5.4.1: `AuthService`**

```typescript
// apps/api/src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import { UsersService } from "../users/users.service.js";
import type { AuthTokenResponse, PublicUser } from "@modeldoctor/contracts";
import type { Env } from "../../config/env.schema.js";

function generateRefreshToken(): string {
  // 48 bytes → 64 chars base64url — well past guessable.
  return randomBytes(48).toString("base64url");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Register a new user. First user gets admin role (unless DISABLE_FIRST_USER_ADMIN=true). */
  async register(email: string, password: string): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new UnauthorizedException("Email already registered");

    const disableFirstAdmin = this.config.get("DISABLE_FIRST_USER_ADMIN", { infer: true });
    const total = await this.users.countAll();
    const roles = !disableFirstAdmin && total === 0 ? ["admin"] : ["user"];

    const user = await this.users.create(email, password, roles);
    const { accessToken, refreshToken } = await this.issueTokens(user);
    return { user, accessToken, refreshToken };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    const row = await this.users.findByEmail(email);
    if (!row) throw new UnauthorizedException("Invalid credentials");
    const ok = await this.users.verifyPassword(row.passwordHash, password);
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    const publicUser = this.users.toPublic(row);
    const { accessToken, refreshToken } = await this.issueTokens(publicUser);
    return { user: publicUser, accessToken, refreshToken };
  }

  async refresh(presentedToken: string): Promise<{ accessToken: string; refreshToken: string; user: PublicUser }> {
    const hash = await argon2.hash(presentedToken, { type: argon2.argon2id }); // re-hash is NOT right for lookup
    // Correction: we can't hash-and-lookup the same way argon2 does — salts differ.
    // Store a SHA-256 of the token for fast equality lookup, and optionally also argon2 as a tamper-check.
    // Simpler: treat tokenHash as SHA-256(token). Fix the column semantics here.
    // SEE NOTE below — this is the known design subtlety of refresh tokens.
    throw new Error("See refresh-token design note below — update schema + service together");
  }

  private async issueTokens(user: PublicUser): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, roles: user.roles, email: user.email },
      {
        secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
        expiresIn: this.config.get("JWT_ACCESS_EXPIRES_IN", { infer: true }),
      },
    );
    const refreshToken = generateRefreshToken();
    const refreshHash = await argon2.hash(refreshToken, { type: argon2.argon2id });
    const expiresAt = new Date(Date.now() + this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }) * 86400_000);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: refreshHash, expiresAt },
    });
    return { accessToken, refreshToken };
  }

  async logout(presentedToken: string): Promise<void> {
    // Same subtlety as refresh — see note below.
  }
}
```

**Refresh-token lookup note (IMPORTANT for the executor):**
The snippet above contains an intentional `throw new Error` in `refresh()` because there's a design subtlety I (plan author) want the executor to notice and resolve deliberately rather than copy-paste wrong code.

The issue: argon2 hashes include a random salt, so `argon2.hash(token) === argon2.hash(token)` is FALSE. You can't store `argon2(token)` and later look it up by hashing the presented token again. Two common patterns:

1. **Store SHA-256 of token** (fast, lookup by equality). Downside: if DB leaks, an attacker can replay captured tokens. Mitigation: high entropy (48 bytes random) + short TTL + rotation = acceptable.
2. **Iterate candidate rows** (load all non-revoked tokens for a user-agnostic query is too expensive; load by user-id if the access JWT tells you who). Use `argon2.verify` to find match. Slow but secure even against DB leak.

**Recommendation**: use SHA-256. Update `RefreshToken.tokenHash` semantics in the Prisma schema to be SHA-256 hex (no schema change needed — column is already `String @unique`). Update `issueTokens` to `createHash("sha256").update(refreshToken).digest("hex")` instead of argon2. Update `refresh()` and `logout()` to look up by that same hash.

Implement this, THEN write the `refresh()` and `logout()` bodies per the algorithm:
- `refresh(token)`: look up by hash → if row found, not revoked, not expired → rotate (revoke old, issue new pair) → return. If row is revoked but reused → **revoke ALL refresh tokens for this user** (theft detection) and throw 401.
- `logout(token)`: look up by hash → mark revoked. Clear the cookie.

Fix the service. Write it once, carefully.

- [ ] **Step P5.4.2: `JwtStrategy`**

```typescript
// apps/api/src/modules/auth/jwt.strategy.ts
import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_ACCESS_SECRET", { infer: true }),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
```

- [ ] **Step P5.4.3: `AuthController`**

```typescript
// apps/api/src/modules/auth/auth.controller.ts
import { Body, Controller, Post, Req, Res, UsePipes, Get, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { Public } from "../../common/decorators/public.decorator.js"; // Task 5.5
import { JwtAuthGuard } from "./jwt-auth.guard.js"; // Task 5.5
import type { JwtPayload } from "./jwt.strategy.js";
import type { AuthTokenResponse } from "@modeldoctor/contracts";
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from "@modeldoctor/contracts";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";

const REFRESH_COOKIE = "md_refresh";

function setRefreshCookie(res: Response, token: string, maxAgeDays: number, isProd: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax", // lax in dev for cross-port Vite proxy
    path: "/api/auth",
    maxAge: maxAgeDays * 86400_000,
  });
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post("register")
  @UsePipes(new ZodValidationPipe(RegisterRequestSchema))
  async register(
    @Body() body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const { accessToken, refreshToken, user } = await this.auth.register(body.email, body.password);
    setRefreshCookie(
      res,
      refreshToken,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    return { accessToken, user };
  }

  @Public()
  @Post("login")
  @UsePipes(new ZodValidationPipe(LoginRequestSchema))
  async login(
    @Body() body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const { accessToken, refreshToken, user } = await this.auth.login(body.email, body.password);
    setRefreshCookie(
      res,
      refreshToken,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    return { accessToken, user };
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedException("No refresh cookie");
    const { accessToken, refreshToken, user } = await this.auth.refresh(presented);
    setRefreshCookie(
      res,
      refreshToken,
      this.config.get("JWT_REFRESH_EXPIRES_DAYS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    return { accessToken, user };
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (presented) await this.auth.logout(presented);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@Req() req: Request & { user: JwtPayload }) {
    // return PublicUser-shape; fetch from DB to ensure fresh roles
    // (Task 5.5's guard populates req.user from the JWT)
    return req.user;
  }
}
```

(`UnauthorizedException` import: add `import { UnauthorizedException } from "@nestjs/common";`)

- [ ] **Step P5.4.4: `AuthModule`**

```typescript
// apps/api/src/modules/auth/auth.module.ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtStrategy } from "./jwt.strategy.js";
import { UsersModule } from "../users/users.module.js";

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

Add to `AppModule.imports`.

- [ ] **Step P5.4.5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/app.module.ts
git commit -m "feat(api): AuthModule with JWT access + SHA-256-hashed refresh tokens + rotation"
```

## Task 5.5: `@Public()` decorator + global `JwtAuthGuard`

**Files:**
- Create: `apps/api/src/common/decorators/public.decorator.ts`
- Create: `apps/api/src/modules/auth/jwt-auth.guard.ts`
- Modify: `apps/api/src/app.module.ts` (register guard globally via `APP_GUARD`)

- [ ] **Step P5.5.1: `@Public()` decorator**

```typescript
// apps/api/src/common/decorators/public.decorator.ts
import { SetMetadata } from "@nestjs/common";
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step P5.5.2: `JwtAuthGuard`**

```typescript
// apps/api/src/modules/auth/jwt-auth.guard.ts
import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator.js";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) {
    super();
  }
  canActivate(context: ExecutionContext): ReturnType<AuthGuard["prototype"]["canActivate"]> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

- [ ] **Step P5.5.3: Register globally**

```typescript
// apps/api/src/app.module.ts — add to providers
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard.js";

// in providers:
    { provide: APP_GUARD, useClass: JwtAuthGuard },
```

- [ ] **Step P5.5.4: Whitelist Phase 0/1 endpoints that must stay public**

Add `@Public()` to:
- `HealthController.getHealth`
- `HealthController.checkVegeta` (internal diagnostic — consider if truly public; spec says public health, check-vegeta is debatable. Go public for now, tighten later.)
- Everything in `AuthController` except `me` and `logout` (already marked)

Everything else — e2e-test, load-test, debug-proxy — becomes **protected**. FE won't work unprotected after this; Task 5.6 adds FE login.

- [ ] **Step P5.5.5: Smoke**

```bash
pnpm -F @modeldoctor/api start:dev &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health       # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/load-test \
  -X POST -H "Content-Type: application/json" -d '{}'                          # 401 (guard blocks)
pkill -f "nest start"
```

- [ ] **Step P5.5.6: Commit**

```bash
git add apps/api/src/common/decorators apps/api/src/modules apps/api/src/app.module.ts
git commit -m "feat(api): global JwtAuthGuard + @Public() whitelist for health/auth endpoints"
```

## Task 5.6: `@Roles()` + `RolesGuard`

**Files:**
- Create: `apps/api/src/common/decorators/roles.decorator.ts`
- Create: `apps/api/src/common/guards/roles.guard.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step P5.6.1: Decorator**

```typescript
// apps/api/src/common/decorators/roles.decorator.ts
import { SetMetadata } from "@nestjs/common";
export const ROLES_KEY = "roles";
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step P5.6.2: Guard**

```typescript
// apps/api/src/common/guards/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator.js";

interface UserOnRequest {
  user?: { roles?: string[] };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<UserOnRequest>();
    const roles = req.user?.roles ?? [];
    if (required.some((r) => roles.includes(r))) return true;
    throw new ForbiddenException("Insufficient role");
  }
}
```

- [ ] **Step P5.6.3: Register globally** (provides after JwtAuthGuard):

```typescript
// apps/api/src/app.module.ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }, // runs after JwtAuthGuard
```

- [ ] **Step P5.6.4: Commit**

```bash
git add apps/api/src/common/decorators apps/api/src/common/guards apps/api/src/app.module.ts
git commit -m "feat(api): @Roles() + RolesGuard (admin/user RBAC)"
```

## Task 5.7: Rate limiting on auth endpoints

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step P5.7.1: Wire `ThrottlerModule` globally**

```typescript
// apps/api/src/app.module.ts
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";

// in imports:
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "default", ttl: 60_000, limit: 100 }, // 100 req / 60s per IP
      ],
    }),

// in providers, AFTER JwtAuthGuard and RolesGuard:
    { provide: APP_GUARD, useClass: ThrottlerGuard },
```

- [ ] **Step P5.7.2: Tighten login/refresh**

On `AuthController.login` and `AuthController.refresh`, apply:
```typescript
import { Throttle } from "@nestjs/throttler";

@Throttle({ default: { limit: 10, ttl: 60_000 } }) // 10 req / 60s per IP
```
(Place above the existing decorators.)

- [ ] **Step P5.7.3: Smoke**

```bash
pnpm -F @modeldoctor/api start:dev &
sleep 3
for i in {1..12}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" -d '{"email":"a@b.c","password":"wrong-password"}'
done
pkill -f "nest start"
```
Expected: first 10 respond with 401 (invalid credentials), last 2 with 429 (throttled).

- [ ] **Step P5.7.4: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/modules/auth
git commit -m "feat(api): rate-limit auth endpoints (10/60s on login/refresh, 100/60s default)"
```

## Task 5.8: Scope `GET /api/load-test/runs` by `userId` + populate on create

**Files:**
- Modify: `apps/api/src/modules/load-test/load-test.service.ts`
- Modify: `apps/api/src/modules/load-test/load-test.controller.ts`

- [ ] **Step P5.8.1: Capture the current user**

Create `apps/api/src/common/decorators/current-user.decorator.ts`:
```typescript
import { ExecutionContext, createParamDecorator } from "@nestjs/common";
import type { JwtPayload } from "../../modules/auth/jwt.strategy.js";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return req.user;
  },
);
```

- [ ] **Step P5.8.2: Wire into controller**

```typescript
// load-test.controller.ts
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";

@Post("load-test")
@UsePipes(new ZodValidationPipe(LoadTestRequestSchema))
run(
  @Body() body: LoadTestRequest,
  @CurrentUser() user: JwtPayload,
): Promise<LoadTestResponse> {
  return this.svc.run(body, user);
}

@Get("load-test/runs")
@UsePipes(new ZodValidationPipe(ListLoadTestRunsQuerySchema))
listRuns(
  @Query() query: ListLoadTestRunsQuery,
  @CurrentUser() user: JwtPayload,
): Promise<ListLoadTestRunsResponse> {
  return this.svc.listRuns(query, user);
}
```

- [ ] **Step P5.8.3: Service: persist `userId`, filter list**

`LoadTestService.run(req, user)`:
```typescript
// In the prisma.loadTestRun.create data:
userId: user.sub,
```

`LoadTestService.listRuns(query, user)`:
```typescript
const whereUser = user.roles.includes("admin") ? {} : { userId: user.sub };
const rows = await this.prisma.loadTestRun.findMany({
  where: whereUser,
  take: limit + 1,
  ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  orderBy: { createdAt: "desc" },
});
```

- [ ] **Step P5.8.4: Commit**

```bash
git add apps/api/src/common/decorators apps/api/src/modules/load-test
git commit -m "feat(api): scope load-test runs by userId (admins see all)"
```

## Task 5.9: Auth e2e tests

**Files:**
- Create: `apps/api/test/e2e/auth.e2e-spec.ts`
- Create: `apps/api/test/e2e/auth-flow.e2e-spec.ts`

Use the `startPostgres` helper from Task 4.5. Cover:
1. register → 200, access token + refresh cookie issued, user returned with role=admin (first user)
2. register second user → role=user
3. login with wrong password → 401
4. login with correct password → 200 + token
5. GET /api/auth/me with bearer → 200 + PublicUser
6. GET /api/auth/me without bearer → 401
7. POST /api/auth/refresh without cookie → 401
8. POST /api/auth/refresh with valid cookie → 200 + new token + new cookie
9. POST /api/auth/refresh with REVOKED cookie → 401 + theft detection (logs warn, revokes all tokens for user) — verify second refresh after "theft" is also 401
10. GET /api/load-test/runs with admin token → returns all runs
11. GET /api/load-test/runs with user token → returns only own runs
12. Rate limit on login after 11 attempts → 429

- [ ] **Step P5.9.1: Write tests** — refer to debug-proxy e2e style for setup boilerplate.

- [ ] **Step P5.9.2: Run**

```bash
pnpm -F @modeldoctor/api test:e2e
```

- [ ] **Step P5.9.3: Commit**

```bash
git add apps/api/test/e2e
git commit -m "test(api): e2e auth flow (register/login/refresh rotation/theft detection/RBAC)"
```

## Task 5.10: FE login + register + protected routes + auto-refresh

**Files:**
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/RegisterPage.tsx`
- Create: `apps/web/src/stores/auth-store.ts`
- Modify: `apps/web/src/lib/api-client.ts` (attach token, auto-refresh on 401)
- Modify: `apps/web/src/router/index.tsx` (add `/login`, `/register`, ProtectedRoute wrapper)
- Modify: `apps/web/src/components/sidebar/Sidebar.tsx` (add user menu / logout)

- [ ] **Step P5.10.1: Auth store (Zustand, in-memory only for access token)**

```typescript
// apps/web/src/stores/auth-store.ts
import { create } from "zustand";
import type { PublicUser } from "@modeldoctor/contracts";

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setAuth: (accessToken: string, user: PublicUser) => void;
  clear: () => void;
}

// NOTE: access token is NEVER persisted. Refresh cookie (HttpOnly) handles persistence.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clear: () => set({ accessToken: null, user: null }),
}));
```

- [ ] **Step P5.10.2: `api-client.ts` with auto-refresh**

```typescript
// apps/web/src/lib/api-client.ts
import { StandardErrorResponseSchema } from "@modeldoctor/contracts";
import { useAuthStore } from "../stores/auth-store.js";

// ... ApiError class ...

async function rawFetch(path: string, init?: RequestInit, overrideToken?: string): Promise<Response> {
  const token = overrideToken ?? useAuthStore.getState().accessToken;
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, {
    ...init,
    headers,
    credentials: "include", // for the refresh cookie
  });
}

async function tryRefresh(): Promise<string | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
  if (!res.ok) return null;
  const body = await res.json();
  useAuthStore.getState().setAuth(body.accessToken, body.user);
  return body.accessToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const newToken = await tryRefresh();
    if (newToken) {
      res = await rawFetch(path, init, newToken);
    } else {
      useAuthStore.getState().clear();
      window.location.href = "/login";
      throw new ApiError(401, "Unauthorized");
    }
  }
  // ... (rest of the existing body-parsing + error-envelope code) ...
}
```

- [ ] **Step P5.10.3: Pages**

Write `LoginPage.tsx` and `RegisterPage.tsx` using shadcn `Card` + react-hook-form + zod resolver pattern (mirror existing ConnectionDialog). On submit, POST to `/api/auth/login` or `/api/auth/register`, on success `useAuthStore.setState({ accessToken, user })` and `navigate("/load-test")`. On error, render the server message.

- [ ] **Step P5.10.4: Router**

Add routes:
```tsx
{ path: "/login", element: <LoginPage /> },
{ path: "/register", element: <RegisterPage /> },
```
Wrap the `AppShell` layout route with a `ProtectedRoute` component that checks `useAuthStore(s => s.accessToken)` and redirects to `/login` if null.

- [ ] **Step P5.10.5: Sidebar — user menu**

Add the current user's email + a Logout button (POST `/api/auth/logout`, then `useAuthStore.clear()` + redirect).

- [ ] **Step P5.10.6: FE tests**

Add Vitest + Testing Library tests for LoginPage, RegisterPage, ProtectedRoute, auth-store. Same pattern as existing `ConnectionDialog.test.tsx`.

- [ ] **Step P5.10.7: Manual smoke**

```bash
docker compose up -d postgres
pnpm dev
```
- Hit http://localhost:5173 → redirect to /login
- Register → auto-logged-in → sidebar shows email
- Run a Load Test → persists under your user
- Logout → back to /login
- Register second user → shown; their History only shows their own runs

- [ ] **Step P5.10.8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): login/register pages + auth store + protected routes + auto-refresh"
```

## Phase 5 DoD

- [ ] All endpoints except health and auth/(register|login|refresh) return 401 when called without a bearer.
- [ ] Register flow: first user is admin (or operator-disabled), second+ are users.
- [ ] Login + refresh cookie lifecycle works end-to-end.
- [ ] Refresh token rotation: reusing a revoked token → 401 + all user's tokens revoked.
- [ ] 11th login attempt from same IP in 60s → 429.
- [ ] `GET /api/load-test/runs` scoped per user; admin sees all.
- [ ] FE `/login` and `/register` pages; unauthenticated deep-link redirects to /login.
- [ ] `pnpm -r type-check`, `pnpm -r test`, `pnpm test:e2e` all green.

## Phase 5 PR

Same flow. Merge. Proceed to Phase 6.

---

# Phase 6 — Productionization (Docker + CI + Terminus)

**Phase goal:** single-command containerized deploy. CI pipeline on every PR. Health endpoint extended with DB probe so orchestrators (k8s, ECS) can hold traffic during outages.

**Estimated effort:** ~1–2 days.

## Phase 6 Pre-flight

- [ ] Worktree `feat/nestjs-phase-6` from main (Phase 5 merged).
- [ ] `pnpm -r type-check && pnpm -r test && pnpm test:e2e` green (DB+auth all wired).
- [ ] `docker --version` works.

## Task 6.1: Multi-stage `Dockerfile`

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)

- [ ] **Step P6.1.1: `.dockerignore`**

```
node_modules
**/node_modules
**/dist
**/.turbo
**/.next
.git
.github
.vscode
tmp
*.log
.env
.env.local
.DS_Store
docs
ai-docs
```

- [ ] **Step P6.1.2: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ---------- Stage 1: install all deps ----------
FROM node:20-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json ./packages/contracts/

RUN pnpm install --frozen-lockfile

# ---------- Stage 2: build ----------
FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY . .

# Generate Prisma client + build everything
RUN pnpm -F @modeldoctor/api exec prisma generate
RUN pnpm build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    addgroup -S app && adduser -S app -G app

# Copy lean runtime tree
COPY --from=build /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml ./
COPY --from=build /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/web/package.json ./apps/web/
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist

# Install only production deps
RUN pnpm install --prod --frozen-lockfile

USER app
EXPOSE 3001

# Run migrations then start the API.
CMD ["sh", "-c", "pnpm -F @modeldoctor/api exec prisma migrate deploy && node apps/api/dist/main.js"]
```

- [ ] **Step P6.1.3: Smoke**

```bash
docker build -t modeldoctor:local .
docker run --rm \
  -e DATABASE_URL=postgresql://modeldoctor:modeldoctor@host.docker.internal:5432/modeldoctor \
  -e JWT_ACCESS_SECRET=$(openssl rand -base64 48) \
  -e CORS_ORIGINS=http://localhost:3001 \
  -p 3001:3001 modeldoctor:local &
sleep 5
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/ -o /dev/null -w "web: %{http_code}\n"
docker ps
# Kill:
docker ps -q --filter ancestor=modeldoctor:local | xargs docker stop
```

- [ ] **Step P6.1.4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile (deps → build → runtime, 20-alpine)"
```

## Task 6.2: Terminus health with DB probe

**Files:**
- Modify: `apps/api/package.json` (add dep)
- Modify: `apps/api/src/modules/health/health.module.ts`
- Modify: `apps/api/src/modules/health/health.controller.ts`
- Modify: `packages/contracts/src/health.ts` (relax HealthResponseSchema to accept terminus's shape)

- [ ] **Step P6.2.1: Install**

```bash
pnpm -F @modeldoctor/api add @nestjs/terminus
```

- [ ] **Step P6.2.2: Rewrite controller to use Terminus**

```typescript
// apps/api/src/modules/health/health.controller.ts
import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator.js";
import { PrismaService } from "../../database/prisma.service.js";
import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaProbe: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly legacy: HealthService,
  ) {}

  @Public()
  @Get("health")
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaProbe.pingCheck("database", this.prisma, { timeout: 500 }),
    ]);
  }

  @Public()
  @Get("check-vegeta")
  checkVegeta() {
    return this.legacy.checkVegeta();
  }
}
```

Update `health.module.ts` imports to include `TerminusModule`.

Update `HealthResponseSchema` in contracts — terminus responds with `{status:"ok",info:{database:{status:"up"}},error:{},details:{...}}`. Widen the schema:

```typescript
export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error", "shutting_down"]),
  info: z.record(z.object({ status: z.string() })).optional(),
  error: z.record(z.object({ status: z.string(), message: z.string().optional() })).optional(),
  details: z.record(z.object({ status: z.string() })).optional(),
});
```

- [ ] **Step P6.2.3: Smoke**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://... pnpm -F @modeldoctor/api start:dev &
sleep 3
curl -s http://localhost:3001/api/health | jq .
# → {"status":"ok","info":{"database":{"status":"up"}},...}
docker compose stop postgres
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health
# → 503
docker compose start postgres
pkill -f "nest start"
```

- [ ] **Step P6.2.4: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/health packages/contracts/src/health.ts pnpm-lock.yaml
git commit -m "feat(api): @nestjs/terminus /api/health with DB liveness probe"
```

## Task 6.3: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step P6.3.1: Write CI**

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-type-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: modeldoctor
          POSTGRES_PASSWORD: modeldoctor
          POSTGRES_DB: modeldoctor_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor_test
      JWT_ACCESS_SECRET: test-secret-with-at-least-32-characters-long-xyz
      CORS_ORIGINS: http://localhost:5173
      LOG_LEVEL: warn
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -F @modeldoctor/api exec prisma generate
      - run: pnpm -F @modeldoctor/api exec prisma migrate deploy
      - run: pnpm -r type-check
      - run: pnpm lint
      - run: pnpm -r test
      - run: pnpm -F @modeldoctor/api test:e2e
      - run: pnpm build

  docker-build:
    runs-on: ubuntu-latest
    needs: lint-type-test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push)
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: modeldoctor:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step P6.3.2: Verify locally**

This is hard to verify without pushing. A shortcut:
```bash
pnpm install --frozen-lockfile && pnpm -F @modeldoctor/api exec prisma generate && pnpm -r type-check && pnpm lint && pnpm -r test && pnpm build
```
If all green, CI likely will be too.

- [ ] **Step P6.3.3: Commit**

```bash
git add .github
git commit -m "ci: GitHub Actions (type-check, lint, test, e2e w/ postgres service, docker build)"
```

## Task 6.4: README deploy section + `.env.example` final pass

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step P6.4.1: README**

Append to README:
```markdown
## Deploy

Single-container deploy:

\`\`\`bash
docker build -t modeldoctor .
docker run -d \\
  -e DATABASE_URL=postgresql://user:pass@host:5432/modeldoctor \\
  -e JWT_ACCESS_SECRET=$(openssl rand -base64 48) \\
  -e CORS_ORIGINS=https://your.domain \\
  -e NODE_ENV=production \\
  -p 3001:3001 \\
  --name modeldoctor modeldoctor
\`\`\`

The container runs \`prisma migrate deploy\` on boot, then serves:
- \`/api/*\` from NestJS
- everything else from the Vite-built \`apps/web/dist\` (SPA)

Health check: \`GET /api/health\` returns 200 if DB is reachable, 503 otherwise.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| \`NODE_ENV\` | No | \`development\` | Logging format, CORS strictness, cookie flags |
| \`PORT\` | No | \`3001\` | API listener |
| \`LOG_LEVEL\` | No | \`info\` | pino level |
| \`CORS_ORIGINS\` | No | \`http://localhost:5173\` | Comma-separated allowlist |
| \`DATABASE_URL\` | **Yes** | — | Postgres connection string |
| \`JWT_ACCESS_SECRET\` | **Yes** | — | Min 32 chars; rotate by restart |
| \`JWT_ACCESS_EXPIRES_IN\` | No | \`15m\` | pino-style duration |
| \`JWT_REFRESH_EXPIRES_DAYS\` | No | \`7\` | Refresh-token TTL |
| \`DISABLE_FIRST_USER_ADMIN\` | No | \`false\` | If \`true\`, first user is NOT auto-promoted to admin |
```

- [ ] **Step P6.4.2: Commit**

```bash
git add README.md .env.example
git commit -m "docs: deploy section + env variable reference"
```

## Phase 6 DoD

- [ ] `docker build -t modeldoctor .` succeeds on a fresh clone.
- [ ] `docker run ...` with DB/secret env boots; `/api/health` returns 200 with DB up, 503 with DB down.
- [ ] CI green on a fresh PR (lint, type-check, test, e2e with Postgres service, docker build).
- [ ] README documents deploy + all env vars.

## Phase 6 PR

`feat/nestjs-phase-6 → main`. Merge.

---

# Project-Wide DoD (after Phase 6 merges)

At this point the NestJS refactor is complete. Cross-check against spec §7:

- [ ] `pnpm install && pnpm dev` works on a clean clone (dev loop)
- [ ] `docker build . && docker run -p 3001:3001 --env-file .env ...` produces a single-container deployment
- [ ] All Phase 0/1 FE features work (Load Test, E2E Smoke, Request Debug, Connections, Settings) against Nest
- [ ] Login gate enforced
- [ ] CI green on main
- [ ] README has dev + prod + env + auth sections
- [ ] `pnpm -r type-check` covers web/api/contracts
- [ ] `grep -R "require(" apps/api/src packages/contracts/src` returns nothing
- [ ] OWASP ASVS L2 auth checklist reviewed; any gaps logged as debt for a follow-up spec

---

## Pre-existing debt to resolve in a future phase (not addressed here)

- Vitest version split (web@1 vs api@2) — unify when either side next upgrades.
- `apps/web/tsconfig.tsbuildinfo` + `tsconfig.node.tsbuildinfo` still tracked in git (Task 13 in Phase 0 added them to `.gitignore` but didn't `git rm --cached`). Untrack in a cleanup PR.
- OpenTelemetry / distributed tracing — not yet. First-step observability is the structured pino logs + `requestId`. Traces join when a need is explicit.
- Async task queue for long-running load tests (BullMQ + Redis). Will ship when the "long-running test + status polling" UX is needed.
- WebSocket / SSE for streaming TTFT tab. Arrives with that feature.

---

**End of Phases 2/4/5/6 combined plan.**
