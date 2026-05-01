# Benchmark Feature — Phase 3 Implementation Plan (Drivers + Callbacks + CRUD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the API side of the benchmark feature end-to-end. After this PR merges, a JWT-authenticated user can `POST /api/benchmarks` with a profile + endpoint + dataset config, the API encrypts the supplied API key, launches a runner via either the K8s Job driver or the local subprocess driver (selected by `BENCHMARK_DRIVER`), receives HMAC-authenticated lifecycle and metrics callbacks from that runner, and lists / fetches / cancels / deletes runs. A 30-second cron sweeps stuck runs as a safety net. No UI yet (Phase 5).

**Architecture:** Single PR from `feat/benchmark-phase-3` cut from `feat/restructure`. Per the 2026-04-26 brainstorm, Phase 3 + Phase 4 of the original spec phase decomposition are merged here. New module `apps/api/src/modules/benchmark/` holds the user-facing CRUD controller, the internal HMAC-authenticated callback controller, the service that owns the state machine, the cron-driven reconciler, two driver implementations selected via a factory provider, and pure-function manifest builders. K8s integration is via `@kubernetes/client-node`; cron is via `@nestjs/schedule`. K8s RBAC YAML lands at `deploy/k8s/rbac.yaml` (new top-level directory).

**Tech Stack:** NestJS 10, Prisma 6, Zod 3.23, `@kubernetes/client-node` (new), `@nestjs/schedule` (new), Vitest 2, supertest (already a devDep via `@nestjs/testing` ecosystem; if not present, `pnpm -F @modeldoctor/api add -D supertest @types/supertest`). Node 20+, pnpm 9+.

**Source spec:** `docs/superpowers/specs/2026-04-25-benchmark-design.md` — §2 (architecture + trust boundaries), §3 (domain model — already migrated in Phase 1), §4 (API surface), §6 (security), §7 (state machine + reconciler), §10 Phase 3+4 (scope), §11 (open risks), §13 (workflows).

## Phase 3 implementation decisions (from 2026-04-26 brainstorm)

These augment the spec with concrete implementation-level choices made during brainstorming. The plan below realizes them.

1. **Phase 3 + Phase 4 merged into one PR.** User-facing CRUD ships with the drivers and callback. No stub controller, no separate phase boundary.
2. **K8sJobDriver verification = mock-only unit tests + manual k3d acceptance.** No CI kind/k3d cluster spin-up. README documents the k3d steps for the dev who wants a full smoke test before merge.
3. **State machine semantics:** forward-only state transitions; `metricsSummary` / `rawMetrics` / `logs` always written even after terminal (forensic value); duplicate `state=running` callbacks return 200 silent; cancel of `pending` doesn't call driver; cancel of terminal returns 400; callback for missing run returns 200 silent + warn (don't make the runner retry).
4. **SubprocessDriver lifecycle:** `child_process.spawn` attached to API process; in-memory `Map<handle, ChildProcess>`; no PID persistence. API restart kills the subprocess; the orphaned `running` row is reaped by the reconciler's `running > maxDuration → failed` path. Reconciler branches by driver type — only the runaway-timeout check applies in subprocess mode.
5. **Reconciler cron:** `*/30 * * * * *` (every 30s), short-circuit early when `NODE_ENV === 'test'` (vitest must not start a real timer). Skip rows whose `createdAt` is within the last 5 seconds (avoid racing the create path).
6. **K8s secret strategy:** per-run `Secret` named `benchmark-<id>`, `stringData = { API_KEY, CALLBACK_TOKEN }`, created **before** the Job; container picks them up via `envFrom.secretRef`; Job's UID is patched into the Secret's `ownerReferences` so K8s GCs the Secret when the Job is deleted (TTL or cancel). On Job-create failure, the Secret is deleted explicitly to avoid orphans.
7. **Env vars added in this PR:** `BENCHMARK_DRIVER` (default `subprocess`), `BENCHMARK_CALLBACK_URL` (required when `driver=k8s` or `NODE_ENV !== 'test'`), `BENCHMARK_K8S_NAMESPACE` (default `modeldoctor-benchmarks`), `BENCHMARK_RUNNER_IMAGE` (required when `driver=k8s`), `BENCHMARK_DEFAULT_MAX_DURATION_SECONDS` (default `1800`). Resource limits (`cpu/memory request/limit`) are **not** env-tunable — hard-coded in the manifest builder. `CONNECTION_API_KEY_ENCRYPTION_KEY` and `BENCHMARK_CALLBACK_SECRET` are tightened from `optional` to `required when NODE_ENV !== 'test'`.
8. **Driver injection = factory provider with dynamic import.** `@kubernetes/client-node` (~30 MB) is loaded only when `driver=k8s`. Subprocess-only dev sessions don't pay the import cost.

## Testing discipline

- **TDD for code modules.** Pure functions (HMAC sign/verify, manifest builders) and stateful classes (drivers, service, guard, reconciler) all go through the failing-test → minimal-impl → passing-test → commit cycle. Each task in this plan calls out the failing-test step explicitly before the implementation step.
- **Mocks at boundaries.** Service tests mock Prisma + the driver token. Driver tests mock `@kubernetes/client-node` (k8s) or `child_process.spawn` (subprocess). Controller tests use NestJS's `Test.createTestingModule` + `supertest`. Reconciler tests instantiate the class directly with mock dependencies — they do **not** spin up `ScheduleModule`.
- **Don't unit-test the wiring.** `BenchmarkModule` and `AppModule` integration are verified by `pnpm -F @modeldoctor/api type-check` and the existing `app.module.spec.ts` smoke test (Nest's compile pass). Manual k3d / subprocess acceptance steps in the README cover end-to-end.
- **Golden-path tests use round-tripped fixtures.** For the K8s manifest builder, snapshot the constructed `V1Job` / `V1Secret` against an in-test expected object — this catches accidental field churn during refactors.

## Commit cadence

One commit per task (~21 commits). Conventional-commit prefixes per `CLAUDE.md`:

- `feat:` — runtime code (new modules, schemas, drivers, controllers)
- `test:` — test-only changes (rare; tests usually land *with* their impl)
- `build:` — npm dependency changes
- `chore:` — RBAC YAML, .env.example
- `docs:` — README updates

Every commit body ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

## Environment assumptions

- Working directory: the current ModelDoctor repo root. Phase 1 + Phase 2 have merged into `feat/restructure` (see `git log` — most recent benchmark-related commits are on that branch).
- Node ≥ 20, pnpm ≥ 9.
- Local Postgres is **brew-managed** (per project memory): `brew services list` shows `postgresql@<v>` started; `pg_isready -h localhost -p 5432` returns OK. Without it, `db:migrate:dev` and the integration test path hang.
- For the optional subprocess acceptance step at the end: a conda env with `benchmark-runner` (= the gpustack CLI from Phase 2's image) on `PATH`. Per project memory, **conda only — no `python -m venv`**.
- For the optional k3d acceptance step: `k3d` (or `kind`) installed via brew, Docker Desktop running.

---

## Pre-flight

- [ ] **Step 0.1: Confirm a clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`. If dirty, commit or stash before proceeding.

- [ ] **Step 0.2: Sync the integration branch**

```bash
git checkout feat/restructure
git pull --ff-only
```
Expected: fast-forward to the merge commits of PRs #11 + #12 + #13 (most recent: `3a8977e docs(benchmark-runner): add ruff format --check to local-dev recipe`). If `pull --ff-only` refuses, your local has diverged — investigate before proceeding.

- [ ] **Step 0.3: Confirm baseline tests pass**

```bash
pnpm -r type-check
pnpm -r test
pnpm -r lint
```
Expected: all green. Phase 1 + 2 contributions must still pass on the integration branch — any new failure introduced by this plan must be clearly attributable to the new code, not a pre-existing red.

- [ ] **Step 0.4: Confirm the dev DB is reachable**

```bash
brew services list | grep postgres
pg_isready -h localhost -p 5432
```
Expected: a `postgresql@<version>` row with status `started`, and `pg_isready` returns `localhost:5432 - accepting connections`. If Postgres is stopped, start it with `brew services start postgresql@<version>` (use the version listed) and retry. **Do not** reference `docker compose ... postgres` — Postgres in this repo is brew-managed.

- [ ] **Step 0.5: Generate Phase 3 secrets in `.env`**

This phase tightens `CONNECTION_API_KEY_ENCRYPTION_KEY` and `BENCHMARK_CALLBACK_SECRET` from `optional` to required-when-not-test. Generate them now so Step 0.6's `pnpm dev` would still start cleanly later.

```bash
echo "CONNECTION_API_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> apps/api/.env
echo "BENCHMARK_CALLBACK_SECRET=$(openssl rand -base64 48)" >> apps/api/.env
echo "BENCHMARK_CALLBACK_URL=http://localhost:3001" >> apps/api/.env
```
Expected: three new lines appended to `apps/api/.env`. Verify with `tail -3 apps/api/.env`. (If your repo uses a different env file location, mirror it there. The .env file is in .gitignore, so this won't accidentally commit.)

- [ ] **Step 0.6: Create the Phase 3 branch**

```bash
git checkout -b feat/benchmark-phase-3
```
Expected: `Switched to a new branch 'feat/benchmark-phase-3'`. PR target is `feat/restructure`.

---

## Phase 3 Tasks

Phase goal (restated): the API can create benchmark runs that launch a runner Job (k8s) or subprocess (dev), receive HMAC-authenticated lifecycle + metrics callbacks, expose CRUD over `/api/benchmarks`, and self-heal stuck runs via a 30s reconciler. Tests are green; type-check + lint clean. RBAC YAML is in `deploy/k8s/rbac.yaml`. Manual k3d / subprocess smoke instructions are in the README.

---

### Task 1: Add `@nestjs/schedule` and `@kubernetes/client-node` dependencies

**Files:**
- Modify: `apps/api/package.json`
- Touch (auto): `pnpm-lock.yaml`

This is a pure dependency-add. Verification is `pnpm install` succeeding and `pnpm -F @modeldoctor/api type-check` still green.

- [ ] **Step 1.1: Add the dependencies**

```bash
pnpm -F @modeldoctor/api add @nestjs/schedule@^4 @kubernetes/client-node@^0.21
```
Expected: both packages added to `apps/api/package.json` `dependencies` and locked into `pnpm-lock.yaml`. `@nestjs/schedule@^4` is the version compatible with `@nestjs/common@^10`; `@kubernetes/client-node@^0.21` ships TypeScript types, supports K8s ≥1.27, and is the current stable line.

- [ ] **Step 1.2: Verify install + type-check**

```bash
pnpm -F @modeldoctor/api type-check
```
Expected: green. The deps must compile cleanly against the existing `tsconfig.json` (CommonJS-friendly types).

- [ ] **Step 1.3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
build(api): add @nestjs/schedule and @kubernetes/client-node

Phase 3 needs both: schedule for the BenchmarkReconciler cron, k8s client
for the K8sJobDriver. @kubernetes/client-node is loaded via dynamic import
in the driver factory so subprocess-only dev sessions don't pay the
~30 MB module load cost.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add Phase 3 error codes to contracts

**Files:**
- Modify: `packages/contracts/src/errors.ts`
- Modify (or create): `packages/contracts/src/errors.spec.ts`

The Phase 3 service raises four new error codes (`BENCHMARK_DATASET_UNSUPPORTED`, `BENCHMARK_NAME_IN_USE`, `BENCHMARK_ALREADY_TERMINAL`, `BENCHMARK_NOT_TERMINAL`). They live in the shared `ErrorCodes` const so the web UI in Phase 5 can map them to messages.

- [ ] **Step 2.1: Write the failing test**

Open or create `packages/contracts/src/errors.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ErrorCodes } from "./errors.js";

describe("ErrorCodes", () => {
  it("includes the 8 Phase-1/2 baseline codes", () => {
    expect(ErrorCodes.VALIDATION_FAILED).toBe("VALIDATION_FAILED");
    expect(ErrorCodes.BAD_REQUEST).toBe("BAD_REQUEST");
    expect(ErrorCodes.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(ErrorCodes.FORBIDDEN).toBe("FORBIDDEN");
    expect(ErrorCodes.NOT_FOUND).toBe("NOT_FOUND");
    expect(ErrorCodes.CONFLICT).toBe("CONFLICT");
    expect(ErrorCodes.TOO_MANY_REQUESTS).toBe("TOO_MANY_REQUESTS");
    expect(ErrorCodes.INTERNAL_SERVER_ERROR).toBe("INTERNAL_SERVER_ERROR");
  });

  it("includes the Phase 3 benchmark codes", () => {
    expect(ErrorCodes.BENCHMARK_DATASET_UNSUPPORTED).toBe("BENCHMARK_DATASET_UNSUPPORTED");
    expect(ErrorCodes.BENCHMARK_NAME_IN_USE).toBe("BENCHMARK_NAME_IN_USE");
    expect(ErrorCodes.BENCHMARK_ALREADY_TERMINAL).toBe("BENCHMARK_ALREADY_TERMINAL");
    expect(ErrorCodes.BENCHMARK_NOT_TERMINAL).toBe("BENCHMARK_NOT_TERMINAL");
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/contracts test -- errors.spec
```
Expected: FAIL — the new codes don't exist on `ErrorCodes` yet (the second `it` block reports `undefined` for each).

- [ ] **Step 2.3: Add the codes to `errors.ts`**

Edit `packages/contracts/src/errors.ts` — append four entries to the `ErrorCodes` object (preserving the append-only invariant):

```ts
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
  // Phase 3 (benchmark)
  BENCHMARK_DATASET_UNSUPPORTED: "BENCHMARK_DATASET_UNSUPPORTED",
  BENCHMARK_NAME_IN_USE: "BENCHMARK_NAME_IN_USE",
  BENCHMARK_ALREADY_TERMINAL: "BENCHMARK_ALREADY_TERMINAL",
  BENCHMARK_NOT_TERMINAL: "BENCHMARK_NOT_TERMINAL",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

- [ ] **Step 2.4: Run tests + type-check**

```bash
pnpm -F @modeldoctor/contracts test
pnpm -F @modeldoctor/contracts type-check
```
Expected: green. The new keys are picked up by the `(typeof ErrorCodes)[keyof typeof ErrorCodes]` derivation, so `ErrorCode` widens automatically.

- [ ] **Step 2.5: Commit**

```bash
git add packages/contracts/src/errors.ts packages/contracts/src/errors.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add benchmark Phase 3 error codes

BENCHMARK_DATASET_UNSUPPORTED — sharegpt rejected (Phase 6 backfill).
BENCHMARK_NAME_IN_USE — duplicate active name within a user.
BENCHMARK_ALREADY_TERMINAL — cancel against a terminal run.
BENCHMARK_NOT_TERMINAL — delete against a non-terminal run.

Append-only — existing codes untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: HMAC callback token sign / verify

**Files:**
- Create: `apps/api/src/modules/benchmark/callbacks/hmac-token.ts`
- Create: `apps/api/src/modules/benchmark/callbacks/hmac-token.spec.ts`

Pure functions — no NestJS DI. The signer is called from `BenchmarkService.start` to embed the token in the runner env. The verifier is called from `HmacCallbackGuard` to authenticate inbound callbacks. Token format: `<exp>.<sig>` where `sig = HMAC_SHA256(secret, "<benchmarkId>.<exp>")` per spec §2.2.

- [ ] **Step 3.1: Create the directory + write the failing test**

```bash
mkdir -p apps/api/src/modules/benchmark/callbacks
```

Create `apps/api/src/modules/benchmark/callbacks/hmac-token.spec.ts`:

```ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signCallbackToken, verifyCallbackToken } from "./hmac-token.js";

describe("hmac-token", () => {
  const secret = randomBytes(32);
  const id = "ckxxxxxxxxxxxxxxxxxxxxxxx";
  const NOW = 1_700_000_000;

  describe("signCallbackToken", () => {
    it("emits <exp>.<hex-sig> with exp = nowSeconds + ttlSeconds", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [expStr, sig] = tok.split(".");
      expect(parseInt(expStr, 10)).toBe(NOW + 60);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces stable output for stable inputs", () => {
      const a = signCallbackToken(id, secret, 60, NOW);
      const b = signCallbackToken(id, secret, 60, NOW);
      expect(a).toBe(b);
    });
  });

  describe("verifyCallbackToken", () => {
    it("accepts a freshly signed token", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 30)).toBe(true);
    });

    it("rejects expired tokens (now > exp)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 61)).toBe(false);
    });

    it("rejects tokens signed for a different id", () => {
      const tok = signCallbackToken("other-id", secret, 60, NOW);
      expect(verifyCallbackToken(id, tok, secret, NOW + 30)).toBe(false);
    });

    it("rejects tokens signed with a different secret", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const other = randomBytes(32);
      expect(verifyCallbackToken(id, tok, other, NOW + 30)).toBe(false);
    });

    it("rejects malformed tokens (no dot)", () => {
      expect(verifyCallbackToken(id, "abcdef", secret, NOW)).toBe(false);
    });

    it("rejects tokens with extra dots", () => {
      expect(verifyCallbackToken(id, "1.2.3", secret, NOW)).toBe(false);
    });

    it("rejects tokens whose exp is non-numeric", () => {
      expect(verifyCallbackToken(id, "abc.deadbeef", secret, NOW)).toBe(false);
    });

    it("rejects tokens whose sig hex differs by one bit (constant-time compare)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [exp, sig] = tok.split(".");
      const tampered = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
      expect(verifyCallbackToken(id, tampered, secret, NOW + 30)).toBe(false);
    });

    it("rejects tokens whose sig is shorter than expected (length mismatch)", () => {
      const tok = signCallbackToken(id, secret, 60, NOW);
      const [exp, sig] = tok.split(".");
      const truncated = `${exp}.${sig.slice(0, -2)}`;
      expect(verifyCallbackToken(id, truncated, secret, NOW + 30)).toBe(false);
    });
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- hmac-token
```
Expected: FAIL — module `./hmac-token.js` cannot be resolved.

- [ ] **Step 3.3: Implement `hmac-token.ts`**

Create `apps/api/src/modules/benchmark/callbacks/hmac-token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs an HMAC callback token used by runner pods to authenticate against
 * `/api/internal/benchmarks/:id/{state,metrics}`. Format: "<exp>.<hex-sig>"
 * where `sig = HMAC_SHA256(secret, "<id>.<exp>")`. The id is *not* embedded
 * in the token — the verifier reads it from the URL path and reconstructs
 * the message, which prevents cross-id replay.
 */
export function signCallbackToken(
  id: string,
  secret: Buffer,
  ttlSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyCallbackToken(
  id: string,
  token: string,
  secret: Buffer,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expStr, sigHex] = parts;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || String(exp) !== expStr) return false;
  if (nowSeconds > exp) return false;
  const expectedHex = createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex");
  if (sigHex.length !== expectedHex.length) return false;
  return timingSafeEqual(Buffer.from(sigHex, "utf8"), Buffer.from(expectedHex, "utf8"));
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- hmac-token
```
Expected: 11 specs green.

- [ ] **Step 3.5: Lint + type-check**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
```
Expected: green.

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/modules/benchmark/callbacks/hmac-token.ts \
        apps/api/src/modules/benchmark/callbacks/hmac-token.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): HMAC callback token sign + verify

Token format <exp>.<hex-sig>; id is read from the URL path on verify,
not embedded in the token, which prevents cross-id replay.
timingSafeEqual gives constant-time comparison; length mismatch
short-circuits to avoid the throw it would otherwise raise.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: HmacCallbackGuard

**Files:**
- Create: `apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.ts`
- Create: `apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.spec.ts`

Bridges the pure verifier to NestJS. Reads `Authorization: Bearer <token>` and the `:id` route param off the request, calls `verifyCallbackToken`, throws `UnauthorizedException` on failure. The secret is resolved from `ConfigService` at construction time so a misconfigured deployment fails loud at boot.

- [ ] **Step 4.1: Write the failing test**

Create `apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.spec.ts`:

```ts
import { randomBytes } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";
import { signCallbackToken } from "./hmac-token.js";

const secret = randomBytes(32);

function buildConfig(value: string | undefined = secret.toString("utf8")): ConfigService {
  return {
    get: (key: string) => (key === "BENCHMARK_CALLBACK_SECRET" ? value : undefined),
  } as unknown as ConfigService;
}

function ctx(headers: Record<string, string>, params: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, params }) }),
  } as unknown as ExecutionContext;
}

describe("HmacCallbackGuard", () => {
  it("accepts a valid token", () => {
    const id = "run-123";
    const token = signCallbackToken(id, secret, 600);
    const guard = new HmacCallbackGuard(buildConfig());
    expect(guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id }))).toBe(true);
  });

  it("rejects when Authorization header is missing", () => {
    const guard = new HmacCallbackGuard(buildConfig());
    expect(() => guard.canActivate(ctx({}, { id: "run-123" }))).toThrow(UnauthorizedException);
  });

  it("rejects when scheme is not Bearer", () => {
    const guard = new HmacCallbackGuard(buildConfig());
    expect(() =>
      guard.canActivate(ctx({ authorization: "Basic abc" }, { id: "run-123" })),
    ).toThrow(UnauthorizedException);
  });

  it("rejects when :id route param is missing", () => {
    const id = "run-123";
    const token = signCallbackToken(id, secret, 600);
    const guard = new HmacCallbackGuard(buildConfig());
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${token}` }, {}))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an expired token", () => {
    const id = "run-123";
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = signCallbackToken(id, secret, -1, past);
    const guard = new HmacCallbackGuard(buildConfig());
    expect(() => guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id }))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects a token signed for a different id", () => {
    const token = signCallbackToken("other", secret, 600);
    const guard = new HmacCallbackGuard(buildConfig());
    expect(() =>
      guard.canActivate(ctx({ authorization: `Bearer ${token}` }, { id: "run-123" })),
    ).toThrow(UnauthorizedException);
  });

  it("throws fail-loud at construction if the secret is missing", () => {
    expect(() => new HmacCallbackGuard(buildConfig(undefined))).toThrow(
      /BENCHMARK_CALLBACK_SECRET/,
    );
  });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- hmac-callback.guard
```
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `hmac-callback.guard.ts`**

```ts
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import { verifyCallbackToken } from "./hmac-token.js";

interface CallbackRequest {
  headers: { authorization?: string };
  params: { id?: string };
}

@Injectable()
export class HmacCallbackGuard implements CanActivate {
  private readonly secret: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const raw = config.get("BENCHMARK_CALLBACK_SECRET", { infer: true });
    if (!raw) {
      throw new Error(
        "HmacCallbackGuard: BENCHMARK_CALLBACK_SECRET is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.secret = Buffer.from(raw, "utf8");
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<CallbackRequest>();
    const authz = req.headers.authorization;
    if (!authz?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or non-Bearer Authorization");
    }
    const id = req.params.id;
    if (!id) throw new UnauthorizedException("Missing :id route param");
    const token = authz.slice("Bearer ".length);
    if (!verifyCallbackToken(id, token, this.secret)) {
      throw new UnauthorizedException("Invalid callback token");
    }
    return true;
  }
}
```

- [ ] **Step 4.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- hmac-callback.guard
```
Expected: 7 specs green.

- [ ] **Step 4.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.ts \
        apps/api/src/modules/benchmark/callbacks/hmac-callback.guard.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): HmacCallbackGuard for runner-pod callbacks

Validates Authorization: Bearer <hmac-token> against BENCHMARK_CALLBACK_SECRET.
id is read from the :id route param so cross-id tokens cannot be replayed.
Constructor fails loud if the secret is missing — env schema enforces
presence outside NODE_ENV=test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: K8s Job + Secret manifest builders (pure functions)

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.ts`
- Create: `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts`

Translates a `BenchmarkExecutionContext` (Phase 1 interface) into the two K8s objects: a per-run `Secret` carrying `API_KEY` + `CALLBACK_TOKEN`, and a `Job` referencing it via `envFrom`. Pure functions so they're trivial to test without the K8s client.

- [ ] **Step 5.1: Create the directory + write the failing test**

```bash
mkdir -p apps/api/src/modules/benchmark/drivers
```

The Phase 1 interface file already lives at `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts` — we add new files alongside it.

Create `apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";
import { buildJobManifest, buildSecretManifest, jobName, secretName } from "./k8s-job-manifest.js";

const ctx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc123",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.example.com/v1",
  apiKey: "sk-supersecret",
  model: "llama-3-70b",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: 42,
  requestRate: 0,
  totalRequests: 1000,
  maxDurationSeconds: 1800,
  callbackUrl: "http://modeldoctor-api.modeldoctor.svc:3001",
  callbackToken: "1700000000.deadbeef",
};

describe("k8s-job-manifest", () => {
  describe("naming", () => {
    it("derives stable names from benchmarkId", () => {
      expect(secretName("ckabc123")).toBe("benchmark-ckabc123");
      expect(jobName("ckabc123")).toBe("benchmark-ckabc123");
    });
  });

  describe("buildSecretManifest", () => {
    const sec = buildSecretManifest(ctx, "modeldoctor-benchmarks");

    it("targets the right namespace + name", () => {
      expect(sec.metadata?.namespace).toBe("modeldoctor-benchmarks");
      expect(sec.metadata?.name).toBe("benchmark-ckabc123");
    });

    it("uses Opaque type with stringData", () => {
      expect(sec.type).toBe("Opaque");
      expect(sec.stringData).toEqual({
        API_KEY: "sk-supersecret",
        CALLBACK_TOKEN: "1700000000.deadbeef",
      });
    });

    it("does not set ownerReferences (patched in after Job create)", () => {
      expect(sec.metadata?.ownerReferences).toBeUndefined();
    });
  });

  describe("buildJobManifest", () => {
    const job = buildJobManifest(ctx, {
      namespace: "modeldoctor-benchmarks",
      image: "modeldoctor/benchmark-runner:dev",
    });

    it("targets the right namespace + name", () => {
      expect(job.metadata?.namespace).toBe("modeldoctor-benchmarks");
      expect(job.metadata?.name).toBe("benchmark-ckabc123");
    });

    it("labels the Job with the benchmark id", () => {
      expect(job.metadata?.labels).toMatchObject({
        "app.kubernetes.io/name": "modeldoctor-benchmark-runner",
        "modeldoctor.ai/benchmark-id": "ckabc123",
      });
    });

    it("disables retries (backoffLimit=0) and GCs after 1h", () => {
      expect(job.spec?.backoffLimit).toBe(0);
      expect(job.spec?.ttlSecondsAfterFinished).toBe(3600);
    });

    it("uses Never restart policy", () => {
      expect(job.spec?.template.spec?.restartPolicy).toBe("Never");
    });

    it("sets resource requests + limits to the hard-coded defaults", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.resources).toEqual({
        requests: { cpu: "500m", memory: "512Mi" },
        limits: { cpu: "2", memory: "2Gi" },
      });
    });

    it("uses the configured image with IfNotPresent pull policy", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.image).toBe("modeldoctor/benchmark-runner:dev");
      expect(c?.imagePullPolicy).toBe("IfNotPresent");
    });

    it("references the Secret via envFrom (sensitive vars not in env.value)", () => {
      const c = job.spec?.template.spec?.containers[0];
      expect(c?.envFrom).toEqual([{ secretRef: { name: "benchmark-ckabc123" } }]);
      const envNames = (c?.env ?? []).map((e) => e.name);
      expect(envNames).not.toContain("API_KEY");
      expect(envNames).not.toContain("CALLBACK_TOKEN");
    });

    it("populates non-sensitive env vars", () => {
      const c = job.spec?.template.spec?.containers[0];
      const env = Object.fromEntries((c?.env ?? []).map((e) => [e.name, e.value]));
      expect(env).toMatchObject({
        BENCHMARK_ID: "ckabc123",
        CALLBACK_URL: "http://modeldoctor-api.modeldoctor.svc:3001",
        TARGET_URL: "https://api.example.com/v1",
        MODEL: "llama-3-70b",
        API_TYPE: "chat",
        DATASET_NAME: "random",
        PROMPT_TOKENS: "1024",
        OUTPUT_TOKENS: "128",
        DATASET_SEED: "42",
        REQUEST_RATE: "0",
        TOTAL_REQUESTS: "1000",
        MAX_DURATION_SECONDS: "1800",
      });
    });

    it("omits DATASET_SEED when not provided", () => {
      const noSeedCtx = { ...ctx, datasetSeed: undefined };
      const j = buildJobManifest(noSeedCtx, {
        namespace: "ns",
        image: "img:tag",
      });
      const env = (j.spec?.template.spec?.containers[0]?.env ?? []).map((e) => e.name);
      expect(env).not.toContain("DATASET_SEED");
    });
  });
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-manifest
```
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement `k8s-job-manifest.ts`**

```ts
import type { V1Job, V1Secret } from "@kubernetes/client-node";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";

export function jobName(benchmarkId: string): string {
  return `benchmark-${benchmarkId}`;
}

export function secretName(benchmarkId: string): string {
  return `benchmark-${benchmarkId}`;
}

const LABELS = {
  "app.kubernetes.io/name": "modeldoctor-benchmark-runner",
  "app.kubernetes.io/managed-by": "modeldoctor-api",
};

export function buildSecretManifest(ctx: BenchmarkExecutionContext, namespace: string): V1Secret {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: secretName(ctx.benchmarkId),
      namespace,
      labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
    },
    type: "Opaque",
    stringData: {
      API_KEY: ctx.apiKey,
      CALLBACK_TOKEN: ctx.callbackToken,
    },
  };
}

export interface JobManifestOptions {
  namespace: string;
  image: string;
}

export function buildJobManifest(
  ctx: BenchmarkExecutionContext,
  opts: JobManifestOptions,
): V1Job {
  const env: { name: string; value: string }[] = [
    { name: "BENCHMARK_ID", value: ctx.benchmarkId },
    { name: "CALLBACK_URL", value: ctx.callbackUrl },
    { name: "TARGET_URL", value: ctx.apiUrl },
    { name: "MODEL", value: ctx.model },
    { name: "API_TYPE", value: ctx.apiType },
    { name: "DATASET_NAME", value: ctx.datasetName },
    { name: "PROMPT_TOKENS", value: String(ctx.datasetInputTokens ?? "") },
    { name: "OUTPUT_TOKENS", value: String(ctx.datasetOutputTokens ?? "") },
    { name: "REQUEST_RATE", value: String(ctx.requestRate) },
    { name: "TOTAL_REQUESTS", value: String(ctx.totalRequests) },
    { name: "MAX_DURATION_SECONDS", value: String(ctx.maxDurationSeconds) },
  ];
  if (ctx.datasetSeed !== undefined) {
    env.push({ name: "DATASET_SEED", value: String(ctx.datasetSeed) });
  }

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName(ctx.benchmarkId),
      namespace: opts.namespace,
      labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: {
          labels: { ...LABELS, "modeldoctor.ai/benchmark-id": ctx.benchmarkId },
        },
        spec: {
          restartPolicy: "Never",
          containers: [
            {
              name: "runner",
              image: opts.image,
              imagePullPolicy: "IfNotPresent",
              env,
              envFrom: [{ secretRef: { name: secretName(ctx.benchmarkId) } }],
              resources: {
                requests: { cpu: "500m", memory: "512Mi" },
                limits: { cpu: "2", memory: "2Gi" },
              },
            },
          ],
        },
      },
    },
  };
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-manifest
```
Expected: 11 specs green.

- [ ] **Step 5.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/drivers/k8s-job-manifest.ts \
        apps/api/src/modules/benchmark/drivers/k8s-job-manifest.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): pure-function K8s Job + Secret manifest builders

Hard-codes resource requests (500m/512Mi) + limits (2/2Gi),
ttlSecondsAfterFinished=3600, backoffLimit=0, restartPolicy=Never.
Sensitive env (API_KEY, CALLBACK_TOKEN) goes in a per-run Secret +
envFrom; never in env.value, where it would leak via kubectl describe.
Pure functions; K8sJobDriver wires them to the live client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: SubprocessDriver

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/subprocess-driver.ts`
- Create: `apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts`

Spawns `benchmark-runner benchmark run ...` as a child process. argv carries no secrets — apiKey + callbackToken go via the child's `env` only. Holds a `Map<handle, ChildProcess>` to support cancel.

- [ ] **Step 6.1: Write the failing test**

Create `apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts`:

```ts
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";

// Mock node:child_process before importing the driver.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// Import after the mock is set up.
const { SubprocessDriver } = await import("./subprocess-driver.js");

const baseCtx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc",
  profile: "latency",
  apiType: "chat",
  apiUrl: "https://api.example.com",
  apiKey: "sk-secret",
  model: "m1",
  datasetName: "random",
  datasetInputTokens: 128,
  datasetOutputTokens: 128,
  datasetSeed: undefined,
  requestRate: 1,
  totalRequests: 100,
  maxDurationSeconds: 600,
  callbackUrl: "http://localhost:3001",
  callbackToken: "tok",
};

function fakeChild(pid: number): ChildProcess {
  const ee = new EventEmitter() as ChildProcess;
  Object.assign(ee, { pid, kill: vi.fn(() => true), killed: false });
  return ee;
}

describe("SubprocessDriver", () => {
  beforeEach(() => spawnMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it("spawns benchmark-runner with the right argv (no secrets in argv)", async () => {
    const child = fakeChild(4242);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);

    expect(handle).toBe("subprocess:4242");
    const [cmd, args, opts] = spawnMock.mock.calls[0];
    expect(cmd).toBe("benchmark-runner");
    expect(args).toContain("benchmark");
    expect(args).toContain("run");
    // argv must NOT contain the api key.
    expect(args.join(" ")).not.toContain("sk-secret");
    expect(args.join(" ")).not.toContain("tok");
    // env must carry the secrets.
    expect(opts.env.API_KEY).toBe("sk-secret");
    expect(opts.env.CALLBACK_TOKEN).toBe("tok");
    expect(opts.env.BENCHMARK_ID).toBe("ckabc");
    expect(opts.env.CALLBACK_URL).toBe("http://localhost:3001");
    expect(opts.detached).toBeFalsy();
  });

  it("cancel() sends SIGTERM, then SIGKILL after 10s if still alive", async () => {
    vi.useFakeTimers();
    const child = fakeChild(99);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    await drv.cancel(handle);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    vi.advanceTimersByTime(10_001);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("cancel() of an unknown handle is silent ok (post-restart case)", async () => {
    const drv = new SubprocessDriver();
    await expect(drv.cancel("subprocess:404")).resolves.toBeUndefined();
  });

  it("cleanup() removes the handle from the in-memory map", async () => {
    const child = fakeChild(7);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    await drv.cleanup(handle);
    // After cleanup, cancel should be a silent no-op.
    await expect(drv.cancel(handle)).resolves.toBeUndefined();
    // And the SIGTERM kill must NOT have been called by cancel after cleanup.
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("auto-removes the handle when the child exits", async () => {
    const child = fakeChild(8);
    spawnMock.mockReturnValue(child);

    const drv = new SubprocessDriver();
    const { handle } = await drv.start(baseCtx);
    child.emit("exit", 0, null);
    // After exit, cancel of that handle is a no-op.
    await expect(drv.cancel(handle)).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- subprocess-driver
```
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `subprocess-driver.ts`**

```ts
import { type ChildProcess, spawn } from "node:child_process";
import { Injectable, Logger } from "@nestjs/common";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";

interface Entry {
  child: ChildProcess;
  killTimer?: NodeJS.Timeout;
}

const SIGKILL_DELAY_MS = 10_000;

@Injectable()
export class SubprocessDriver implements BenchmarkExecutionDriver {
  private readonly log = new Logger(SubprocessDriver.name);
  private readonly handles = new Map<BenchmarkExecutionHandle, Entry>();

  async start(
    ctx: BenchmarkExecutionContext,
  ): Promise<{ handle: BenchmarkExecutionHandle }> {
    const args = ["benchmark", "run"];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      BENCHMARK_ID: ctx.benchmarkId,
      CALLBACK_URL: ctx.callbackUrl,
      CALLBACK_TOKEN: ctx.callbackToken,
      TARGET_URL: ctx.apiUrl,
      API_KEY: ctx.apiKey,
      MODEL: ctx.model,
      API_TYPE: ctx.apiType,
      DATASET_NAME: ctx.datasetName,
      PROMPT_TOKENS: String(ctx.datasetInputTokens ?? ""),
      OUTPUT_TOKENS: String(ctx.datasetOutputTokens ?? ""),
      REQUEST_RATE: String(ctx.requestRate),
      TOTAL_REQUESTS: String(ctx.totalRequests),
      MAX_DURATION_SECONDS: String(ctx.maxDurationSeconds),
    };
    if (ctx.datasetSeed !== undefined) {
      env.DATASET_SEED = String(ctx.datasetSeed);
    }

    const child = spawn("benchmark-runner", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!child.pid) {
      throw new Error("SubprocessDriver: failed to spawn benchmark-runner (no pid)");
    }
    const handle: BenchmarkExecutionHandle = `subprocess:${child.pid}`;
    this.handles.set(handle, { child });

    child.on("exit", (code, signal) => {
      this.log.log(
        `subprocess ${handle} exited code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
      const entry = this.handles.get(handle);
      if (entry?.killTimer) clearTimeout(entry.killTimer);
      this.handles.delete(handle);
    });

    return { handle };
  }

  async cancel(handle: BenchmarkExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return; // unknown handle (post-restart) → silent ok
    entry.child.kill("SIGTERM");
    entry.killTimer = setTimeout(() => {
      if (!entry.child.killed) entry.child.kill("SIGKILL");
    }, SIGKILL_DELAY_MS);
    // Don't unref — let the timer keep us alive until the kill resolves.
  }

  async cleanup(handle: BenchmarkExecutionHandle): Promise<void> {
    const entry = this.handles.get(handle);
    if (!entry) return;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    this.handles.delete(handle);
  }
}
```

- [ ] **Step 6.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- subprocess-driver
```
Expected: 5 specs green.

- [ ] **Step 6.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/drivers/subprocess-driver.ts \
        apps/api/src/modules/benchmark/drivers/subprocess-driver.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): SubprocessDriver

spawn() benchmark-runner attached to the API process. Secrets (apiKey,
callbackToken) flow via env only; argv has no secret-bearing flags.
cancel() = SIGTERM then SIGKILL after 10s. cancel() of an unknown
handle is silent ok — covers the post-restart case where the
in-memory map is empty; the reconciler reaps the orphaned row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: K8sJobDriver

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/k8s-job-driver.ts`
- Create: `apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts`

Wraps the manifest builders + the `BatchV1Api` / `CoreV1Api` clients. Key invariants the test pins down:
1. Secret is created **before** Job (so the Job pod can resolve `envFrom` immediately).
2. After Job creation, Secret's `ownerReferences` is patched with the Job's UID — K8s then GCs the Secret when the Job is deleted (TTL or explicit cancel).
3. If Job creation fails, the Secret is explicitly deleted (no orphans).
4. `cancel()` deletes the Job with `propagationPolicy='Foreground'`; 404 (already gone) is silent ok.

- [ ] **Step 7.1: Write the failing test**

Create `apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkExecutionContext } from "./execution-driver.interface.js";

const ctx: BenchmarkExecutionContext = {
  benchmarkId: "ckabc",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://t",
  apiKey: "sk",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 128,
  datasetOutputTokens: 128,
  datasetSeed: undefined,
  requestRate: 0,
  totalRequests: 10,
  maxDurationSeconds: 60,
  callbackUrl: "http://api:3001",
  callbackToken: "tok",
};

interface FakeApis {
  batch: {
    createNamespacedJob: ReturnType<typeof vi.fn>;
    deleteNamespacedJob: ReturnType<typeof vi.fn>;
    readNamespacedJob: ReturnType<typeof vi.fn>;
  };
  core: {
    createNamespacedSecret: ReturnType<typeof vi.fn>;
    deleteNamespacedSecret: ReturnType<typeof vi.fn>;
    patchNamespacedSecret: ReturnType<typeof vi.fn>;
    listNamespacedPod: ReturnType<typeof vi.fn>;
  };
}

function buildApis(): FakeApis {
  return {
    batch: {
      createNamespacedJob: vi.fn(),
      deleteNamespacedJob: vi.fn(),
      readNamespacedJob: vi.fn(),
    },
    core: {
      createNamespacedSecret: vi.fn(),
      deleteNamespacedSecret: vi.fn(),
      patchNamespacedSecret: vi.fn(),
      listNamespacedPod: vi.fn(),
    },
  };
}

const { K8sJobDriver } = await import("./k8s-job-driver.js");

describe("K8sJobDriver", () => {
  let apis: FakeApis;
  beforeEach(() => {
    apis = buildApis();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("start", () => {
    it("creates Secret before Job, then patches ownerReferences", async () => {
      const order: string[] = [];
      apis.core.createNamespacedSecret.mockImplementation(async () => {
        order.push("secret");
      });
      apis.batch.createNamespacedJob.mockImplementation(async () => {
        order.push("job");
        return { body: { metadata: { uid: "job-uid-1" } } };
      });
      apis.core.patchNamespacedSecret.mockImplementation(async () => {
        order.push("patch");
      });

      const drv = new K8sJobDriver({
        namespace: "modeldoctor-benchmarks",
        image: "img:tag",
        apis: apis as unknown as ConstructorParameters<typeof K8sJobDriver>[0]["apis"],
      });
      const { handle } = await drv.start(ctx);
      expect(order).toEqual(["secret", "job", "patch"]);
      expect(handle).toBe("modeldoctor-benchmarks/benchmark-ckabc");

      const patchArgs = apis.core.patchNamespacedSecret.mock.calls[0];
      expect(patchArgs[0]).toBe("benchmark-ckabc"); // name
      expect(patchArgs[1]).toBe("modeldoctor-benchmarks"); // ns
      // The patch body must include ownerReferences with the Job uid.
      const patchBody = patchArgs[2];
      expect(JSON.stringify(patchBody)).toContain("job-uid-1");
    });

    it("does not put apiKey or callbackToken into the Job's env.value", async () => {
      apis.batch.createNamespacedJob.mockResolvedValue({
        body: { metadata: { uid: "u" } },
      });
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await drv.start(ctx);
      const jobBody = apis.batch.createNamespacedJob.mock.calls[0][1];
      const envEntries = jobBody.spec.template.spec.containers[0].env ?? [];
      const envText = JSON.stringify(envEntries);
      expect(envText).not.toContain("sk"); // apiKey value
      expect(envText).not.toContain("tok"); // callbackToken value
    });

    it("rolls back the Secret when Job creation fails", async () => {
      apis.batch.createNamespacedJob.mockRejectedValue(new Error("rbac denied"));
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.start(ctx)).rejects.toThrow(/rbac denied/);
      expect(apis.core.deleteNamespacedSecret).toHaveBeenCalledWith(
        "benchmark-ckabc",
        "ns",
      );
    });

    it("tolerates a failing ownerReference patch (warns, doesn't abort)", async () => {
      apis.batch.createNamespacedJob.mockResolvedValue({
        body: { metadata: { uid: "u" } },
      });
      apis.core.patchNamespacedSecret.mockRejectedValue(new Error("patch failed"));
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      const { handle } = await drv.start(ctx);
      expect(handle).toBe("ns/benchmark-ckabc");
    });
  });

  describe("cancel", () => {
    it("deletes the Job with foreground propagation", async () => {
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      apis.batch.deleteNamespacedJob.mockResolvedValue({});
      await drv.cancel("ns/benchmark-ckabc");
      const args = apis.batch.deleteNamespacedJob.mock.calls[0];
      expect(args[0]).toBe("benchmark-ckabc"); // name
      expect(args[1]).toBe("ns"); // ns
      // 5th positional arg is propagationPolicy in @kubernetes/client-node 0.21.
      expect(args).toContain("Foreground");
    });

    it("treats 404 as silent ok", async () => {
      const err = new Error("not found") as Error & { statusCode: number };
      err.statusCode = 404;
      apis.batch.deleteNamespacedJob.mockRejectedValue(err);
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.cancel("ns/benchmark-ckabc")).resolves.toBeUndefined();
    });

    it("rejects malformed handles", async () => {
      const drv = new K8sJobDriver({
        namespace: "ns",
        image: "img:tag",
        apis: apis as never,
      });
      await expect(drv.cancel("not-a-handle")).rejects.toThrow(/handle/);
    });
  });

  it("cleanup is a no-op (TTL handles GC)", async () => {
    const drv = new K8sJobDriver({
      namespace: "ns",
      image: "img:tag",
      apis: apis as never,
    });
    await expect(drv.cleanup("ns/benchmark-ckabc")).resolves.toBeUndefined();
    expect(apis.batch.deleteNamespacedJob).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-driver
```
Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement `k8s-job-driver.ts`**

```ts
import type { BatchV1Api, CoreV1Api } from "@kubernetes/client-node";
import { Logger } from "@nestjs/common";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";
import {
  buildJobManifest,
  buildSecretManifest,
  jobName,
  secretName,
} from "./k8s-job-manifest.js";

export interface K8sJobDriverOpts {
  namespace: string;
  image: string;
  apis: { batch: BatchV1Api; core: CoreV1Api };
}

export class K8sJobDriver implements BenchmarkExecutionDriver {
  private readonly log = new Logger(K8sJobDriver.name);
  private readonly namespace: string;
  private readonly image: string;
  private readonly batch: BatchV1Api;
  private readonly core: CoreV1Api;

  constructor(opts: K8sJobDriverOpts) {
    this.namespace = opts.namespace;
    this.image = opts.image;
    this.batch = opts.apis.batch;
    this.core = opts.apis.core;
  }

  async start(
    ctx: BenchmarkExecutionContext,
  ): Promise<{ handle: BenchmarkExecutionHandle }> {
    const ns = this.namespace;
    const secret = buildSecretManifest(ctx, ns);
    await this.core.createNamespacedSecret(ns, secret);

    let jobUid: string | undefined;
    try {
      const job = buildJobManifest(ctx, { namespace: ns, image: this.image });
      const created = await this.batch.createNamespacedJob(ns, job);
      jobUid = (created as { body?: { metadata?: { uid?: string } } }).body?.metadata?.uid;
    } catch (e) {
      // Roll back the orphan Secret; rethrow.
      try {
        await this.core.deleteNamespacedSecret(secretName(ctx.benchmarkId), ns);
      } catch (rbErr) {
        this.log.warn(
          `Failed to roll back Secret after Job-create failure: ${(rbErr as Error).message}`,
        );
      }
      throw e;
    }

    if (jobUid) {
      try {
        await this.core.patchNamespacedSecret(
          secretName(ctx.benchmarkId),
          ns,
          {
            metadata: {
              ownerReferences: [
                {
                  apiVersion: "batch/v1",
                  kind: "Job",
                  name: jobName(ctx.benchmarkId),
                  uid: jobUid,
                  controller: true,
                  blockOwnerDeletion: true,
                },
              ],
            },
          },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/strategic-merge-patch+json" } },
        );
      } catch (e) {
        // Worst case: Secret outlives Job (manual cleanup). Don't fail the run.
        this.log.warn(`Failed to patch Secret ownerReferences: ${(e as Error).message}`);
      }
    }

    return { handle: `${ns}/${jobName(ctx.benchmarkId)}` };
  }

  async cancel(handle: BenchmarkExecutionHandle): Promise<void> {
    const [ns, name] = parseHandle(handle);
    try {
      await this.batch.deleteNamespacedJob(
        name,
        ns,
        undefined,
        undefined,
        undefined,
        undefined,
        "Foreground",
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) return; // already gone — silent ok
      throw e;
    }
  }

  async cleanup(): Promise<void> {
    // No-op: ttlSecondsAfterFinished GCs the Job (and the owner-referenced Secret).
  }
}

function parseHandle(handle: BenchmarkExecutionHandle): [string, string] {
  const idx = handle.indexOf("/");
  if (idx <= 0 || idx === handle.length - 1) {
    throw new Error(`K8sJobDriver: malformed handle ${handle}`);
  }
  return [handle.slice(0, idx), handle.slice(idx + 1)];
}
```

- [ ] **Step 7.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-driver
```
Expected: 7 specs green.

- [ ] **Step 7.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/drivers/k8s-job-driver.ts \
        apps/api/src/modules/benchmark/drivers/k8s-job-driver.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): K8sJobDriver

start(): create Secret, create Job, patch Secret with Job's UID as
ownerReference so K8s GCs the Secret when the Job's TTL expires.
Job-create failure deletes the Secret to avoid orphans. Patch failure
is logged but does not abort the run.

cancel(): deleteNamespacedJob with Foreground propagation; 404 is
silent ok. cleanup() is a no-op — ttlSecondsAfterFinished handles GC.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Driver injection token + factory provider

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/benchmark-driver.token.ts`
- Create: `apps/api/src/modules/benchmark/drivers/driver.factory.ts`
- Create: `apps/api/src/modules/benchmark/drivers/driver.factory.spec.ts`

The factory selects between `SubprocessDriver` and `K8sJobDriver` at module-init time based on `BENCHMARK_DRIVER`. `@kubernetes/client-node` is loaded via dynamic import so subprocess-only sessions don't pay the cost.

- [ ] **Step 8.1: Token file**

Create `apps/api/src/modules/benchmark/drivers/benchmark-driver.token.ts`:

```ts
export const BENCHMARK_DRIVER = Symbol("BENCHMARK_DRIVER");
```

(One symbol; no test needed for a literal export.)

- [ ] **Step 8.2: Write the failing factory test**

Create `apps/api/src/modules/benchmark/drivers/driver.factory.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { K8sJobDriver } from "./k8s-job-driver.js";
import { SubprocessDriver } from "./subprocess-driver.js";
import { createBenchmarkDriver } from "./driver.factory.js";

function buildConfig(over: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => over[key],
  } as unknown as ConfigService;
}

describe("createBenchmarkDriver", () => {
  it("returns a SubprocessDriver when BENCHMARK_DRIVER=subprocess", async () => {
    const drv = await createBenchmarkDriver(buildConfig({ BENCHMARK_DRIVER: "subprocess" }));
    expect(drv).toBeInstanceOf(SubprocessDriver);
  });

  it("defaults to subprocess when BENCHMARK_DRIVER is unset", async () => {
    const drv = await createBenchmarkDriver(buildConfig({}));
    expect(drv).toBeInstanceOf(SubprocessDriver);
  });

  it("returns a K8sJobDriver when BENCHMARK_DRIVER=k8s", async () => {
    // Stub the dynamic @kubernetes/client-node import so the test doesn't need
    // a real kubeconfig.
    vi.stubGlobal(
      "__test_kc_loader__",
      () => ({
        KubeConfig: class {
          loadFromDefault() {}
          makeApiClient() {
            return {};
          }
        },
        BatchV1Api: class {},
        CoreV1Api: class {},
      }),
    );
    const drv = await createBenchmarkDriver(
      buildConfig({
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_K8S_NAMESPACE: "modeldoctor-benchmarks",
        BENCHMARK_RUNNER_IMAGE: "img:tag",
      }),
    );
    expect(drv).toBeInstanceOf(K8sJobDriver);
  });

  it("rejects unknown driver names", async () => {
    await expect(
      createBenchmarkDriver(buildConfig({ BENCHMARK_DRIVER: "bogus" })),
    ).rejects.toThrow(/BENCHMARK_DRIVER/);
  });

  it("requires BENCHMARK_RUNNER_IMAGE in k8s mode", async () => {
    await expect(
      createBenchmarkDriver(
        buildConfig({ BENCHMARK_DRIVER: "k8s", BENCHMARK_K8S_NAMESPACE: "ns" }),
      ),
    ).rejects.toThrow(/BENCHMARK_RUNNER_IMAGE/);
  });
});
```

- [ ] **Step 8.3: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- driver.factory
```
Expected: FAIL — `./driver.factory.js` not found.

- [ ] **Step 8.4: Implement `driver.factory.ts`**

```ts
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import type { BenchmarkExecutionDriver } from "./execution-driver.interface.js";
import { K8sJobDriver } from "./k8s-job-driver.js";
import { SubprocessDriver } from "./subprocess-driver.js";

/**
 * Loads @kubernetes/client-node lazily so subprocess-only sessions don't
 * pay the ~30MB module load. A globalThis hook is exposed for tests to stub.
 */
async function loadK8sClient(): Promise<typeof import("@kubernetes/client-node")> {
  const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
  if (stub) return stub() as typeof import("@kubernetes/client-node");
  return await import("@kubernetes/client-node");
}

export async function createBenchmarkDriver(
  config: ConfigService<Env, true>,
): Promise<BenchmarkExecutionDriver> {
  const choice = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
  if (choice === "subprocess") {
    return new SubprocessDriver();
  }
  if (choice === "k8s") {
    const ns = (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) ??
      "modeldoctor-benchmarks") as string;
    const image = config.get("BENCHMARK_RUNNER_IMAGE", { infer: true }) as string | undefined;
    if (!image) {
      throw new Error(
        "BENCHMARK_DRIVER=k8s requires BENCHMARK_RUNNER_IMAGE to be set.",
      );
    }
    const k8s = await loadK8sClient();
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    return new K8sJobDriver({
      namespace: ns,
      image,
      apis: {
        batch: kc.makeApiClient(k8s.BatchV1Api),
        core: kc.makeApiClient(k8s.CoreV1Api),
      },
    });
  }
  throw new Error(`Unknown BENCHMARK_DRIVER value: ${choice}`);
}
```

- [ ] **Step 8.5: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- driver.factory
```
Expected: 5 specs green.

- [ ] **Step 8.6: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/drivers/benchmark-driver.token.ts \
        apps/api/src/modules/benchmark/drivers/driver.factory.ts \
        apps/api/src/modules/benchmark/drivers/driver.factory.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): driver injection token + async factory

Factory dynamic-imports @kubernetes/client-node only when
BENCHMARK_DRIVER=k8s; subprocess-only sessions don't pay the
~30 MB cost. Tests stub the import via globalThis.__test_kc_loader__
so they don't need a real kubeconfig.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Phase 3 env schema additions + tighten existing keys

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.spec.ts`

Adds `BENCHMARK_DRIVER`, `BENCHMARK_CALLBACK_URL`, `BENCHMARK_K8S_NAMESPACE`, `BENCHMARK_RUNNER_IMAGE`, `BENCHMARK_DEFAULT_MAX_DURATION_SECONDS`. Tightens `CONNECTION_API_KEY_ENCRYPTION_KEY` and `BENCHMARK_CALLBACK_SECRET` from `optional` to required-when-not-test.

- [ ] **Step 9.1: Write the failing tests**

Append to `apps/api/src/config/env.spec.ts` (inside the existing top-level `describe("validateEnv", ...)`):

```ts
  describe("Phase 3 benchmark env", () => {
    const baseTest = {
      NODE_ENV: "test" as const,
    };
    const baseDev = {
      NODE_ENV: "development" as const,
      DATABASE_URL: "postgres://localhost:5432/db",
      JWT_ACCESS_SECRET: "x".repeat(32),
      CONNECTION_API_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
      BENCHMARK_CALLBACK_URL: "http://localhost:3001",
    };

    it("defaults BENCHMARK_DRIVER to subprocess", () => {
      const env = validateEnv(baseDev);
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
    });

    it("rejects unknown BENCHMARK_DRIVER values", () => {
      expect(() => validateEnv({ ...baseDev, BENCHMARK_DRIVER: "bogus" })).toThrow(
        /BENCHMARK_DRIVER/,
      );
    });

    it("requires BENCHMARK_RUNNER_IMAGE when BENCHMARK_DRIVER=k8s", () => {
      expect(() => validateEnv({ ...baseDev, BENCHMARK_DRIVER: "k8s" })).toThrow(
        /BENCHMARK_RUNNER_IMAGE/,
      );
    });

    it("accepts BENCHMARK_DRIVER=k8s when image + namespace are set", () => {
      const env = validateEnv({
        ...baseDev,
        BENCHMARK_DRIVER: "k8s",
        BENCHMARK_RUNNER_IMAGE: "modeldoctor/benchmark-runner:dev",
      });
      expect(env.BENCHMARK_DRIVER).toBe("k8s");
      expect(env.BENCHMARK_K8S_NAMESPACE).toBe("modeldoctor-benchmarks");
    });

    it("defaults BENCHMARK_DEFAULT_MAX_DURATION_SECONDS to 1800", () => {
      const env = validateEnv(baseDev);
      expect(env.BENCHMARK_DEFAULT_MAX_DURATION_SECONDS).toBe(1800);
    });

    it("requires CONNECTION_API_KEY_ENCRYPTION_KEY outside test mode", () => {
      const noKey = { ...baseDev, CONNECTION_API_KEY_ENCRYPTION_KEY: undefined };
      expect(() => validateEnv(noKey)).toThrow(/CONNECTION_API_KEY_ENCRYPTION_KEY/);
    });

    it("requires BENCHMARK_CALLBACK_SECRET outside test mode", () => {
      const noSecret = { ...baseDev, BENCHMARK_CALLBACK_SECRET: undefined };
      expect(() => validateEnv(noSecret)).toThrow(/BENCHMARK_CALLBACK_SECRET/);
    });

    it("requires BENCHMARK_CALLBACK_URL outside test mode", () => {
      const noUrl = { ...baseDev, BENCHMARK_CALLBACK_URL: undefined };
      expect(() => validateEnv(noUrl)).toThrow(/BENCHMARK_CALLBACK_URL/);
    });

    it("does not require benchmark vars in test mode", () => {
      // Sanity: existing baseTest still passes.
      const env = validateEnv(baseTest);
      expect(env.NODE_ENV).toBe("test");
      expect(env.BENCHMARK_DRIVER).toBe("subprocess");
    });
  });
```

- [ ] **Step 9.2: Run the test to verify the new specs fail**

```bash
pnpm -F @modeldoctor/api test -- env
```
Expected: the new specs FAIL — current schema treats the secrets as optional and doesn't know about the new keys.

- [ ] **Step 9.3: Update `env.schema.ts`**

Replace the existing benchmark-related lines with the tightened versions, and add the four new keys. The full diff against the current schema:

In `apps/api/src/config/env.schema.ts`, replace the two existing benchmark optional fields with these (place inside the `EnvSchema` `.object({...})` block near where they currently sit):

```ts
    CONNECTION_API_KEY_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (v === undefined) return true;
          if (!/^[A-Za-z0-9+/=]+$/.test(v)) return false;
          return Buffer.from(v, "base64").length === 32;
        },
        { message: "must be a base64 string that decodes to exactly 32 bytes" },
      ),
    BENCHMARK_CALLBACK_SECRET: z.string().min(32).optional(),
    BENCHMARK_DRIVER: z.enum(["subprocess", "k8s"]).default("subprocess"),
    BENCHMARK_CALLBACK_URL: z.string().url().optional(),
    BENCHMARK_K8S_NAMESPACE: z.string().min(1).default("modeldoctor-benchmarks"),
    BENCHMARK_RUNNER_IMAGE: z.string().min(1).optional(),
    BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(1800),
```

Then extend the `superRefine` block at the bottom of `EnvSchema` to enforce the non-test rules:

```ts
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "test" && !env.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.JWT_ACCESS_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_ACCESS_SECRET"],
        message: "JWT_ACCESS_SECRET is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.CONNECTION_API_KEY_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTION_API_KEY_ENCRYPTION_KEY"],
        message:
          "CONNECTION_API_KEY_ENCRYPTION_KEY is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.BENCHMARK_CALLBACK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_CALLBACK_SECRET"],
        message: "BENCHMARK_CALLBACK_SECRET is required when NODE_ENV is not 'test'",
      });
    }
    if (env.NODE_ENV !== "test" && !env.BENCHMARK_CALLBACK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_CALLBACK_URL"],
        message: "BENCHMARK_CALLBACK_URL is required when NODE_ENV is not 'test'",
      });
    }
    if (env.BENCHMARK_DRIVER === "k8s" && !env.BENCHMARK_RUNNER_IMAGE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BENCHMARK_RUNNER_IMAGE"],
        message: "BENCHMARK_RUNNER_IMAGE is required when BENCHMARK_DRIVER='k8s'",
      });
    }
  });
```

- [ ] **Step 9.4: Run all env tests**

```bash
pnpm -F @modeldoctor/api test -- env
```
Expected: all specs (existing + new Phase 3 ones) green.

- [ ] **Step 9.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/config/env.schema.ts apps/api/src/config/env.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/config): Phase 3 env vars + tighten existing keys

New: BENCHMARK_DRIVER (subprocess|k8s, default subprocess),
BENCHMARK_CALLBACK_URL (required in non-test), BENCHMARK_K8S_NAMESPACE
(default modeldoctor-benchmarks), BENCHMARK_RUNNER_IMAGE (required when
driver=k8s), BENCHMARK_DEFAULT_MAX_DURATION_SECONDS (default 1800).

Tightened: CONNECTION_API_KEY_ENCRYPTION_KEY and BENCHMARK_CALLBACK_SECRET
go from optional → required-when-not-test. Phase 1 left these optional
deliberately; this phase wires them into runtime use, so a missing key
now fails loud at boot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: BenchmarkService — `create` + `start` happy path

**Files:**
- Create: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Create: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

This task scaffolds the service class plus the create+start path. Subsequent tasks add list / detail / cancel / delete / callback handlers.

`BenchmarkService.create`:
1. Reject `datasetName=sharegpt` with `BENCHMARK_DATASET_UNSUPPORTED`.
2. Reject duplicate active name with `BENCHMARK_NAME_IN_USE`.
3. Encrypt `apiKey` with the AES-GCM helper from Phase 1.
4. INSERT row in `state=pending`.
5. Call `service.start(run.id)`:
   a. SELECT row, decrypt `apiKeyCipher`.
   b. Sign callback token (TTL = `maxDuration + 15min`).
   c. `await driver.start(ctx)`.
   d. UPDATE row: `state=submitted`, `jobName=handle`, `startedAt=now`.
   e. On `driver.start` failure: UPDATE state=failed with the error message; rethrow.
6. Return the updated row mapped through `toBenchmarkRunDto` (omits `apiKeyCipher`).

- [ ] **Step 10.1: Write the failing happy-path test**

Create `apps/api/src/modules/benchmark/benchmark.service.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateBenchmarkRequest } from "@modeldoctor/contracts";
import { encrypt } from "../../common/crypto/aes-gcm.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkService } from "./benchmark.service.js";

const KEY = Buffer.alloc(32, 7);
const SECRET = Buffer.from("y".repeat(48), "utf8");

function buildConfig(over: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        CONNECTION_API_KEY_ENCRYPTION_KEY: KEY.toString("base64"),
        BENCHMARK_CALLBACK_SECRET: SECRET.toString("utf8"),
        BENCHMARK_CALLBACK_URL: "http://localhost:3001",
        BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 1800,
        ...over,
      };
      return map[key];
    },
  } as unknown as ConfigService;
}

interface PrismaStub {
  benchmarkRun: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}
function buildPrisma(): PrismaStub {
  return {
    benchmarkRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function buildDriver(): BenchmarkExecutionDriver & {
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => ({ handle: "subprocess:1234" })),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}

const user: JwtPayload = { sub: "user-1", roles: [] } as JwtPayload;

const validRequest: CreateBenchmarkRequest = {
  name: "first run",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.example.com",
  apiKey: "sk-12345",
  model: "llama-3-70b",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  requestRate: 0,
  totalRequests: 1000,
};

describe("BenchmarkService.create + start", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
    prisma.benchmarkRun.count.mockResolvedValue(0);
    prisma.benchmarkRun.create.mockImplementation(async ({ data }) => ({
      id: "ckxxx1",
      userId: user.sub,
      ...data,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: null,
      completedAt: null,
      state: "pending",
      stateMessage: null,
      progress: null,
      jobName: null,
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      datasetSeed: null,
    }));
    prisma.benchmarkRun.findUnique.mockImplementation(async ({ where: { id } }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: encrypt("sk-12345", KEY),
      apiUrl: validRequest.apiUrl,
      apiType: "chat",
      model: validRequest.model,
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "first run",
      description: null,
      state: "pending",
      stateMessage: null,
      progress: null,
      jobName: null,
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: null,
      completedAt: null,
    }));
    prisma.benchmarkRun.update.mockImplementation(async ({ where: { id }, data }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: validRequest.apiUrl,
      apiType: "chat",
      model: validRequest.model,
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "first run",
      description: null,
      state: "submitted",
      stateMessage: null,
      progress: null,
      jobName: data.jobName ?? "subprocess:1234",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: data.startedAt ?? new Date(),
      completedAt: null,
      ...data,
    }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("encrypts the apiKey, persists pending, calls driver.start, returns submitted dto", async () => {
    const result = await svc.create(validRequest, user);

    // Persisted row has ciphertext, not plaintext.
    const createCall = prisma.benchmarkRun.create.mock.calls[0][0];
    expect(createCall.data.apiKeyCipher).not.toBe("sk-12345");
    expect(createCall.data.apiKeyCipher).toMatch(/^v1:/);
    expect(createCall.data.state).toBe("pending");

    // Driver was called with decrypted ctx.
    const driverCall = driver.start.mock.calls[0][0];
    expect(driverCall.apiKey).toBe("sk-12345");
    expect(driverCall.benchmarkId).toBe("ckxxx1");
    expect(driverCall.callbackUrl).toBe("http://localhost:3001");
    expect(driverCall.callbackToken).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(driverCall.maxDurationSeconds).toBe(1800);

    // Row was updated to submitted with the handle.
    const updateCall = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(updateCall.data.state).toBe("submitted");
    expect(updateCall.data.jobName).toBe("subprocess:1234");

    // Returned DTO does NOT carry apiKeyCipher.
    expect(result).not.toHaveProperty("apiKeyCipher");
    expect(result.state).toBe("submitted");
  });

  it("rejects datasetName=sharegpt with BENCHMARK_DATASET_UNSUPPORTED", async () => {
    await expect(
      svc.create({ ...validRequest, datasetName: "sharegpt" }, user),
    ).rejects.toMatchObject({
      response: { code: "BENCHMARK_DATASET_UNSUPPORTED" },
      status: 400,
    });
    expect(prisma.benchmarkRun.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate active name with BENCHMARK_NAME_IN_USE", async () => {
    prisma.benchmarkRun.count.mockResolvedValue(1);
    await expect(svc.create(validRequest, user)).rejects.toMatchObject({
      response: { code: "BENCHMARK_NAME_IN_USE" },
      status: 409,
    });
    expect(prisma.benchmarkRun.create).not.toHaveBeenCalled();
  });

  it("marks the row failed when driver.start throws", async () => {
    driver.start.mockRejectedValue(new Error("rbac denied"));
    await expect(svc.create(validRequest, user)).rejects.toThrow(/rbac denied/);
    const updateCall = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(updateCall.data.state).toBe("failed");
    expect(updateCall.data.stateMessage).toMatch(/rbac denied/);
  });
});
```

- [ ] **Step 10.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
```
Expected: FAIL — module not found.

- [ ] **Step 10.3: Implement `benchmark.service.ts` (create + start path only)**

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type BenchmarkRun as BenchmarkRunDto,
  type BenchmarkRunSummary,
  type BenchmarkState,
  type CreateBenchmarkRequest,
  ErrorCodes,
} from "@modeldoctor/contracts";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import {
  BENCHMARK_DRIVER,
} from "./drivers/benchmark-driver.token.js";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
} from "./drivers/execution-driver.interface.js";
import { signCallbackToken } from "./callbacks/hmac-token.js";

const ACTIVE_STATES = ["pending", "submitted", "running"] as const;
const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;

type BenchmarkRow = Awaited<ReturnType<PrismaService["benchmarkRun"]["findUnique"]>>;

@Injectable()
export class BenchmarkService {
  private readonly log = new Logger(BenchmarkService.name);
  private readonly key: Buffer;
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
  private readonly defaultMaxDuration: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    config: ConfigService<Env, true>,
  ) {
    this.key = decodeKey(
      config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true }) as string,
    );
    this.callbackSecret = Buffer.from(
      config.get("BENCHMARK_CALLBACK_SECRET", { infer: true }) as string,
      "utf8",
    );
    this.callbackUrl = config.get("BENCHMARK_CALLBACK_URL", { infer: true }) as string;
    this.defaultMaxDuration = config.get("BENCHMARK_DEFAULT_MAX_DURATION_SECONDS", {
      infer: true,
    }) as number;
  }

  async create(req: CreateBenchmarkRequest, user: JwtPayload): Promise<BenchmarkRunDto> {
    if (req.datasetName === "sharegpt") {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_DATASET_UNSUPPORTED,
        message: "ShareGPT dataset is not supported until a follow-up phase",
      });
    }

    const dupes = await this.prisma.benchmarkRun.count({
      where: {
        userId: user.sub,
        name: req.name,
        state: { in: [...ACTIVE_STATES] },
      },
    });
    if (dupes > 0) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NAME_IN_USE,
        message: `An active benchmark named '${req.name}' already exists`,
      });
    }

    const cipher = encrypt(req.apiKey, this.key);
    const created = await this.prisma.benchmarkRun.create({
      data: {
        userId: user.sub,
        name: req.name,
        description: req.description ?? null,
        profile: req.profile,
        apiType: req.apiType,
        apiUrl: req.apiUrl,
        apiKeyCipher: cipher,
        model: req.model,
        datasetName: req.datasetName,
        datasetInputTokens: req.datasetInputTokens ?? null,
        datasetOutputTokens: req.datasetOutputTokens ?? null,
        datasetSeed: req.datasetSeed ?? null,
        requestRate: req.requestRate,
        totalRequests: req.totalRequests,
        state: "pending",
      },
    });

    return await this.start(created.id);
  }

  async start(runId: string): Promise<BenchmarkRunDto> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id: runId } });
    if (!row) throw new Error(`BenchmarkService.start: row ${runId} not found`);

    const apiKey = decrypt(row.apiKeyCipher, this.key);
    const callbackToken = signCallbackToken(
      row.id,
      this.callbackSecret,
      this.defaultMaxDuration + CALLBACK_TTL_SLACK_SECONDS,
    );

    const ctx: BenchmarkExecutionContext = {
      benchmarkId: row.id,
      profile: row.profile as BenchmarkExecutionContext["profile"],
      apiType: row.apiType as BenchmarkExecutionContext["apiType"],
      apiUrl: row.apiUrl,
      apiKey,
      model: row.model,
      datasetName: row.datasetName as BenchmarkExecutionContext["datasetName"],
      datasetInputTokens: row.datasetInputTokens ?? undefined,
      datasetOutputTokens: row.datasetOutputTokens ?? undefined,
      datasetSeed: row.datasetSeed ?? undefined,
      requestRate: row.requestRate,
      totalRequests: row.totalRequests,
      maxDurationSeconds: this.defaultMaxDuration,
      callbackUrl: this.callbackUrl,
      callbackToken,
    };

    let handle: string;
    try {
      const result = await this.driver.start(ctx);
      handle = result.handle;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.prisma.benchmarkRun.update({
        where: { id: row.id },
        data: {
          state: "failed",
          stateMessage: msg.slice(0, 2048),
          completedAt: new Date(),
        },
      });
      throw e;
    }

    const updated = await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: {
        state: "submitted",
        jobName: handle,
        startedAt: new Date(),
      },
    });
    return toBenchmarkRunDto(updated);
  }
}

export function toBenchmarkRunDto(row: NonNullable<BenchmarkRow>): BenchmarkRunDto {
  // Strip apiKeyCipher; cast JSON columns; serialize dates.
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    profile: row.profile as BenchmarkRunDto["profile"],
    apiType: row.apiType as BenchmarkRunDto["apiType"],
    apiUrl: row.apiUrl,
    model: row.model,
    datasetName: row.datasetName as BenchmarkRunDto["datasetName"],
    datasetInputTokens: row.datasetInputTokens,
    datasetOutputTokens: row.datasetOutputTokens,
    datasetSeed: row.datasetSeed,
    requestRate: row.requestRate,
    totalRequests: row.totalRequests,
    state: row.state as BenchmarkState,
    stateMessage: row.stateMessage,
    progress: row.progress,
    jobName: row.jobName,
    metricsSummary: row.metricsSummary as BenchmarkRunDto["metricsSummary"],
    rawMetrics: row.rawMetrics ?? null,
    logs: row.logs,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export function toBenchmarkRunSummary(row: NonNullable<BenchmarkRow>): BenchmarkRunSummary {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    profile: row.profile as BenchmarkRunSummary["profile"],
    apiType: row.apiType as BenchmarkRunSummary["apiType"],
    apiUrl: row.apiUrl,
    model: row.model,
    datasetName: row.datasetName as BenchmarkRunSummary["datasetName"],
    state: row.state as BenchmarkState,
    progress: row.progress,
    metricsSummary: row.metricsSummary as BenchmarkRunSummary["metricsSummary"],
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
```

- [ ] **Step 10.4: Run the test to verify it passes**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
```
Expected: 4 specs green.

- [ ] **Step 10.5: Lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): service.create + start (happy path)

Encrypts apiKey, persists pending, signs HMAC callback token, calls
driver.start, transitions to submitted with handle as jobName.
On driver failure, marks the row failed before rethrowing — the
caller sees a 500 and the row state is consistent with reality.
toBenchmarkRunDto strips apiKeyCipher from every response.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: BenchmarkService.list + detail

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

`list` mirrors LoadTestRun's pagination (peek-+1 cursor, `orderBy [{ createdAt: desc }, { id: desc }]`), supports `state` / `profile` / `search` filters, and admin scoping. `detail` returns the full row (still without `apiKeyCipher`).

- [ ] **Step 11.1: Append the failing tests**

Append to `benchmark.service.spec.ts` (inside the same `describe` file, as a new top-level `describe`):

```ts
describe("BenchmarkService.list + detail", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
  });

  function row(over: Partial<{ id: string; name: string; userId: string }> = {}) {
    return {
      id: over.id ?? "r1",
      userId: over.userId ?? user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: "https://x",
      apiType: "chat",
      model: "m",
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: over.name ?? "n",
      description: null,
      state: "running",
      stateMessage: null,
      progress: 0.4,
      jobName: "subprocess:1",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: new Date("2026-04-26T00:00:01Z"),
      completedAt: null,
    };
  }

  it("scopes non-admin queries to the caller's userId", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([row({ id: "a" })]);
    await svc.list({ limit: 20 }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.userId).toBe(user.sub);
  });

  it("admin queries are not scoped by userId", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20 }, { ...user, roles: ["admin"] });
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.userId).toBeUndefined();
  });

  it("returns peek+1 next-cursor when there are more rows", async () => {
    const rows = Array.from({ length: 21 }, (_v, i) => row({ id: `r${i}` }));
    prisma.benchmarkRun.findMany.mockResolvedValue(rows);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.items).toHaveLength(20);
    expect(out.nextCursor).toBe("r19");
  });

  it("nextCursor is null when at the end", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([row({ id: "r0" })]);
    const out = await svc.list({ limit: 20 }, user);
    expect(out.nextCursor).toBeNull();
  });

  it("applies state + profile filters when provided", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, state: "running", profile: "latency" }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.state).toBe("running");
    expect(args.where.profile).toBe("latency");
  });

  it("applies search as case-insensitive name contains", async () => {
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    await svc.list({ limit: 20, search: "Foo" }, user);
    const args = prisma.benchmarkRun.findMany.mock.calls[0][0];
    expect(args.where.name).toEqual({ contains: "Foo", mode: "insensitive" });
  });

  it("detail returns the full row sans apiKeyCipher", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(row({ id: "x" }));
    const dto = await svc.detail("x", user);
    expect(dto.id).toBe("x");
    expect(dto).not.toHaveProperty("apiKeyCipher");
  });

  it("detail returns 404 for non-existent / non-owned rows", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.detail("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 11.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
```
Expected: the new specs FAIL — `svc.list` / `svc.detail` are undefined.

- [ ] **Step 11.3: Add `list` + `detail` to the service**

In `benchmark.service.ts`, also import the list / detail contract types and `NotFoundException`:

```ts
import { Logger, NotFoundException } from "@nestjs/common";
import type {
  BenchmarkRun as BenchmarkRunDto,
  BenchmarkRunSummary,
  BenchmarkState,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
  ListBenchmarksResponse,
} from "@modeldoctor/contracts";
```

Add these methods inside `BenchmarkService`:

```ts
  async list(query: ListBenchmarksQuery, user: JwtPayload): Promise<ListBenchmarksResponse> {
    const limit = query.limit;
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const where: Record<string, unknown> = { ...userScope };
    if (query.state) where.state = query.state;
    if (query.profile) where.profile = query.profile;
    if (query.search) where.name = { contains: query.search, mode: "insensitive" };

    const rows = await this.prisma.benchmarkRun.findMany({
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map(toBenchmarkRunSummary);
    const nextCursor = rows.length > limit ? pageRows[pageRows.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    return toBenchmarkRunDto(row);
  }
```

- [ ] **Step 11.4: Run + commit**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): service.list + detail with user scoping

list mirrors LoadTestRun pagination (peek+1 cursor, createdAt desc,
id tiebreaker). filters: state, profile, search (ILIKE on name).
detail returns 404 when the row doesn't exist or the caller doesn't own
it (admins bypass the userId scope).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: BenchmarkService.cancel

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

Per problem 3 + 7 of the brainstorm. `pending` skips the driver call. `submitted` / `running` calls `driver.cancel(handle)` and **proceeds to mark the row canceled even if cancel throws** (best effort). Terminal states return 400 `BENCHMARK_ALREADY_TERMINAL`. Non-existent / non-owned rows return 404.

- [ ] **Step 12.1: Append the failing tests**

Append to `benchmark.service.spec.ts`:

```ts
describe("BenchmarkService.cancel", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
    prisma.benchmarkRun.update.mockImplementation(async ({ where: { id }, data }) => ({
      id,
      userId: user.sub,
      apiKeyCipher: "<encrypted>",
      apiUrl: "https://x",
      apiType: "chat",
      model: "m",
      profile: "throughput",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      datasetSeed: null,
      requestRate: 0,
      totalRequests: 1000,
      name: "n",
      description: null,
      state: data.state ?? "running",
      stateMessage: data.stateMessage ?? null,
      progress: 0.5,
      jobName: "subprocess:1",
      metricsSummary: null,
      rawMetrics: null,
      logs: null,
      createdAt: new Date("2026-04-26T00:00:00Z"),
      startedAt: new Date("2026-04-26T00:00:01Z"),
      completedAt: data.completedAt ?? null,
    }));
  });

  it("cancel of pending: marks canceled without calling driver", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "pending",
      jobName: null,
    });
    await svc.cancel("r1", user);
    expect(driver.cancel).not.toHaveBeenCalled();
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it("cancel of running: calls driver.cancel and marks canceled", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "running",
      jobName: "subprocess:1",
    });
    await svc.cancel("r1", user);
    expect(driver.cancel).toHaveBeenCalledWith("subprocess:1");
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it("cancel still marks canceled if driver.cancel throws (best effort)", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue({
      id: "r1",
      userId: user.sub,
      state: "running",
      jobName: "subprocess:1",
    });
    driver.cancel.mockRejectedValue(new Error("k8s glitch"));
    await svc.cancel("r1", user);
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("canceled");
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "cancel of terminal state %s rejects with BENCHMARK_ALREADY_TERMINAL",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({
        id: "r1",
        userId: user.sub,
        state,
        jobName: null,
      });
      await expect(svc.cancel("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_ALREADY_TERMINAL" },
        status: 400,
      });
    },
  );

  it("cancel returns 404 for missing / non-owned", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.cancel("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 12.2: Run the test → fail; implement; rerun**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
```
Expected: the new specs FAIL.

Add to `benchmark.service.ts`:

```ts
  async cancel(id: string, user: JwtPayload): Promise<BenchmarkRunDto> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });

    if ((TERMINAL_STATES as readonly string[]).includes(row.state)) {
      throw new BadRequestException({
        code: ErrorCodes.BENCHMARK_ALREADY_TERMINAL,
        message: `Cannot cancel a benchmark in state '${row.state}'`,
      });
    }

    if (row.state !== "pending" && row.jobName) {
      try {
        await this.driver.cancel(row.jobName);
      } catch (e) {
        this.log.warn(
          `driver.cancel threw for ${row.id} (handle ${row.jobName}); marking canceled anyway: ${(e as Error).message}`,
        );
      }
    }

    const updated = await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: { state: "canceled", completedAt: new Date() },
    });
    return toBenchmarkRunDto(updated);
  }
```

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
```
Expected: green.

- [ ] **Step 12.3: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): service.cancel

pending: DB flip only, no driver call. submitted/running: best-effort
driver.cancel — log + continue if it throws (the row reaches terminal
state regardless; reconciler is the safety net). terminal: 400
BENCHMARK_ALREADY_TERMINAL. missing/non-owned: 404.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: BenchmarkService.delete

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

Hard delete. Refuse non-terminal with 409 `BENCHMARK_NOT_TERMINAL` (per design G — user must cancel first). 404 on missing.

- [ ] **Step 13.1: Append failing tests**

```ts
describe("BenchmarkService.delete", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "deletes terminal-state row %s",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({ id: "r1", userId: user.sub, state });
      prisma.benchmarkRun.delete.mockResolvedValue({});
      await svc.delete("r1", user);
      expect(prisma.benchmarkRun.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    },
  );

  it.each(["pending", "submitted", "running"] as const)(
    "rejects delete of non-terminal state %s with BENCHMARK_NOT_TERMINAL",
    async (state) => {
      prisma.benchmarkRun.findFirst.mockResolvedValue({ id: "r1", userId: user.sub, state });
      await expect(svc.delete("r1", user)).rejects.toMatchObject({
        response: { code: "BENCHMARK_NOT_TERMINAL" },
        status: 409,
      });
      expect(prisma.benchmarkRun.delete).not.toHaveBeenCalled();
    },
  );

  it("returns 404 for missing / non-owned", async () => {
    prisma.benchmarkRun.findFirst.mockResolvedValue(null);
    await expect(svc.delete("missing", user)).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 13.2: Implement, test, commit**

Add to `benchmark.service.ts`:

```ts
  async delete(id: string, user: JwtPayload): Promise<void> {
    const userScope = user.roles.includes("admin") ? {} : { userId: user.sub };
    const row = await this.prisma.benchmarkRun.findFirst({ where: { id, ...userScope } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "benchmark not found" });
    if (!(TERMINAL_STATES as readonly string[]).includes(row.state)) {
      throw new ConflictException({
        code: ErrorCodes.BENCHMARK_NOT_TERMINAL,
        message: `Cannot delete a benchmark in state '${row.state}'. Cancel it first.`,
      });
    }
    await this.prisma.benchmarkRun.delete({ where: { id: row.id } });
  }
```

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): service.delete (terminal only)

Hard delete; non-terminal rows return 409 BENCHMARK_NOT_TERMINAL with a
hint to cancel first. K8s Job is already TTL-GC'd by the time the row
becomes terminal, so no driver work is needed here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: BenchmarkService callback handlers (state + metrics)

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`

Implements the 6 branches of `handleStateCallback` (problem 3) and the always-write semantics of `handleMetricsCallback`.

State callback decision table (input `body.state` vs current `row.state`):

| body \ row | pending | submitted | running | completed | failed | canceled |
|---|---|---|---|---|---|---|
| running | UPDATE→running | UPDATE→running | silent ok | silent warn (no rollback) | silent warn | silent warn |
| completed | (n/a — no driver yet) | UPDATE→completed | UPDATE→completed | silent ok | silent warn | silent warn |
| failed | (n/a) | UPDATE→failed | UPDATE→failed | silent warn | silent ok | silent warn |

Missing row → silent ok (200) + warn log.

- [ ] **Step 14.1: Append failing tests**

```ts
describe("BenchmarkService.handleStateCallback", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
  });

  it("missing row: returns silently without UPDATE", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue(null);
    await svc.handleStateCallback("missing", { state: "running" });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("submitted → running: UPDATE state and progress", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "submitted" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleStateCallback("r1", { state: "running", progress: 0.1 });
    expect(prisma.benchmarkRun.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { state: "running", progress: 0.1, stateMessage: null },
    });
  });

  it("running → running (duplicate): no UPDATE", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    await svc.handleStateCallback("r1", { state: "running" });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("running → completed: UPDATE with completedAt", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleStateCallback("r1", { state: "completed", progress: 1 });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.state).toBe("completed");
    expect(args.data.completedAt).toBeInstanceOf(Date);
    expect(args.data.progress).toBe(1);
  });

  it.each(["completed", "failed", "canceled"] as const)(
    "%s → running: silent warn, no UPDATE (forward-only)",
    async (state) => {
      prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state });
      await svc.handleStateCallback("r1", { state: "running" });
      expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
    },
  );

  it("running → failed: UPDATE with stateMessage truncated to 2048 chars", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "running" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    const huge = "x".repeat(5000);
    await svc.handleStateCallback("r1", { state: "failed", stateMessage: huge });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.state).toBe("failed");
    expect((args.data.stateMessage as string).length).toBeLessThanOrEqual(2048);
  });
});

describe("BenchmarkService.handleMetricsCallback", () => {
  let prisma: PrismaStub;
  let driver: ReturnType<typeof buildDriver>;
  let svc: BenchmarkService;

  const summary = {
    ttft: { mean: 1, p50: 1, p95: 2, p99: 3 },
    itl: { mean: 1, p50: 1, p95: 2, p99: 3 },
    e2eLatency: { mean: 1, p50: 1, p95: 2, p99: 3 },
    requestsPerSecond: { mean: 10 },
    outputTokensPerSecond: { mean: 100 },
    inputTokensPerSecond: { mean: 50 },
    totalTokensPerSecond: { mean: 150 },
    concurrency: { mean: 1, max: 1 },
    requests: { total: 100, success: 99, error: 1, incomplete: 0 },
  };

  beforeEach(() => {
    prisma = buildPrisma();
    driver = buildDriver();
    svc = new BenchmarkService(prisma as never, driver, buildConfig());
  });

  it("writes metrics regardless of state (forensic value)", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue({ id: "r1", state: "failed" });
    prisma.benchmarkRun.update.mockResolvedValue({});
    await svc.handleMetricsCallback("r1", {
      metricsSummary: summary,
      rawMetrics: { foo: 1 },
      logs: "tail",
    });
    const args = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(args.data.metricsSummary).toEqual(summary);
    expect(args.data.rawMetrics).toEqual({ foo: 1 });
    expect(args.data.logs).toBe("tail");
    // state was NOT touched
    expect(args.data.state).toBeUndefined();
  });

  it("missing row: silent ok", async () => {
    prisma.benchmarkRun.findUnique.mockResolvedValue(null);
    await svc.handleMetricsCallback("missing", {
      metricsSummary: summary,
      rawMetrics: null,
    });
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 14.2: Implement the handlers**

Add imports as needed (`BenchmarkMetricsCallback`, `BenchmarkStateCallback` from contracts) and these methods to `BenchmarkService`:

```ts
  async handleStateCallback(id: string, body: BenchmarkStateCallback): Promise<void> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id } });
    if (!row) {
      this.log.warn(`state callback for missing run ${id}; ignoring`);
      return;
    }
    const cur = row.state as BenchmarkState;
    const next = body.state;

    // Forward-only: a callback cannot drag a terminal row backwards.
    const isTerminal = (TERMINAL_STATES as readonly string[]).includes(cur);
    if (isTerminal) {
      this.log.warn(
        `state callback ${next} for already-terminal run ${id} (current=${cur}); ignoring`,
      );
      return;
    }

    if (next === "running") {
      if (cur === "running") return; // duplicate ok
      await this.prisma.benchmarkRun.update({
        where: { id },
        data: {
          state: "running",
          progress: body.progress ?? null,
          stateMessage: null,
        },
      });
      return;
    }

    if (next === "completed" || next === "failed") {
      await this.prisma.benchmarkRun.update({
        where: { id },
        data: {
          state: next,
          stateMessage: body.stateMessage?.slice(0, 2048) ?? null,
          progress: body.progress ?? null,
          completedAt: new Date(),
        },
      });
      return;
    }
    // Other inbound values (e.g. "canceled") aren't expected from the runner;
    // ignore them.
  }

  async handleMetricsCallback(id: string, body: BenchmarkMetricsCallback): Promise<void> {
    const row = await this.prisma.benchmarkRun.findUnique({ where: { id } });
    if (!row) {
      this.log.warn(`metrics callback for missing run ${id}; ignoring`);
      return;
    }
    await this.prisma.benchmarkRun.update({
      where: { id },
      data: {
        metricsSummary: body.metricsSummary,
        rawMetrics: body.rawMetrics ?? null,
        logs: body.logs ?? null,
      },
    });
  }
```

- [ ] **Step 14.3: Run + commit**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): service callback handlers

handleStateCallback: forward-only state machine — terminal rows are
never dragged back. Duplicate state=running is silent ok. Missing
row is silent + warn (don't make the runner retry).

handleMetricsCallback: always writes metricsSummary / rawMetrics /
logs even after terminal — the data has forensic value and we never
need to discard it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: BenchmarkController (user-facing CRUD)

**Files:**
- Create: `apps/api/src/modules/benchmark/benchmark.controller.ts`
- Create: `apps/api/src/modules/benchmark/benchmark.controller.spec.ts`

Mirrors LoadTestController shape: `ZodValidationPipe` + `createZodDto` + `@CurrentUser()`. JWT-protected (no `@Public()`). All routes under `benchmarks` prefix.

- [ ] **Step 15.1: Write the failing test**

Create `apps/api/src/modules/benchmark/benchmark.controller.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_GUARD } from "@nestjs/core";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";

const fakeUser = { sub: "u1", roles: [] };

class StubJwtGuard {
  canActivate(ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) {
    ctx.switchToHttp().getRequest().user = fakeUser;
    return true;
  }
}

describe("BenchmarkController", () => {
  let app: import("@nestjs/common").INestApplication;
  let svc: { create: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = {
      create: vi.fn(),
      list: vi.fn(),
      detail: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [BenchmarkController],
      providers: [
        { provide: BenchmarkService, useValue: svc },
        { provide: PrismaService, useValue: {} },
        { provide: BENCHMARK_DRIVER, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: APP_GUARD, useClass: StubJwtGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /benchmarks: 201/200 with the row body", async () => {
    svc.create.mockResolvedValue({ id: "r1", state: "submitted" });
    const body = {
      name: "n",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "https://x.com",
      apiKey: "sk",
      model: "m",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    };
    const res = await request(app.getHttpServer()).post("/benchmarks").send(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "r1", state: "submitted" });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining(body), fakeUser);
  });

  it("POST /benchmarks: 400 on Zod validation failure", async () => {
    const res = await request(app.getHttpServer())
      .post("/benchmarks")
      .send({ name: "" });
    expect(res.status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("GET /benchmarks: parses query through Zod and forwards to svc.list", async () => {
    svc.list.mockResolvedValue({ items: [], nextCursor: null });
    const res = await request(app.getHttpServer())
      .get("/benchmarks")
      .query({ limit: 10, state: "running" });
    expect(res.status).toBe(200);
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, state: "running" }),
      fakeUser,
    );
  });

  it("GET /benchmarks/:id: forwards to svc.detail", async () => {
    svc.detail.mockResolvedValue({ id: "r1" });
    const res = await request(app.getHttpServer()).get("/benchmarks/r1");
    expect(res.status).toBe(200);
    expect(svc.detail).toHaveBeenCalledWith("r1", fakeUser);
  });

  it("POST /benchmarks/:id/cancel: forwards to svc.cancel", async () => {
    svc.cancel.mockResolvedValue({ id: "r1", state: "canceled" });
    const res = await request(app.getHttpServer()).post("/benchmarks/r1/cancel");
    expect(res.status).toBe(201);
    expect(svc.cancel).toHaveBeenCalledWith("r1", fakeUser);
  });

  it("DELETE /benchmarks/:id: 204", async () => {
    svc.delete.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer()).delete("/benchmarks/r1");
    expect(res.status).toBe(204);
    expect(svc.delete).toHaveBeenCalledWith("r1", fakeUser);
  });
});
```

If `supertest` is not yet a devDep:

```bash
pnpm -F @modeldoctor/api add -D supertest @types/supertest
```

- [ ] **Step 15.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark.controller
```
Expected: FAIL — controller module not found.

- [ ] **Step 15.3: Implement `benchmark.controller.ts`**

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import {
  BenchmarkRunSchema,
  type BenchmarkRun,
  type CreateBenchmarkRequest,
  CreateBenchmarkRequestSchema,
  type ListBenchmarksQuery,
  ListBenchmarksQuerySchema,
  type ListBenchmarksResponse,
  ListBenchmarksResponseSchema,
} from "@modeldoctor/contracts";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { BenchmarkService } from "./benchmark.service.js";

class CreateBenchmarkRequestDto extends createZodDto(CreateBenchmarkRequestSchema) {}
class BenchmarkRunDto extends createZodDto(BenchmarkRunSchema) {}
class ListBenchmarksResponseDto extends createZodDto(ListBenchmarksResponseSchema) {}

@ApiTags("benchmark")
@Controller("benchmarks")
export class BenchmarkController {
  constructor(private readonly svc: BenchmarkService) {}

  @ApiOperation({ summary: "Create a benchmark run" })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Post()
  create(
    @Body(new ZodValidationPipe(CreateBenchmarkRequestSchema))
    body: CreateBenchmarkRequest,
    @CurrentUser() user: JwtPayload,
  ): Promise<BenchmarkRun> {
    return this.svc.create(body, user);
  }

  @ApiOperation({ summary: "List benchmark runs (cursor-paginated, newest first)" })
  @ApiOkResponse({ type: ListBenchmarksResponseDto })
  @Get()
  list(
    @Query(new ZodValidationPipe(ListBenchmarksQuerySchema))
    query: ListBenchmarksQuery,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListBenchmarksResponse> {
    return this.svc.list(query, user);
  }

  @ApiOperation({ summary: "Fetch a benchmark run" })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<BenchmarkRun> {
    return this.svc.detail(id, user);
  }

  @ApiOperation({ summary: "Cancel an in-flight benchmark run" })
  @ApiOkResponse({ type: BenchmarkRunDto })
  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<BenchmarkRun> {
    return this.svc.cancel(id, user);
  }

  @ApiOperation({ summary: "Delete a terminal benchmark run" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.svc.delete(id, user);
  }
}
```

- [ ] **Step 15.4: Run the test, lint, type-check, commit**

```bash
pnpm -F @modeldoctor/api test -- benchmark.controller
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.controller.ts \
        apps/api/src/modules/benchmark/benchmark.controller.spec.ts
git add apps/api/package.json pnpm-lock.yaml 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(api/benchmark): user-facing CRUD controller

Routes under /benchmarks: POST (create), GET (list), GET/:id (detail),
POST/:id/cancel, DELETE/:id (204). Mirrors LoadTestController's
ZodValidationPipe + CurrentUser shape. JWT-protected via the global
guard; supertest specs cover happy paths and Zod validation failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: BenchmarkCallbackController (internal HMAC-authenticated)

**Files:**
- Create: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`
- Create: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts`

Two routes under `/api/internal/benchmarks/:id/{state,metrics}`. Annotated `@Public()` so the global JWT guard skips them; `@UseGuards(HmacCallbackGuard)` applies the HMAC check. Both return 200 with no body (the runner doesn't care about the response shape, only the status code).

- [ ] **Step 16.1: Write the failing test**

```ts
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { BenchmarkCallbackController } from "./benchmark-callback.controller.js";
import { BenchmarkService } from "../benchmark.service.js";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";
import { signCallbackToken } from "./hmac-token.js";

const SECRET = randomBytes(32);

describe("BenchmarkCallbackController", () => {
  let app: import("@nestjs/common").INestApplication;
  let svc: { handleStateCallback: ReturnType<typeof vi.fn>; handleMetricsCallback: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = {
      handleStateCallback: vi.fn(async () => undefined),
      handleMetricsCallback: vi.fn(async () => undefined),
    };
    const module = await Test.createTestingModule({
      controllers: [BenchmarkCallbackController],
      providers: [
        { provide: BenchmarkService, useValue: svc },
        HmacCallbackGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              k === "BENCHMARK_CALLBACK_SECRET" ? SECRET.toString("utf8") : undefined,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it("POST state with valid HMAC: 200 + svc called", async () => {
    const id = "r1";
    const tok = signCallbackToken(id, SECRET, 600);
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/${id}/state`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "running", progress: 0.1 });
    expect(res.status).toBe(200);
    expect(svc.handleStateCallback).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ state: "running", progress: 0.1 }),
    );
  });

  it("POST state without Authorization: 401 + svc NOT called", async () => {
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/r1/state`)
      .send({ state: "running" });
    expect(res.status).toBe(401);
    expect(svc.handleStateCallback).not.toHaveBeenCalled();
  });

  it("POST state with token signed for a different id: 401", async () => {
    const tok = signCallbackToken("other", SECRET, 600);
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/r1/state`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "running" });
    expect(res.status).toBe(401);
  });

  it("POST state with bad payload: 400", async () => {
    const tok = signCallbackToken("r1", SECRET, 600);
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/r1/state`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ state: "bogus" });
    expect(res.status).toBe(400);
  });

  it("POST metrics with valid HMAC: 200 + svc called", async () => {
    const tok = signCallbackToken("r1", SECRET, 600);
    const summary = {
      ttft: { mean: 1, p50: 1, p95: 2, p99: 3 },
      itl: { mean: 1, p50: 1, p95: 2, p99: 3 },
      e2eLatency: { mean: 1, p50: 1, p95: 2, p99: 3 },
      requestsPerSecond: { mean: 10 },
      outputTokensPerSecond: { mean: 100 },
      inputTokensPerSecond: { mean: 50 },
      totalTokensPerSecond: { mean: 150 },
      concurrency: { mean: 1, max: 1 },
      requests: { total: 100, success: 99, error: 1, incomplete: 0 },
    };
    const res = await request(app.getHttpServer())
      .post(`/internal/benchmarks/r1/metrics`)
      .set("Authorization", `Bearer ${tok}`)
      .send({ metricsSummary: summary, rawMetrics: { foo: 1 }, logs: "tail" });
    expect(res.status).toBe(200);
    expect(svc.handleMetricsCallback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 16.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark-callback.controller
```
Expected: FAIL — controller module not found.

- [ ] **Step 16.3: Implement `benchmark-callback.controller.ts`**

```ts
import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type BenchmarkMetricsCallback,
  BenchmarkMetricsCallbackSchema,
  type BenchmarkStateCallback,
  BenchmarkStateCallbackSchema,
} from "@modeldoctor/contracts";
import { Public } from "../../../common/decorators/public.decorator.js";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe.js";
import { BenchmarkService } from "../benchmark.service.js";
import { HmacCallbackGuard } from "./hmac-callback.guard.js";

@ApiTags("benchmark-callback")
@Controller("internal/benchmarks")
export class BenchmarkCallbackController {
  constructor(private readonly svc: BenchmarkService) {}

  @ApiOperation({ summary: "Runner-pod state callback" })
  @Public()
  @UseGuards(HmacCallbackGuard)
  @HttpCode(HttpStatus.OK)
  @Post(":id/state")
  async state(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(BenchmarkStateCallbackSchema))
    body: BenchmarkStateCallback,
  ): Promise<void> {
    await this.svc.handleStateCallback(id, body);
  }

  @ApiOperation({ summary: "Runner-pod metrics callback (final)" })
  @Public()
  @UseGuards(HmacCallbackGuard)
  @HttpCode(HttpStatus.OK)
  @Post(":id/metrics")
  async metrics(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(BenchmarkMetricsCallbackSchema))
    body: BenchmarkMetricsCallback,
  ): Promise<void> {
    await this.svc.handleMetricsCallback(id, body);
  }
}
```

- [ ] **Step 16.4: Run + lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api test -- benchmark-callback.controller
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts \
        apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): internal callback controller

POST /api/internal/benchmarks/:id/state and /metrics. @Public() bypasses
the global JWT guard; @UseGuards(HmacCallbackGuard) is the auth.
Status 200 on success — runner ignores body. Zod validation on each
body schema gives 400 on shape errors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: BenchmarkReconciler (cron + branching by driver)

**Files:**
- Create: `apps/api/src/modules/benchmark/benchmark.reconciler.ts`
- Create: `apps/api/src/modules/benchmark/benchmark.reconciler.spec.ts`

Cron schedule `*/30 * * * * *`. Three checks per spec §7:
1. **Runaway timeout** (both drivers): `state ∈ {submitted, running}` with `now - startedAt > maxDurationSeconds` → `driver.cancel(handle)` + UPDATE state=failed, message="exceeded max duration".
2. **K8s only — Job missing**: `state ∈ {submitted, running}` and `driver=k8s` and `readNamespacedJob` 404 → UPDATE state=failed, message="job vanished".
3. **K8s only — Pod terminated nonzero**: Job exists with `status.failed > 0` → look up the pod, read its termination reason → UPDATE state=failed with that reason.

Skip rows whose `createdAt` is within the last 5 seconds (newly created, race with `start()`).
Short-circuit when `NODE_ENV === 'test'` to avoid timer noise.

The reconciler instantiates a K8s reader independently (it doesn't need the full driver — only `readNamespacedJob` + `listNamespacedPod`). For simplicity, expose a tiny optional `K8sReader` interface and inject it via the same factory pattern used for the driver.

To keep this task tractable, the reconciler in this PR implements:
- check 1 (runaway timeout) — both drivers
- check 2 (Job missing in k8s) — only when driver type is `k8s`

Pod-failure reason extraction (check 3) ships, but ONLY when the K8s reader is available. We do not introduce a separate factory for the reader — the reconciler accepts an optional `BenchmarkK8sReader` provider that can be `null` in subprocess mode.

- [ ] **Step 17.1: Write the failing test**

Create `apps/api/src/modules/benchmark/benchmark.reconciler.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";
import { BenchmarkReconciler, type BenchmarkK8sReader } from "./benchmark.reconciler.js";

const NOW = new Date("2026-04-26T12:00:00Z");

function buildPrisma() {
  return {
    benchmarkRun: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function buildDriver(): BenchmarkExecutionDriver & {
  cancel: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(),
    cancel: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
  };
}

function buildConfig(over: Record<string, unknown> = {}): ConfigService {
  return {
    get: (k: string) => {
      const map: Record<string, unknown> = {
        BENCHMARK_DRIVER: "subprocess",
        BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: 60,
        BENCHMARK_K8S_NAMESPACE: "modeldoctor-benchmarks",
        ...over,
      };
      return map[k];
    },
  } as unknown as ConfigService;
}

describe("BenchmarkReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing when there are no active rows", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(prisma as never, drv, buildConfig(), null);
    await r.reconcile();
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("subprocess: marks runaway-timeout row failed and calls driver.cancel", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([
      {
        id: "r1",
        state: "running",
        jobName: "subprocess:1",
        startedAt: new Date(NOW.getTime() - 120_000), // 2min old, > 60s default
        createdAt: new Date(NOW.getTime() - 120_000),
      },
    ]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(prisma as never, drv, buildConfig(), null);
    await r.reconcile();
    expect(drv.cancel).toHaveBeenCalledWith("subprocess:1");
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("failed");
    expect(upd.data.stateMessage).toMatch(/exceeded max duration/);
  });

  it("skips rows newer than 5 seconds (race with create)", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([
      {
        id: "r1",
        state: "submitted",
        jobName: "subprocess:1",
        startedAt: new Date(NOW.getTime() - 1_000),
        createdAt: new Date(NOW.getTime() - 1_000),
      },
    ]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(prisma as never, drv, buildConfig(), null);
    await r.reconcile();
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });

  it("k8s: marks failed when readNamespacedJob 404s", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([
      {
        id: "r1",
        state: "running",
        jobName: "modeldoctor-benchmarks/benchmark-r1",
        startedAt: new Date(NOW.getTime() - 30_000),
        createdAt: new Date(NOW.getTime() - 30_000),
      },
    ]);
    const reader: BenchmarkK8sReader = {
      readJob: vi.fn(async () => {
        const e = new Error("not found") as Error & { statusCode: number };
        e.statusCode = 404;
        throw e;
      }),
      listJobPods: vi.fn(),
    };
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig({ BENCHMARK_DRIVER: "k8s" }),
      reader,
    );
    await r.reconcile();
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("failed");
    expect(upd.data.stateMessage).toMatch(/vanished/i);
  });

  it("k8s: marks failed with reason when pod terminated nonzero", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([
      {
        id: "r1",
        state: "running",
        jobName: "modeldoctor-benchmarks/benchmark-r1",
        startedAt: new Date(NOW.getTime() - 30_000),
        createdAt: new Date(NOW.getTime() - 30_000),
      },
    ]);
    const reader: BenchmarkK8sReader = {
      readJob: vi.fn(async () => ({ status: { failed: 1 } })),
      listJobPods: vi.fn(async () => [
        {
          status: {
            containerStatuses: [
              {
                state: { terminated: { reason: "OOMKilled", exitCode: 137 } },
              },
            ],
          },
        },
      ]),
    };
    const drv = buildDriver();
    const r = new BenchmarkReconciler(
      prisma as never,
      drv,
      buildConfig({ BENCHMARK_DRIVER: "k8s" }),
      reader,
    );
    await r.reconcile();
    const upd = prisma.benchmarkRun.update.mock.calls[0][0];
    expect(upd.data.state).toBe("failed");
    expect(upd.data.stateMessage).toMatch(/OOMKilled|exit ?137/);
  });

  it("idempotent: re-running with already-terminal rows does nothing", async () => {
    const prisma = buildPrisma();
    prisma.benchmarkRun.findMany.mockResolvedValue([]);
    const drv = buildDriver();
    const r = new BenchmarkReconciler(prisma as never, drv, buildConfig(), null);
    await r.reconcile();
    await r.reconcile();
    expect(prisma.benchmarkRun.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 17.2: Run the test to verify it fails**

```bash
pnpm -F @modeldoctor/api test -- benchmark.reconciler
```
Expected: FAIL — module not found.

- [ ] **Step 17.3: Implement `benchmark.reconciler.ts`**

```ts
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  BENCHMARK_DRIVER,
} from "./drivers/benchmark-driver.token.js";
import type { BenchmarkExecutionDriver } from "./drivers/execution-driver.interface.js";

export interface BenchmarkK8sReader {
  readJob(name: string, namespace: string): Promise<{ status?: { failed?: number } }>;
  listJobPods(
    name: string,
    namespace: string,
  ): Promise<Array<{ status?: { containerStatuses?: Array<{ state?: { terminated?: { reason?: string; exitCode?: number; message?: string } } }> } }>>;
}

export const BENCHMARK_K8S_READER = Symbol("BENCHMARK_K8S_READER");

const ACTIVE_STATES = ["submitted", "running"] as const;
const RACE_GUARD_MS = 5_000;

@Injectable()
export class BenchmarkReconciler {
  private readonly log = new Logger(BenchmarkReconciler.name);
  private readonly driverKind: string;
  private readonly maxDuration: number;
  private readonly namespace: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENCHMARK_DRIVER) private readonly driver: BenchmarkExecutionDriver,
    config: ConfigService<Env, true>,
    @Optional()
    @Inject(BENCHMARK_K8S_READER)
    private readonly reader: BenchmarkK8sReader | null,
  ) {
    this.driverKind = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
    this.maxDuration = config.get("BENCHMARK_DEFAULT_MAX_DURATION_SECONDS", {
      infer: true,
    }) as number;
    this.namespace = (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) ??
      "modeldoctor-benchmarks") as string;
  }

  @Cron("*/30 * * * * *")
  async tick(): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    try {
      await this.reconcile();
    } catch (e) {
      this.log.error(`reconciler tick failed: ${(e as Error).message}`);
    }
  }

  async reconcile(): Promise<void> {
    const now = Date.now();
    const rows = (await this.prisma.benchmarkRun.findMany({
      where: { state: { in: [...ACTIVE_STATES] } },
    })) as Array<{
      id: string;
      state: string;
      jobName: string | null;
      startedAt: Date | null;
      createdAt: Date;
    }>;

    for (const row of rows) {
      // Race guard: a row created in the last 5s may be mid-`start()`.
      if (now - row.createdAt.getTime() < RACE_GUARD_MS) continue;

      const ageMs = row.startedAt ? now - row.startedAt.getTime() : 0;
      if (row.startedAt && ageMs > this.maxDuration * 1000) {
        await this.markRunaway(row);
        continue;
      }

      if (this.driverKind === "k8s" && this.reader && row.jobName) {
        await this.checkK8sJob(row);
      }
    }
  }

  private async markRunaway(row: { id: string; jobName: string | null }): Promise<void> {
    if (row.jobName) {
      try {
        await this.driver.cancel(row.jobName);
      } catch (e) {
        this.log.warn(`cancel during runaway mark for ${row.id} failed: ${(e as Error).message}`);
      }
    }
    await this.prisma.benchmarkRun.update({
      where: { id: row.id },
      data: {
        state: "failed",
        stateMessage: "exceeded max duration",
        completedAt: new Date(),
      },
    });
  }

  private async checkK8sJob(row: { id: string; jobName: string | null }): Promise<void> {
    if (!this.reader || !row.jobName) return;
    const slash = row.jobName.indexOf("/");
    const ns = slash > 0 ? row.jobName.slice(0, slash) : this.namespace;
    const name = slash > 0 ? row.jobName.slice(slash + 1) : row.jobName;
    let job: { status?: { failed?: number } } | null = null;
    try {
      job = await this.reader.readJob(name, ns);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404) {
        await this.prisma.benchmarkRun.update({
          where: { id: row.id },
          data: {
            state: "failed",
            stateMessage: "job vanished",
            completedAt: new Date(),
          },
        });
        return;
      }
      this.log.warn(`readJob failed for ${row.id}: ${(e as Error).message}`);
      return;
    }
    if (job?.status?.failed && job.status.failed > 0) {
      let reason = "pod failed";
      try {
        const pods = await this.reader.listJobPods(name, ns);
        const term = pods[0]?.status?.containerStatuses?.[0]?.state?.terminated;
        if (term) {
          const r = term.reason ?? "Unknown";
          const ec = term.exitCode ?? -1;
          reason = `pod failed: ${r} (exit ${ec})`;
        }
      } catch (e) {
        this.log.warn(`listJobPods failed for ${row.id}: ${(e as Error).message}`);
      }
      await this.prisma.benchmarkRun.update({
        where: { id: row.id },
        data: {
          state: "failed",
          stateMessage: reason.slice(0, 2048),
          completedAt: new Date(),
        },
      });
    }
  }
}
```

- [ ] **Step 17.4: Run + lint + type-check + commit**

```bash
pnpm -F @modeldoctor/api test -- benchmark.reconciler
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
git add apps/api/src/modules/benchmark/benchmark.reconciler.ts \
        apps/api/src/modules/benchmark/benchmark.reconciler.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): reconciler cron (30s)

Three checks per spec §7:
1. Runaway timeout (both drivers): cancel + mark failed.
2. K8s Job missing (k8s only): mark failed "job vanished".
3. K8s Pod terminated nonzero (k8s only): mark failed with reason.

Race guard skips rows < 5s old (avoid colliding with create path).
Short-circuits in NODE_ENV=test so vitest doesn't start a real timer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: BenchmarkModule wiring + K8sReader provider

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/k8s-reader.factory.ts`
- Create: `apps/api/src/modules/benchmark/benchmark.module.ts`

The K8s reader is the read-only counterpart to `K8sJobDriver`, used by the reconciler. It shares `loadFromDefault()` config but only reads. The factory returns `null` in subprocess mode so `@Optional()` injection works.

The module composes:
- Controllers: `BenchmarkController`, `BenchmarkCallbackController`
- Providers: `BenchmarkService`, `BenchmarkReconciler`, `HmacCallbackGuard`, `BENCHMARK_DRIVER` (factory), `BENCHMARK_K8S_READER` (factory)

- [ ] **Step 18.1: Create the K8s reader factory**

`apps/api/src/modules/benchmark/drivers/k8s-reader.factory.ts`:

```ts
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema.js";
import type { BenchmarkK8sReader } from "../benchmark.reconciler.js";

async function loadK8sClient(): Promise<typeof import("@kubernetes/client-node")> {
  const stub = (globalThis as { __test_kc_loader__?: () => unknown }).__test_kc_loader__;
  if (stub) return stub() as typeof import("@kubernetes/client-node");
  return await import("@kubernetes/client-node");
}

export async function createBenchmarkK8sReader(
  config: ConfigService<Env, true>,
): Promise<BenchmarkK8sReader | null> {
  const driver = (config.get("BENCHMARK_DRIVER", { infer: true }) ?? "subprocess") as string;
  if (driver !== "k8s") return null;
  const k8s = await loadK8sClient();
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const batch = kc.makeApiClient(k8s.BatchV1Api);
  const core = kc.makeApiClient(k8s.CoreV1Api);
  return {
    async readJob(name, namespace) {
      const res = await batch.readNamespacedJob(name, namespace);
      return (res as { body?: { status?: { failed?: number } } }).body ?? {};
    },
    async listJobPods(name, namespace) {
      const res = await core.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        `job-name=${name}`,
      );
      const items = (res as { body?: { items?: unknown[] } }).body?.items ?? [];
      return items as Awaited<ReturnType<BenchmarkK8sReader["listJobPods"]>>;
    },
  };
}
```

- [ ] **Step 18.2: Create the module**

`apps/api/src/modules/benchmark/benchmark.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseModule } from "../../database/database.module.js";
import type { Env } from "../../config/env.schema.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkReconciler, BENCHMARK_K8S_READER } from "./benchmark.reconciler.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { HmacCallbackGuard } from "./callbacks/hmac-callback.guard.js";
import { BENCHMARK_DRIVER } from "./drivers/benchmark-driver.token.js";
import { createBenchmarkDriver } from "./drivers/driver.factory.js";
import { createBenchmarkK8sReader } from "./drivers/k8s-reader.factory.js";

@Module({
  imports: [DatabaseModule],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    BenchmarkService,
    BenchmarkReconciler,
    HmacCallbackGuard,
    {
      provide: BENCHMARK_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createBenchmarkDriver(config),
    },
    {
      provide: BENCHMARK_K8S_READER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createBenchmarkK8sReader(config),
    },
  ],
})
export class BenchmarkModule {}
```

- [ ] **Step 18.3: Verify compile + commit**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api test
git add apps/api/src/modules/benchmark/benchmark.module.ts \
        apps/api/src/modules/benchmark/drivers/k8s-reader.factory.ts
git commit -m "$(cat <<'EOF'
feat(api/benchmark): wire BenchmarkModule

Module composes BenchmarkController, BenchmarkCallbackController,
BenchmarkService, BenchmarkReconciler, HmacCallbackGuard, and the two
async factories: BENCHMARK_DRIVER (subprocess|k8s) and BENCHMARK_K8S_READER
(null in subprocess mode, real reader in k8s mode). Both factories use
dynamic @kubernetes/client-node import so subprocess sessions don't load
the package.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Register BenchmarkModule + ScheduleModule in AppModule

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 19.1: Add the imports**

Edit `apps/api/src/app.module.ts`:

1. Add the import lines:

```ts
import { ScheduleModule } from "@nestjs/schedule";
import { BenchmarkModule } from "./modules/benchmark/benchmark.module.js";
```

2. Add `ScheduleModule.forRoot()` and `BenchmarkModule` to the `imports` array (placement: anywhere alongside other feature modules; conventional spot is after `LoadTestModule`):

```ts
    LoadTestModule,
    BenchmarkModule,
    ScheduleModule.forRoot(),
    UsersModule,
```

- [ ] **Step 19.2: Verify**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api lint
```
Expected: green. The reconciler's `tick()` short-circuits in `NODE_ENV=test`, so the test suite still terminates normally.

- [ ] **Step 19.3: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api): register BenchmarkModule + ScheduleModule

ScheduleModule.forRoot() activates the @Cron decorator; BenchmarkModule
brings the controllers, service, reconciler, and driver providers
online. Reconciler tick is no-op in NODE_ENV=test so vitest still exits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: K8s RBAC manifest + deploy README

**Files:**
- Create: `deploy/k8s/rbac.yaml`
- Create: `deploy/k8s/README.md`

- [ ] **Step 20.1: Create the directory + RBAC manifest**

```bash
mkdir -p deploy/k8s
```

`deploy/k8s/rbac.yaml`:

```yaml
# RBAC required by the ModelDoctor API to manage benchmark Jobs.
#
# Scope: namespace-bound (modeldoctor-benchmarks). No cluster-wide perms.
# The API runs as ServiceAccount modeldoctor-api in namespace `modeldoctor`
# (rename to match your actual API namespace before applying).

apiVersion: v1
kind: Namespace
metadata:
  name: modeldoctor-benchmarks
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: modeldoctor-api
  namespace: modeldoctor
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: modeldoctor-benchmark-driver
  namespace: modeldoctor-benchmarks
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "get", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: modeldoctor-benchmark-driver
  namespace: modeldoctor-benchmarks
subjects:
  - kind: ServiceAccount
    name: modeldoctor-api
    namespace: modeldoctor
roleRef:
  kind: Role
  name: modeldoctor-benchmark-driver
  apiGroup: rbac.authorization.k8s.io
```

- [ ] **Step 20.2: Write the README**

`deploy/k8s/README.md`:

```markdown
# Kubernetes deploy artifacts

## RBAC for the benchmark feature

`rbac.yaml` declares the namespace `modeldoctor-benchmarks` (where benchmark
Jobs and Secrets land), the ServiceAccount `modeldoctor-api` in namespace
`modeldoctor`, a Role scoped to the benchmarks namespace, and a RoleBinding
that grants the API SA the role.

If your API is deployed to a namespace other than `modeldoctor`, edit
`RoleBinding.subjects[0].namespace` and the `ServiceAccount.metadata.namespace`
before applying.

```bash
kubectl apply -f deploy/k8s/rbac.yaml
```

Verify with:

```bash
kubectl -n modeldoctor-benchmarks describe role modeldoctor-benchmark-driver
kubectl -n modeldoctor-benchmarks describe rolebinding modeldoctor-benchmark-driver
kubectl auth can-i create jobs --as=system:serviceaccount:modeldoctor:modeldoctor-api -n modeldoctor-benchmarks
```

## Local k3d acceptance

```bash
k3d cluster create modeldoctor
kubectl create namespace modeldoctor
kubectl apply -f deploy/k8s/rbac.yaml
docker pull gpustack/benchmark-runner:v0.0.4
k3d image import gpustack/benchmark-runner:v0.0.4 -c modeldoctor
```

Then in your API env:

```bash
export BENCHMARK_DRIVER=k8s
export BENCHMARK_RUNNER_IMAGE=gpustack/benchmark-runner:v0.0.4
export BENCHMARK_K8S_NAMESPACE=modeldoctor-benchmarks
export BENCHMARK_CALLBACK_URL=http://host.k3d.internal:3001
pnpm -F @modeldoctor/api start:dev
```

`host.k3d.internal` is how a pod inside the cluster reaches the dev machine
(use `host.docker.internal` if you're on kind + Docker Desktop). No tunnel
required.
```

- [ ] **Step 20.3: Validate the YAML**

```bash
kubectl --dry-run=client apply -f deploy/k8s/rbac.yaml
```
Expected: 4 lines of `<resource>/<name> created (dry run)`. If you don't have a kubeconfig handy, `kubectl --dry-run=server` is fine if you do; otherwise skim manually.

- [ ] **Step 20.4: Commit**

```bash
git add deploy/k8s/rbac.yaml deploy/k8s/README.md
git commit -m "$(cat <<'EOF'
chore(deploy): add K8s RBAC for benchmark Jobs + dev README

Namespace + ServiceAccount + Role (jobs/secrets/pods) + RoleBinding
all scoped to the modeldoctor-benchmarks namespace — no cluster-wide
perms. README documents apply, verify, and the local k3d acceptance
flow against gpustack/benchmark-runner:v0.0.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: Update `.env.example` and apps/api README

**Files:**
- Modify (or create): `apps/api/.env.example`
- Modify (or create): `apps/api/README.md` (only the benchmark section)

- [ ] **Step 21.1: Append benchmark env to `.env.example`**

If the file exists, append. If not, create with at least the new keys:

```dotenv
# --- Benchmark feature -------------------------------------------------
# Driver selection. "subprocess" runs guidellm via child_process locally
# (dev default). "k8s" creates a Job in BENCHMARK_K8S_NAMESPACE.
BENCHMARK_DRIVER=subprocess

# Where the runner pod / subprocess POSTs lifecycle + metrics back.
# Local dev: http://localhost:3001
# k3d:       http://host.k3d.internal:3001
# Prod:      http://modeldoctor-api.modeldoctor.svc:3001
BENCHMARK_CALLBACK_URL=http://localhost:3001

# 32-byte base64-encoded AES-256 key used to encrypt user-supplied API
# keys at rest. Generate with: openssl rand -base64 32
CONNECTION_API_KEY_ENCRYPTION_KEY=

# >=32 chars. Used to derive per-run HMAC callback tokens.
# Generate with: openssl rand -base64 48
BENCHMARK_CALLBACK_SECRET=

# Only used when BENCHMARK_DRIVER=k8s.
BENCHMARK_K8S_NAMESPACE=modeldoctor-benchmarks
BENCHMARK_RUNNER_IMAGE=gpustack/benchmark-runner:v0.0.4

# Default --max-seconds applied to runs when not otherwise capped.
BENCHMARK_DEFAULT_MAX_DURATION_SECONDS=1800
```

- [ ] **Step 21.2: Append to `apps/api/README.md`** (or create if missing)

Add a section near the bottom:

```markdown
## Benchmark feature

The benchmark module launches `gpustack/benchmark-runner` (a guidellm wrapper)
either as a Kubernetes Job (`BENCHMARK_DRIVER=k8s`) or as a local subprocess
(`BENCHMARK_DRIVER=subprocess`, default).

### Local subprocess workflow (~90% of dev)

```bash
# One-time: install benchmark-runner into a conda env on PATH.
conda create -n modeldoctor-benchmark-runner python=3.11 -y
conda activate modeldoctor-benchmark-runner
pip install -e apps/benchmark-runner

# Confirm the CLI is reachable.
which benchmark-runner

# Generate secrets + run.
echo "CONNECTION_API_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> apps/api/.env
echo "BENCHMARK_CALLBACK_SECRET=$(openssl rand -base64 48)" >> apps/api/.env
pnpm -F @modeldoctor/api start:dev
```

POST a benchmark via curl (replace `$JWT` with your token from `/auth/login`):

```bash
curl -X POST http://localhost:3001/api/benchmarks \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "smoke 1",
    "profile": "latency",
    "apiType": "chat",
    "apiUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini",
    "datasetName": "random",
    "datasetInputTokens": 128,
    "datasetOutputTokens": 64,
    "requestRate": 1,
    "totalRequests": 5
  }'
```

### k3d acceptance workflow

See `deploy/k8s/README.md`.
```

- [ ] **Step 21.3: Commit**

```bash
git add apps/api/.env.example apps/api/README.md
git commit -m "$(cat <<'EOF'
docs(api): document Phase 3 env vars + dev workflows

.env.example gets all five new BENCHMARK_* keys plus the existing two
that flipped to required. README.md gets the conda-based subprocess
workflow and links to the k3d workflow in deploy/k8s/README.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final integration verification

Before opening the PR, run the full pipeline + manual smoke.

- [ ] **Step F.1: Full repo type-check + tests + lint**

```bash
pnpm -r type-check
pnpm -r test
pnpm -r lint
```
Expected: all green across all workspaces. The new benchmark suite adds ~70 specs (split across the 6+ spec files in this phase). LoadTest, debug-proxy, e2e-test, auth, etc. must remain green — no regression.

- [ ] **Step F.2: Boot the API in subprocess mode**

```bash
pnpm -F @modeldoctor/api start:dev
```
Expected: API starts on :3001, no startup errors. `GET /api/health` still returns `{ status: "ok" }`. (CTRL-C when satisfied.)

- [ ] **Step F.3 (optional but recommended): Subprocess end-to-end smoke**

Per the README in Task 21. POST a benchmark with a low `totalRequests` (~5) against any reachable OpenAI-compatible endpoint. Watch the API logs:

1. `BenchmarkService` logs the `submitted` transition.
2. `benchmark-runner` runs in a child process; you'll see its stdout interleaved.
3. State callbacks arrive (running, then completed) — visible as `POST /api/internal/benchmarks/<id>/state 200`.
4. `psql modeldoctor -c "select id,state,metrics_summary from benchmark_runs order by created_at desc limit 1;"` shows `state=completed` and a populated `metrics_summary`.

If any step doesn't happen, drop into `superpowers:systematic-debugging` before merging.

- [ ] **Step F.4 (optional): k3d end-to-end smoke**

Per `deploy/k8s/README.md`. Same outcome, validated through the K8s client.

- [ ] **Step F.5: Push + open PR**

```bash
git push -u origin feat/benchmark-phase-3
gh pr create --base feat/restructure --title "feat(benchmark): Phase 3 — drivers + callbacks + CRUD + reconciler" --body "$(cat <<'EOF'
## Summary
- Two `BenchmarkExecutionDriver` impls (`SubprocessDriver`, `K8sJobDriver`) selected via `BENCHMARK_DRIVER` factory.
- User-facing CRUD: `POST/GET/GET:id/POST:id/cancel/DELETE:id` under `/api/benchmarks`.
- Internal HMAC-authenticated callback: `POST /api/internal/benchmarks/:id/{state,metrics}`.
- 30s `BenchmarkReconciler` cron handles runaway timeouts (both drivers) + Job-missing / Pod-failed (k8s only).
- AES-256-GCM at-rest encryption of user-supplied apiKey; never returned in any response.
- K8s RBAC YAML + dev README at `deploy/k8s/`.

Per the 2026-04-26 brainstorm, the original spec's Phase 3 + Phase 4 are merged into this PR. Phase 5 (UI) follows.

## Test plan
- [x] `pnpm -r test` — green
- [x] `pnpm -r type-check` — green
- [x] `pnpm -r lint` — green
- [ ] Subprocess end-to-end smoke (per `apps/api/README.md`)
- [ ] k3d end-to-end smoke (per `deploy/k8s/README.md`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
Expected: PR URL printed. Note the two unchecked smoke boxes — fill them in after running locally.

---

## Plan self-review

I checked this plan against the spec (`docs/superpowers/specs/2026-04-25-benchmark-design.md`) and the brainstorm decisions:

**Spec coverage:**
- §4.1 user-facing API → Tasks 11–15
- §4.2 internal callback API → Tasks 14, 16
- §4.3 validation → Tasks 10 (sharegpt), 11 (filters), 15 (Zod), already covered by Phase 1's contracts
- §6 security (AES-GCM, HMAC, K8s Secret strategy, resource quotas, ttl) → Tasks 5 (Job manifest), 7 (driver), 10 (encryption), 3+4 (HMAC), 20 (RBAC)
- §7 state machine + reconciler → Tasks 14 (state callback), 17 (reconciler)
- §10 Phase 3+4 → entire plan
- §13 workflows → Tasks 20, 21

**No placeholders.** Every step has the actual code or command.

**Type consistency.** `BenchmarkExecutionContext` field names line up between Phase 1 (already in `execution-driver.interface.ts`) and the new `k8s-job-manifest.ts` / `subprocess-driver.ts` / `benchmark.service.ts`. Driver method names (`start` / `cancel` / `cleanup`) match across the interface, both impls, and the service callsites.

**Decomposition.** 21 tasks; each commits one logical change; no task drops a half-finished file. Tasks 10–14 progressively add methods to `BenchmarkService` so the file grows naturally without intermediate red builds. Tasks 18–19 wire everything; if 18 lands without 19, the module is unused but the build is still green (the test suite proves it).
