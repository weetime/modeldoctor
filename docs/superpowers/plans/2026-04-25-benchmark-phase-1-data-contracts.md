> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Benchmark Feature — Phase 1 Implementation Plan (Data + Contracts)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the typed foundation for the benchmark feature — the `BenchmarkRun` Prisma model, all shared Zod contracts, an AES-GCM helper for at-rest encryption of user-supplied API keys, the `BenchmarkExecutionDriver` interface, and two new optional env vars. Nothing observable from the outside; nothing is wired up. Phase 2 builds the runner image, Phase 3 implements the drivers and callback API.

**Architecture:** Single PR from `feat/benchmark-phase-1` cut from `main`. One Prisma migration (additive only — no changes to existing tables). Contracts go in `packages/contracts/src/benchmark.ts` and are re-exported from the package barrel. The crypto helper lives at `apps/api/src/common/crypto/aes-gcm.ts` next to existing common utilities. The driver interface lives at `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts`, creating the module directory that Phase 3/4 fill in.

**Tech Stack:** Prisma 6, PostgreSQL, Zod 3.23, Node `crypto` (AES-256-GCM), Vitest 2, TypeScript 5 strict. No new npm dependencies.

**Source spec:** `docs/superpowers/specs/2026-04-25-benchmark-design.md` — §3 (Domain Model), §6 (Security), §1.2/§13 (env vars and driver overview).

**Testing discipline:**
- **TDD for code modules.** Every new function in `aes-gcm.ts` and every new branch added to `env.schema.ts` lands via *failing-test-first → minimal-impl → passing-test → commit*.
- **Contracts tests are parser-driven.** For each Zod schema we add at least one accept-case and one reject-case. Type assertions alone are not enough — we need to verify the runtime behavior matches the type.
- **Schema-only changes are verified, not TDD'd.** The Prisma migration (Task 1) and the driver interface (Task 6) ship with verification commands (migration applies cleanly, interface compiles + a noop implementation type-checks). They are not unit-tested in the traditional sense — there is nothing to assert beyond what the type system already enforces.

**Commit cadence:** One commit per task (7 commits + the pre-flight branch creation). Conventional-commit prefixes per `CLAUDE.md`:
- `feat:` runtime code (new functions, new schemas)
- `test:` test-only changes (rare in this phase — tests usually land *with* their impl)
- `chore:` Prisma migration scaffolding
- `docs:` would only be used if we touched the spec, which we won't

Every commit body ends with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Environment assumptions:**
- Working directory: the current ModelDoctor repo root (whichever worktree the user is on; commands are written repo-root-relative).
- The local Postgres dev DB is brew-managed (`brew services list` shows `postgresql@18` started). `DATABASE_URL` in `.env` points at `localhost:5432`. Without a running Postgres, `db:migrate:dev` will hang.
- Node ≥ 20, pnpm ≥ 9 — same as Phase 0 of the NestJS refactor.
- `pnpm install` has been run on the current branch (Prisma 6 client is installed).

---

## Pre-flight

- [ ] **Step 0.1: Confirm a clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`. If dirty, commit or stash before proceeding.

- [ ] **Step 0.2: Confirm baseline tests pass on the current branch**

```bash
pnpm -r type-check
pnpm -r test
```
Expected: every workspace package green. **If anything is red, stop** — Phase 1 must start from a green baseline so any new failure clearly belongs to this plan.

- [ ] **Step 0.3: Confirm the dev DB is reachable**

```bash
brew services list | grep postgres
pg_isready -h localhost -p 5432
```
Expected: a `postgresql@<version>` row with status `started`, and `pg_isready` returns `localhost:5432 - accepting connections`. If Postgres is stopped, start it with `brew services start postgresql@18` (adjust version as installed) and wait a couple of seconds.

- [ ] **Step 0.4: Create the Phase 1 branch**

This plan depends on the NestJS backend refactor (Spec 2) being present — specifically `apps/api/prisma/schema.prisma`, `apps/api/src/config/env.schema.ts`, `apps/api/src/common/`, and `packages/contracts/`. Branch from whichever integration branch carries that work: `main` if the refactor has been merged, otherwise the current refactor branch (e.g. `feat/restructure`).

Verify prerequisites are present on the current branch:
```bash
test -f apps/api/prisma/schema.prisma && \
  test -f apps/api/src/config/env.schema.ts && \
  test -d packages/contracts/src && \
  echo "OK: prerequisites present"
```
Expected: `OK: prerequisites present`. If this fails, switch to the correct base branch before continuing.

Then create the Phase 1 branch:
```bash
git checkout -b feat/benchmark-phase-1
```
Expected: `Switched to a new branch 'feat/benchmark-phase-1'`. All Phase 1 commits land here. PR target is whichever branch you cut from (typically `main`).

---

## Phase 1 Tasks

Phase goal (restated): one Prisma migration adds `benchmark_runs`; `packages/contracts/src/benchmark.ts` exports the full Zod surface; `apps/api/src/common/crypto/aes-gcm.ts` exports `encrypt` / `decrypt` / `decodeKey`; `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts` exports the driver interface; `env.schema.ts` accepts `BENCHMARK_API_KEY_ENCRYPTION_KEY` and `BENCHMARK_CALLBACK_SECRET` as optional, validated fields. After this phase merges nothing changes for end users — Phase 4 wires the contracts into a controller, Phase 3 wires the driver and crypto helper into a service.

---

### Task 1: Add `BenchmarkRun` Prisma model and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create (generated by `prisma migrate dev`): `apps/api/prisma/migrations/<timestamp>_add_benchmark_runs/migration.sql`

This task is verified by inspection of the generated migration SQL plus a `db:generate` to confirm the Prisma client picks up the new types. There is no unit test — the Prisma migration toolchain is the verification.

- [ ] **Step 1.1: Add the `BenchmarkRun` model to `schema.prisma`**

Open `apps/api/prisma/schema.prisma`. Append the following model **after** the existing `LoadTestRun` model (i.e. at the end of the file):

```prisma
model BenchmarkRun {
  id          String  @id @default(cuid())
  userId      String? @map("user_id")

  // Identification
  name        String
  description String? @db.Text
  profile     String  @default("custom") // "throughput" | "latency" | "long_context" | "generation_heavy" | "sharegpt" | "custom"

  // Target endpoint
  apiType      String @map("api_type")        // "chat" | "completion"
  apiUrl       String @map("api_url")
  apiKeyCipher String @map("api_key_cipher") // AES-256-GCM ciphertext, see common/crypto
  model        String

  // Workload config
  datasetName         String @default("random") @map("dataset_name") // "random" | "sharegpt"
  datasetInputTokens  Int?   @map("dataset_input_tokens")
  datasetOutputTokens Int?   @map("dataset_output_tokens")
  datasetSeed         Int?   @map("dataset_seed")
  requestRate         Int    @default(0)        @map("request_rate")    // 0 = unlimited
  totalRequests       Int    @default(1000)     @map("total_requests")

  // Lifecycle
  state        String  @default("pending") // "pending" | "submitted" | "running" | "completed" | "failed" | "canceled"
  stateMessage String? @db.Text             @map("state_message")
  progress     Float?
  jobName      String? @map("job_name")    // K8s Job metadata.name; null until submitted

  // Metrics (denormalized summary for list views; full report in rawMetrics)
  metricsSummary Json?  @map("metrics_summary")
  rawMetrics     Json?  @map("raw_metrics")
  logs           String? @db.Text

  createdAt   DateTime  @default(now())  @map("created_at")
  startedAt   DateTime?                  @map("started_at")
  completedAt DateTime?                  @map("completed_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([state])
  @@map("benchmark_runs")
}
```

Now add the back-relation on the `User` model. Find the existing relations block on `User`:

```prisma
  refreshTokens RefreshToken[]
  loadTestRuns  LoadTestRun[]
```

Append a third line so it reads:

```prisma
  refreshTokens RefreshToken[]
  loadTestRuns  LoadTestRun[]
  benchmarkRuns BenchmarkRun[]
```

- [ ] **Step 1.2: Generate the migration**

```bash
pnpm -F @modeldoctor/api db:migrate:dev --name add_benchmark_runs
```
Expected output: lines indicating Prisma applied migration `<timestamp>_add_benchmark_runs` and regenerated the client. A new directory `apps/api/prisma/migrations/<timestamp>_add_benchmark_runs/` exists with `migration.sql`.

If the command prompts about resetting the dev DB or about drift, **stop** — Phase 1 is purely additive. The dev DB should already be on the prior `init` migration; if it isn't, investigate before proceeding.

- [ ] **Step 1.3: Inspect the generated SQL**

```bash
cat apps/api/prisma/migrations/*_add_benchmark_runs/migration.sql
```
Verify it contains:
- `CREATE TABLE "benchmark_runs"` with all the columns from the model (snake_case names)
- `CREATE INDEX "benchmark_runs_user_id_created_at_idx"` on `(user_id, created_at)`
- `CREATE INDEX "benchmark_runs_state_idx"` on `(state)`
- `ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE`

If any are missing or the SQL touches *other* tables, the model edit was wrong — fix `schema.prisma` and re-run `db:migrate:dev` (Prisma will roll the dev migration forward automatically).

- [ ] **Step 1.4: Verify the Prisma client surfaces the new type**

```bash
pnpm -F @modeldoctor/api type-check
```
Expected: passes. The generated client now includes `prisma.benchmarkRun.create / findMany / …` overloads. If type-check fails it almost certainly means the schema edit has a typo — re-read it side-by-side with the spec §3.1.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): add benchmark_runs table

Adds the BenchmarkRun Prisma model and an additive migration. Includes
fields for target endpoint (apiKey stored as AES-GCM ciphertext, helper
lands in a follow-up commit), workload config, lifecycle state, and
metrics (summary denormalized for list views, raw blob for forensic
re-analysis).

Indexes: (user_id, created_at) for owner-scoped list queries; (state)
for the reconciler sweep.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: one commit landed; `git log -1 --stat` shows `schema.prisma` + the new migration directory.

---

### Task 2: Add `BENCHMARK_API_KEY_ENCRYPTION_KEY` env var

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.spec.ts`

The crypto helper in Task 4 will need a 32-byte key. We add the env field as **optional** in this phase — Phase 4 (which actually creates encrypted rows) tightens it to required-when-not-test. Adding it now lets the helper accept the key from config in Phase 3/4 without re-touching the schema.

The validation we *do* enforce now: when the env var is set, it must base64-decode to exactly 32 bytes. That catches the most common misconfig (someone sets a 16-byte key by accident).

- [ ] **Step 2.1: Write the failing test for accepting a valid key**

Open `apps/api/src/config/env.spec.ts`. Append at the end of the `describe("validateEnv", () => { ... })` block, just before the closing `});`:

```typescript
  // BENCHMARK_API_KEY_ENCRYPTION_KEY: optional, but if provided must be a
  // base64 string that decodes to exactly 32 bytes (AES-256 key length).
  it("BENCHMARK_API_KEY_ENCRYPTION_KEY is optional", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.BENCHMARK_API_KEY_ENCRYPTION_KEY).toBeUndefined();
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY accepts a 32-byte base64 key", () => {
    const key = Buffer.alloc(32, 0x42).toString("base64");
    const env = validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: key });
    expect(env.BENCHMARK_API_KEY_ENCRYPTION_KEY).toBe(key);
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY rejects a key that decodes to ≠ 32 bytes", () => {
    const tooShort = Buffer.alloc(16, 0x42).toString("base64");
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: tooShort }),
    ).toThrow(/BENCHMARK_API_KEY_ENCRYPTION_KEY/);
  });

  it("BENCHMARK_API_KEY_ENCRYPTION_KEY rejects non-base64 input", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_API_KEY_ENCRYPTION_KEY: "not!base64!@#$" }),
    ).toThrow(/BENCHMARK_API_KEY_ENCRYPTION_KEY/);
  });
```

- [ ] **Step 2.2: Run the new tests and verify they fail**

```bash
pnpm -F @modeldoctor/api test -- env.spec
```
Expected: 4 new failures, all because `BENCHMARK_API_KEY_ENCRYPTION_KEY` is not in the schema. The pre-existing tests should still pass.

- [ ] **Step 2.3: Add the field to the schema**

Open `apps/api/src/config/env.schema.ts`. Inside the `EnvSchema = z.object({ ... })` block, just before the `DISABLE_FIRST_USER_ADMIN` line, add:

```typescript
    // 32-byte base64-encoded AES-256 key used to encrypt user-supplied API
    // keys at rest. Optional in Phase 1 (the helper is added but no row uses
    // it yet); Phase 4 tightens to required-when-not-test once the
    // BenchmarkController persists encrypted rows.
    BENCHMARK_API_KEY_ENCRYPTION_KEY: z
      .string()
      .optional()
      .refine(
        (v) => {
          if (v === undefined) return true;
          // Reject obviously non-base64 input. Buffer.from is permissive (it
          // silently drops invalid chars) so we lint with a regex first.
          if (!/^[A-Za-z0-9+/=]+$/.test(v)) return false;
          return Buffer.from(v, "base64").length === 32;
        },
        { message: "must be a base64 string that decodes to exactly 32 bytes" },
      ),
```

- [ ] **Step 2.4: Run the tests and verify they pass**

```bash
pnpm -F @modeldoctor/api test -- env.spec
```
Expected: all `validateEnv` tests pass, including the 4 new ones.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/config/env.schema.ts apps/api/src/config/env.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/config): accept BENCHMARK_API_KEY_ENCRYPTION_KEY env var

Optional in Phase 1 since no code path requires it yet; Phase 4 tightens
to required-when-not-test once encrypted benchmark rows are persisted.
Validates length-after-base64-decode = 32 bytes so a 16-byte key fails
loudly at boot rather than silently producing a runtime crypto error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `BENCHMARK_CALLBACK_SECRET` env var

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.spec.ts`

Used in Phase 3 to sign the per-run HMAC token the runner pod presents on its callback. Like the encryption key, optional in Phase 1; Phase 3 tightens.

- [ ] **Step 3.1: Write the failing tests**

Append to `apps/api/src/config/env.spec.ts`, again just before the closing `});`:

```typescript
  // BENCHMARK_CALLBACK_SECRET: optional, but if provided must be ≥ 32 chars.
  it("BENCHMARK_CALLBACK_SECRET is optional", () => {
    const env = validateEnv({ NODE_ENV: "test" });
    expect(env.BENCHMARK_CALLBACK_SECRET).toBeUndefined();
  });

  it("BENCHMARK_CALLBACK_SECRET accepts a 32-char string", () => {
    const env = validateEnv({ NODE_ENV: "test", BENCHMARK_CALLBACK_SECRET: "x".repeat(32) });
    expect(env.BENCHMARK_CALLBACK_SECRET).toBe("x".repeat(32));
  });

  it("BENCHMARK_CALLBACK_SECRET rejects a string shorter than 32 chars", () => {
    expect(() =>
      validateEnv({ NODE_ENV: "test", BENCHMARK_CALLBACK_SECRET: "x".repeat(31) }),
    ).toThrow(/BENCHMARK_CALLBACK_SECRET/);
  });
```

- [ ] **Step 3.2: Run the tests and verify they fail**

```bash
pnpm -F @modeldoctor/api test -- env.spec
```
Expected: 3 new failures.

- [ ] **Step 3.3: Add the field to the schema**

In `apps/api/src/config/env.schema.ts`, immediately after the `BENCHMARK_API_KEY_ENCRYPTION_KEY` field, add:

```typescript
    // Secret used to derive per-run HMAC callback tokens. Phase 3 enforces;
    // Phase 1 only validates length when present.
    BENCHMARK_CALLBACK_SECRET: z.string().min(32).optional(),
```

- [ ] **Step 3.4: Run the tests and verify they pass**

```bash
pnpm -F @modeldoctor/api test -- env.spec
```
Expected: all green, including the 3 new tests.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/config/env.schema.ts apps/api/src/config/env.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/config): accept BENCHMARK_CALLBACK_SECRET env var

Used in Phase 3 to derive per-run HMAC callback tokens the benchmark
runner presents to /api/internal/benchmarks/:id/{state,metrics}. Same
optional-in-Phase-1 pattern as BENCHMARK_API_KEY_ENCRYPTION_KEY.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: AES-GCM crypto helper

**Files:**
- Create: `apps/api/src/common/crypto/aes-gcm.ts`
- Create: `apps/api/src/common/crypto/aes-gcm.spec.ts`

The helper exports three pure functions:
- `decodeKey(base64: string): Buffer` — decode and length-check a key.
- `encrypt(plaintext: string, key: Buffer): string` — encrypt and emit a versioned `v1:iv:tag:ct` string.
- `decrypt(payload: string, key: Buffer): string` — parse and decrypt; throws on tamper, wrong key, or unknown version.

No NestJS — pure functions. Testable in isolation.

- [ ] **Step 4.1: Write the failing test file**

Create `apps/api/src/common/crypto/aes-gcm.spec.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeKey, decrypt, encrypt } from "./aes-gcm.js";

describe("aes-gcm", () => {
  const key = randomBytes(32);

  describe("decodeKey", () => {
    it("decodes a valid 32-byte base64 key", () => {
      const b64 = randomBytes(32).toString("base64");
      const out = decodeKey(b64);
      expect(out.length).toBe(32);
      expect(out.equals(Buffer.from(b64, "base64"))).toBe(true);
    });

    it("throws when the decoded key is not 32 bytes", () => {
      const tooShort = randomBytes(16).toString("base64");
      expect(() => decodeKey(tooShort)).toThrow(/32 bytes/);
    });
  });

  describe("encrypt + decrypt", () => {
    it("round-trips a UTF-8 string", () => {
      const ct = encrypt("hello, 世界", key);
      expect(decrypt(ct, key)).toBe("hello, 世界");
    });

    it("emits the v1 prefix and four colon-separated parts", () => {
      const ct = encrypt("anything", key);
      const parts = ct.split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
    });

    it("produces different ciphertexts for the same plaintext (random IV)", () => {
      const a = encrypt("same input", key);
      const b = encrypt("same input", key);
      expect(a).not.toBe(b);
    });

    it("throws when decrypting with the wrong key", () => {
      const ct = encrypt("secret", key);
      const otherKey = randomBytes(32);
      expect(() => decrypt(ct, otherKey)).toThrow();
    });

    it("throws when the ciphertext is tampered with", () => {
      const ct = encrypt("secret", key);
      // Flip a byte in the ciphertext segment (last colon-separated part)
      const parts = ct.split(":");
      const ctBytes = Buffer.from(parts[3], "base64");
      ctBytes[0] = ctBytes[0] ^ 0x01;
      parts[3] = ctBytes.toString("base64");
      const tampered = parts.join(":");
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("throws when the auth tag is tampered with", () => {
      const ct = encrypt("secret", key);
      const parts = ct.split(":");
      const tagBytes = Buffer.from(parts[2], "base64");
      tagBytes[0] = tagBytes[0] ^ 0x01;
      parts[2] = tagBytes.toString("base64");
      const tampered = parts.join(":");
      expect(() => decrypt(tampered, key)).toThrow();
    });

    it("rejects an unknown version prefix", () => {
      const ct = encrypt("secret", key);
      const tampered = ct.replace(/^v1:/, "v2:");
      expect(() => decrypt(tampered, key)).toThrow(/version/);
    });

    it("rejects malformed input (not 4 parts)", () => {
      expect(() => decrypt("v1:not-enough-parts", key)).toThrow(/Malformed/);
    });

    it("encrypt rejects a wrong-length key", () => {
      const badKey = randomBytes(16);
      expect(() => encrypt("x", badKey)).toThrow(/32 bytes/);
    });

    it("decrypt rejects a wrong-length key", () => {
      const ct = encrypt("x", key);
      const badKey = randomBytes(16);
      expect(() => decrypt(ct, badKey)).toThrow(/32 bytes/);
    });
  });
});
```

- [ ] **Step 4.2: Run the test file and verify it fails**

```bash
pnpm -F @modeldoctor/api test -- aes-gcm.spec
```
Expected: every test fails with a module-not-found error pointing at `./aes-gcm.js`.

- [ ] **Step 4.3: Implement the helper**

Create `apps/api/src/common/crypto/aes-gcm.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

export function decodeKey(base64: string): Buffer {
  const buf = Buffer.from(base64, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new Error(`Encryption key must decode to ${KEY_BYTES} bytes, got ${buf.length}`);
  }
  return buf;
}

export function encrypt(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(payload: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes`);
  }
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed ciphertext: expected 4 colon-separated parts");
  }
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported ciphertext version: ${version}`);
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed IV: expected ${IV_BYTES} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Malformed auth tag: expected ${TAG_BYTES} bytes, got ${tag.length}`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4.4: Run the tests and verify they pass**

```bash
pnpm -F @modeldoctor/api test -- aes-gcm.spec
```
Expected: all 12 tests pass. If a tamper test does NOT throw, the GCM auth-tag handling is wrong — re-read `decrypt` for a missing `setAuthTag` call.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/common/crypto/
git commit -m "$(cat <<'EOF'
feat(api/crypto): add AES-256-GCM encrypt/decrypt helper

Pure-function helper for encrypting user-supplied API keys at rest.
Output format is "v1:<iv>:<tag>:<ct>" (all base64) so future key
rotations or algorithm changes are detectable by prefix. decodeKey()
validates length-after-base64-decode = 32 bytes so a misconfigured
env var fails loudly at parse time, not at first encrypt() call.

Used by Phase 4's BenchmarkService when persisting BenchmarkRun rows;
not yet wired up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Benchmark contracts (Zod schemas)

**Files:**
- Create: `packages/contracts/src/benchmark.ts`
- Create: `packages/contracts/src/benchmark.spec.ts`
- Modify: `packages/contracts/src/index.ts`

This is the wire-format authority. Both API and web import these schemas. Schemas covered:
- Enums: `BenchmarkApiTypeSchema`, `BenchmarkProfileSchema`, `BenchmarkDatasetSchema`, `BenchmarkStateSchema`
- Metrics shapes: `LatencyDistributionSchema`, `BenchmarkMetricsSummarySchema`
- Create request: `CreateBenchmarkRequestSchema` (with conditional `superRefine` for Random dataset)
- Read responses: `BenchmarkRunSummarySchema`, `BenchmarkRunSchema`, `ListBenchmarksQuerySchema`, `ListBenchmarksResponseSchema`
- Internal callbacks (used by Phase 3): `BenchmarkStateCallbackSchema`, `BenchmarkMetricsCallbackSchema`

- [ ] **Step 5.1: Write the failing test file**

Create `packages/contracts/src/benchmark.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  BenchmarkApiTypeSchema,
  BenchmarkDatasetSchema,
  BenchmarkMetricsCallbackSchema,
  BenchmarkMetricsSummarySchema,
  BenchmarkProfileSchema,
  BenchmarkRunSchema,
  BenchmarkRunSummarySchema,
  BenchmarkStateCallbackSchema,
  BenchmarkStateSchema,
  CreateBenchmarkRequestSchema,
  ListBenchmarksQuerySchema,
  ListBenchmarksResponseSchema,
} from "./benchmark.js";

describe("benchmark contracts", () => {
  describe("enums", () => {
    it("BenchmarkApiTypeSchema accepts only chat/completion", () => {
      expect(BenchmarkApiTypeSchema.parse("chat")).toBe("chat");
      expect(BenchmarkApiTypeSchema.parse("completion")).toBe("completion");
      expect(() => BenchmarkApiTypeSchema.parse("embeddings")).toThrow();
    });

    it("BenchmarkProfileSchema includes all 5 named profiles plus custom", () => {
      for (const p of ["throughput", "latency", "long_context", "generation_heavy", "sharegpt", "custom"]) {
        expect(BenchmarkProfileSchema.parse(p)).toBe(p);
      }
      expect(() => BenchmarkProfileSchema.parse("unknown")).toThrow();
    });

    it("BenchmarkDatasetSchema accepts random and sharegpt", () => {
      expect(BenchmarkDatasetSchema.parse("random")).toBe("random");
      expect(BenchmarkDatasetSchema.parse("sharegpt")).toBe("sharegpt");
      expect(() => BenchmarkDatasetSchema.parse("custom-set")).toThrow();
    });

    it("BenchmarkStateSchema includes the full lifecycle", () => {
      for (const s of ["pending", "submitted", "running", "completed", "failed", "canceled"]) {
        expect(BenchmarkStateSchema.parse(s)).toBe(s);
      }
      expect(() => BenchmarkStateSchema.parse("unknown")).toThrow();
    });
  });

  describe("CreateBenchmarkRequestSchema", () => {
    const valid = {
      name: "throughput-baseline",
      profile: "throughput" as const,
      apiType: "chat" as const,
      apiUrl: "http://vllm.local:8000/v1",
      apiKey: "sk-test",
      model: "facebook/opt-125m",
      datasetName: "random" as const,
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    };

    it("accepts a complete random-dataset request", () => {
      expect(() => CreateBenchmarkRequestSchema.parse(valid)).not.toThrow();
    });

    it("requires datasetInputTokens when datasetName is 'random'", () => {
      const { datasetInputTokens: _, ...rest } = valid;
      const result = CreateBenchmarkRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "datasetInputTokens")).toBe(true);
      }
    });

    it("requires datasetOutputTokens when datasetName is 'random'", () => {
      const { datasetOutputTokens: _, ...rest } = valid;
      const result = CreateBenchmarkRequestSchema.safeParse(rest);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === "datasetOutputTokens")).toBe(true);
      }
    });

    it("rejects empty name", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, name: "" })).toThrow();
    });

    it("rejects name longer than 128 chars", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, name: "x".repeat(129) })).toThrow();
    });

    it("rejects non-URL apiUrl", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, apiUrl: "not-a-url" })).toThrow();
    });

    it("rejects negative requestRate", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, requestRate: -1 })).toThrow();
    });

    it("rejects totalRequests > 100000", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, totalRequests: 100_001 })).toThrow();
    });

    it("allows requestRate=0 (unlimited)", () => {
      expect(() => CreateBenchmarkRequestSchema.parse({ ...valid, requestRate: 0 })).not.toThrow();
    });
  });

  describe("BenchmarkMetricsSummarySchema", () => {
    const validMetrics = {
      ttft: { mean: 120, p50: 110, p95: 200, p99: 320 },
      itl: { mean: 25, p50: 22, p95: 50, p99: 80 },
      e2eLatency: { mean: 1800, p50: 1700, p95: 2500, p99: 3200 },
      requestsPerSecond: { mean: 12.4 },
      outputTokensPerSecond: { mean: 1580 },
      inputTokensPerSecond: { mean: 12700 },
      totalTokensPerSecond: { mean: 14280 },
      concurrency: { mean: 8.2, max: 12 },
      requests: { total: 1000, success: 998, error: 1, incomplete: 1 },
    };

    it("accepts a fully-populated metrics summary", () => {
      expect(() => BenchmarkMetricsSummarySchema.parse(validMetrics)).not.toThrow();
    });

    it("rejects a missing ttft.p99", () => {
      const broken = { ...validMetrics, ttft: { mean: 120, p50: 110, p95: 200 } };
      expect(() => BenchmarkMetricsSummarySchema.parse(broken)).toThrow();
    });
  });

  describe("BenchmarkRunSummarySchema and BenchmarkRunSchema", () => {
    const summary = {
      id: "ckxxx",
      userId: "uxxx",
      name: "run-1",
      profile: "throughput" as const,
      apiType: "chat" as const,
      apiUrl: "http://vllm:8000/v1",
      model: "facebook/opt-125m",
      datasetName: "random" as const,
      state: "completed" as const,
      progress: 1,
      metricsSummary: null,
      createdAt: "2026-04-25T00:00:00.000Z",
      startedAt: "2026-04-25T00:00:01.000Z",
      completedAt: "2026-04-25T00:05:00.000Z",
    };

    it("BenchmarkRunSummarySchema accepts a minimal completed summary", () => {
      expect(() => BenchmarkRunSummarySchema.parse(summary)).not.toThrow();
    });

    it("BenchmarkRunSchema requires the full set of fields", () => {
      const full = {
        ...summary,
        description: null,
        datasetInputTokens: 1024,
        datasetOutputTokens: 128,
        datasetSeed: null,
        requestRate: 0,
        totalRequests: 1000,
        stateMessage: null,
        jobName: "benchmark-ckxxx",
        rawMetrics: null,
        logs: null,
      };
      expect(() => BenchmarkRunSchema.parse(full)).not.toThrow();
    });
  });

  describe("ListBenchmarksQuerySchema", () => {
    it("applies the default limit", () => {
      const q = ListBenchmarksQuerySchema.parse({});
      expect(q.limit).toBe(20);
    });

    it("coerces limit from a string", () => {
      const q = ListBenchmarksQuerySchema.parse({ limit: "50" });
      expect(q.limit).toBe(50);
    });

    it("rejects limit > 100", () => {
      expect(() => ListBenchmarksQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it("accepts a state filter", () => {
      const q = ListBenchmarksQuerySchema.parse({ state: "running" });
      expect(q.state).toBe("running");
    });

    it("rejects an unknown state filter", () => {
      expect(() => ListBenchmarksQuerySchema.parse({ state: "weird" })).toThrow();
    });
  });

  describe("ListBenchmarksResponseSchema", () => {
    it("accepts an empty list with null cursor", () => {
      expect(() => ListBenchmarksResponseSchema.parse({ items: [], nextCursor: null })).not.toThrow();
    });
  });

  describe("internal callback schemas", () => {
    it("BenchmarkStateCallbackSchema accepts running with no extras", () => {
      const cb = BenchmarkStateCallbackSchema.parse({ state: "running" });
      expect(cb.state).toBe("running");
    });

    it("BenchmarkStateCallbackSchema rejects progress > 1", () => {
      expect(() => BenchmarkStateCallbackSchema.parse({ state: "running", progress: 1.5 })).toThrow();
    });

    it("BenchmarkMetricsCallbackSchema requires metricsSummary", () => {
      expect(() => BenchmarkMetricsCallbackSchema.parse({ rawMetrics: {} })).toThrow();
    });
  });
});
```

- [ ] **Step 5.2: Run the test file and verify it fails**

```bash
pnpm -F @modeldoctor/contracts test
```
Expected: every test fails with a module-not-found error pointing at `./benchmark.js`.

- [ ] **Step 5.3: Implement the schemas**

Create `packages/contracts/src/benchmark.ts`:

```typescript
import { z } from "zod";

// ============================================================
// Enums
// ============================================================

export const BenchmarkApiTypeSchema = z.enum(["chat", "completion"]);
export type BenchmarkApiType = z.infer<typeof BenchmarkApiTypeSchema>;

export const BenchmarkProfileSchema = z.enum([
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
]);
export type BenchmarkProfile = z.infer<typeof BenchmarkProfileSchema>;

export const BenchmarkDatasetSchema = z.enum(["random", "sharegpt"]);
export type BenchmarkDataset = z.infer<typeof BenchmarkDatasetSchema>;

export const BenchmarkStateSchema = z.enum([
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type BenchmarkState = z.infer<typeof BenchmarkStateSchema>;

// ============================================================
// Metrics
// ============================================================

export const LatencyDistributionSchema = z.object({
  mean: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
});
export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

export const BenchmarkMetricsSummarySchema = z.object({
  ttft: LatencyDistributionSchema,
  itl: LatencyDistributionSchema,
  e2eLatency: LatencyDistributionSchema,
  requestsPerSecond: z.object({ mean: z.number() }),
  outputTokensPerSecond: z.object({ mean: z.number() }),
  inputTokensPerSecond: z.object({ mean: z.number() }),
  totalTokensPerSecond: z.object({ mean: z.number() }),
  concurrency: z.object({ mean: z.number(), max: z.number() }),
  requests: z.object({
    total: z.number().int(),
    success: z.number().int(),
    error: z.number().int(),
    incomplete: z.number().int(),
  }),
});
export type BenchmarkMetricsSummary = z.infer<typeof BenchmarkMetricsSummarySchema>;

// ============================================================
// Create request (POST /api/benchmarks body)
// ============================================================

export const CreateBenchmarkRequestSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().max(2048).optional(),
    profile: BenchmarkProfileSchema,
    apiType: BenchmarkApiTypeSchema,
    apiUrl: z.string().url(),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    datasetName: BenchmarkDatasetSchema,
    datasetInputTokens: z.number().int().min(1).optional(),
    datasetOutputTokens: z.number().int().min(1).optional(),
    datasetSeed: z.number().int().optional(),
    requestRate: z.number().int().min(0).default(0),
    totalRequests: z.number().int().min(1).max(100_000).default(1000),
  })
  .superRefine((data, ctx) => {
    if (data.datasetName === "random") {
      if (data.datasetInputTokens === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetInputTokens"],
          message: "Required when datasetName is 'random'",
        });
      }
      if (data.datasetOutputTokens === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datasetOutputTokens"],
          message: "Required when datasetName is 'random'",
        });
      }
    }
  });
export type CreateBenchmarkRequest = z.infer<typeof CreateBenchmarkRequestSchema>;

// ============================================================
// Read responses
// ============================================================

export const BenchmarkRunSummarySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  profile: BenchmarkProfileSchema,
  apiType: BenchmarkApiTypeSchema,
  apiUrl: z.string(),
  model: z.string(),
  datasetName: BenchmarkDatasetSchema,
  state: BenchmarkStateSchema,
  progress: z.number().nullable(),
  metricsSummary: BenchmarkMetricsSummarySchema.nullable(),
  createdAt: z.string(), // ISO 8601
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type BenchmarkRunSummary = z.infer<typeof BenchmarkRunSummarySchema>;

export const BenchmarkRunSchema = BenchmarkRunSummarySchema.extend({
  description: z.string().nullable(),
  datasetInputTokens: z.number().int().nullable(),
  datasetOutputTokens: z.number().int().nullable(),
  datasetSeed: z.number().int().nullable(),
  requestRate: z.number().int(),
  totalRequests: z.number().int(),
  stateMessage: z.string().nullable(),
  jobName: z.string().nullable(),
  rawMetrics: z.unknown().nullable(),
  logs: z.string().nullable(),
});
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;

export const ListBenchmarksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  state: BenchmarkStateSchema.optional(),
  profile: BenchmarkProfileSchema.optional(),
  search: z.string().optional(),
});
export type ListBenchmarksQuery = z.infer<typeof ListBenchmarksQuerySchema>;

export const ListBenchmarksResponseSchema = z.object({
  items: z.array(BenchmarkRunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListBenchmarksResponse = z.infer<typeof ListBenchmarksResponseSchema>;

// ============================================================
// Internal callback schemas (runner pod → API)
// ============================================================

export const BenchmarkStateCallbackSchema = z.object({
  state: BenchmarkStateSchema,
  stateMessage: z.string().max(2048).optional(),
  progress: z.number().min(0).max(1).optional(),
});
export type BenchmarkStateCallback = z.infer<typeof BenchmarkStateCallbackSchema>;

export const BenchmarkMetricsCallbackSchema = z.object({
  metricsSummary: BenchmarkMetricsSummarySchema,
  rawMetrics: z.unknown(),
  logs: z.string().optional(),
});
export type BenchmarkMetricsCallback = z.infer<typeof BenchmarkMetricsCallbackSchema>;
```

- [ ] **Step 5.4: Re-export from the package barrel**

Open `packages/contracts/src/index.ts`. Append:

```typescript
export * from "./benchmark.js";
```

- [ ] **Step 5.5: Run the contracts tests and verify they pass**

```bash
pnpm -F @modeldoctor/contracts test
```
Expected: all tests in `benchmark.spec.ts` pass.

- [ ] **Step 5.6: Run type-check across the workspace**

```bash
pnpm -r type-check
```
Expected: every package green. The barrel re-export is compile-checked here.

- [ ] **Step 5.7: Commit**

```bash
git add packages/contracts/src/benchmark.ts packages/contracts/src/benchmark.spec.ts packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add benchmark Zod schemas

Wire-format authority for the upcoming benchmark feature: enums for
api-type / profile / dataset / state, the metrics summary shape, the
create-request body (with random-dataset conditional validation), the
list/detail response shapes, and the two internal runner callback
shapes used in Phase 3. Both API and web import from here.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `BenchmarkExecutionDriver` interface

**Files:**
- Create: `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts`
- Create: `apps/api/src/modules/benchmark/drivers/execution-driver.interface.spec.ts`

The interface is pure TypeScript — there is no runtime to test. The "test" is a type-level assertion: a noop class implements the interface and the file compiles. Phase 3 supplies the real implementations.

- [ ] **Step 6.1: Write the interface contract test**

Create `apps/api/src/modules/benchmark/drivers/execution-driver.interface.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type {
  BenchmarkExecutionContext,
  BenchmarkExecutionDriver,
  BenchmarkExecutionHandle,
} from "./execution-driver.interface.js";

// Compile-time assertion that the interface shape is what consumers expect.
// This file's primary value is the type-check: if a Phase 3 PR breaks the
// interface, this spec stops compiling.
class NoopDriver implements BenchmarkExecutionDriver {
  async start(_ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }> {
    return { handle: "noop:0" };
  }
  async cancel(_handle: BenchmarkExecutionHandle): Promise<void> {
    /* no-op */
  }
  async cleanup(_handle: BenchmarkExecutionHandle): Promise<void> {
    /* no-op */
  }
}

describe("BenchmarkExecutionDriver interface", () => {
  it("is implementable by a noop driver", async () => {
    const d: BenchmarkExecutionDriver = new NoopDriver();
    const { handle } = await d.start({
      benchmarkId: "ckxxx",
      profile: "throughput",
      apiType: "chat",
      apiUrl: "http://target",
      apiKey: "sk-test",
      model: "facebook/opt-125m",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
      maxDurationSeconds: 1800,
      callbackUrl: "http://api:3001",
      callbackToken: "hmac-token",
    });
    expect(handle).toBe("noop:0");
    await expect(d.cancel(handle)).resolves.toBeUndefined();
    await expect(d.cleanup(handle)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6.2: Run the test and verify it fails**

```bash
pnpm -F @modeldoctor/api test -- execution-driver.interface.spec
```
Expected: failure on `module not found './execution-driver.interface.js'`.

- [ ] **Step 6.3: Create the interface file**

Create `apps/api/src/modules/benchmark/drivers/execution-driver.interface.ts`:

```typescript
import type { BenchmarkApiType, BenchmarkDataset, BenchmarkProfile } from "@modeldoctor/contracts";

/**
 * Per-run input passed to a driver. Sensitive values (decrypted apiKey,
 * HMAC callback token) are passed by value; the driver is responsible for
 * propagating them to the runner via env or k8s Secret without leaking to
 * logs or process listings.
 */
export interface BenchmarkExecutionContext {
  benchmarkId: string;
  profile: BenchmarkProfile;

  // Target endpoint
  apiType: BenchmarkApiType;
  apiUrl: string;
  apiKey: string;
  model: string;

  // Workload
  datasetName: BenchmarkDataset;
  datasetInputTokens?: number;
  datasetOutputTokens?: number;
  datasetSeed?: number;
  requestRate: number;
  totalRequests: number;
  maxDurationSeconds: number;

  // Callback
  callbackUrl: string;
  callbackToken: string;
}

/**
 * Opaque handle to an in-flight execution. SubprocessDriver uses
 * "subprocess:<pid>"; K8sJobDriver uses "<namespace>/<jobName>".
 * The service stores this on BenchmarkRun.jobName for cancel/cleanup.
 */
export type BenchmarkExecutionHandle = string;

export interface BenchmarkExecutionDriver {
  /**
   * Start an execution. Resolves once the runner is launched (process spawned
   * or Job created), NOT when the benchmark finishes. Lifecycle progression
   * after start() is reported by the runner via HTTP callbacks.
   */
  start(ctx: BenchmarkExecutionContext): Promise<{ handle: BenchmarkExecutionHandle }>;

  /** Stop an in-flight execution. Idempotent. */
  cancel(handle: BenchmarkExecutionHandle): Promise<void>;

  /**
   * Release driver-side resources (subprocess wait, K8s Job delete) after
   * a run reaches a terminal state. Idempotent — safe to call multiple
   * times or on a handle whose underlying execution is already gone.
   */
  cleanup(handle: BenchmarkExecutionHandle): Promise<void>;
}
```

- [ ] **Step 6.4: Run the test and verify it passes**

```bash
pnpm -F @modeldoctor/api test -- execution-driver.interface.spec
```
Expected: the test passes.

- [ ] **Step 6.5: Run a workspace type-check**

```bash
pnpm -r type-check
```
Expected: green. The cross-package import (`@modeldoctor/contracts` → API) is exercised here.

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/modules/benchmark/
git commit -m "$(cat <<'EOF'
feat(api/benchmark): define BenchmarkExecutionDriver interface

Pluggable execution backend contract used by both K8sJobDriver
(production) and SubprocessDriver (local dev). Driver is responsible
for launching the runner and propagating sensitive context (decrypted
apiKey, HMAC callback token); lifecycle progression after start() is
reported back via HTTP callback, not polled by the driver.

Phase 3 adds the two implementations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Phase 1 final verification

No new files; this task confirms the workspace is green and prepares the branch for PR.

- [ ] **Step 7.1: Run all tests across the workspace**

```bash
pnpm -r test
```
Expected: every package green. The total test count should have grown by:
- `apps/api`: ~7 (env) + ~12 (aes-gcm) + ~1 (driver interface) ≈ 20 new tests
- `packages/contracts`: ~25 new tests

If anything is red, fix it before opening the PR.

- [ ] **Step 7.2: Run type-check across the workspace**

```bash
pnpm -r type-check
```
Expected: green.

- [ ] **Step 7.3: Run lint across the workspace**

```bash
pnpm -r lint
```
Expected: green. If Biome flags formatting issues, run `pnpm -r format` and amend the relevant commit (or, if the changes touch multiple commits, follow up with one `style:` commit covering all auto-fixes).

- [ ] **Step 7.4: Inspect the commit graph**

```bash
git log --oneline -6
```
Expected: the most recent 6 commits are the Phase 1 commits, in this order, all on `feat/benchmark-phase-1`:
1. `feat(db): add benchmark_runs table`
2. `feat(api/config): accept BENCHMARK_API_KEY_ENCRYPTION_KEY env var`
3. `feat(api/config): accept BENCHMARK_CALLBACK_SECRET env var`
4. `feat(api/crypto): add AES-256-GCM encrypt/decrypt helper`
5. `feat(contracts): add benchmark Zod schemas`
6. `feat(api/benchmark): define BenchmarkExecutionDriver interface`

If the order is different or commits are missing, do **not** rewrite history — just verify nothing is broken and proceed. Commit ordering only matters for review readability.

- [ ] **Step 7.5: Push the branch and open the PR**

```bash
git push -u origin feat/benchmark-phase-1
```

Then open the PR via `gh pr create`:

Set the PR base to whatever branch you cut from in Step 0.4 (e.g. `--base main` if cut from main, `--base feat/restructure` if cut from there):

```bash
gh pr create --base <integration-branch> --title "feat(benchmark): phase 1 — data model + contracts + crypto" --body "$(cat <<'EOF'
## Summary
- New `benchmark_runs` Prisma table (additive migration; no changes to existing tables).
- Full Zod contract surface in `packages/contracts/src/benchmark.ts` (enums, create request, list/detail responses, internal callbacks).
- AES-256-GCM helper at `apps/api/src/common/crypto/aes-gcm.ts` for at-rest encryption of user-supplied API keys.
- `BenchmarkExecutionDriver` interface (Phase 3 supplies impls).
- Two new optional env vars: `BENCHMARK_API_KEY_ENCRYPTION_KEY`, `BENCHMARK_CALLBACK_SECRET`.

Nothing is wired up — no controller, no service, no UI. Phase 4 imports the contracts; Phase 3 imports the crypto helper and the driver interface; Phase 5 imports the contracts on the web side.

Spec: `docs/superpowers/specs/2026-04-25-benchmark-design.md`.

## Test plan
- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r test` green
- [ ] `pnpm -r lint` green
- [ ] `git log --oneline main..HEAD` shows 6 commits with `feat:` prefixes
- [ ] Migration SQL hand-inspected for additive-only changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: the PR URL is returned. Wait for CI to finish before merging.

---

## Phase 1 Done When

- Branch `feat/benchmark-phase-1` exists with 6 commits as above.
- `pnpm -r test`, `pnpm -r type-check`, `pnpm -r lint` all green.
- Prisma `db:migrate:dev` applied cleanly (no drift, no reset prompt).
- A PR is open and CI is green.

Phase 2 (`feat/benchmark-phase-2-runner`) builds the Python `apps/benchmark-runner/` image and is independent of this PR — it can be developed in parallel.
