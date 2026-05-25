# Report shared storage + watcher primary mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runner→API `/state` + `/finish` callbacks with K8s informer + shared S3 storage. Runner writes report artifacts to S3; API watcher reads them when the pod reaches terminal phase. Phase 0 (storage layer) + Phase 2 (watcher primary mode) of #237, in one atomic rewrite — no deprecated endpoints, no dual-write.

**Architecture:** Phase 1 already shipped `K8sJobWatcherService` + `PodStateReducer` + `StartupReconciler` + `BenchmarkRepository.updateGuarded()` as backstop. This plan activates `K8S_WATCHER_MODE=primary`: the reducer now emits `running` and `load-report` transitions; a new `ReportLoader` consumes `load-report` by reading runner-written `meta.json`/`result.json`/`stdout.log`/`stderr.log`/`files/*` from S3, parsing through the existing `byTool().parseFinalReport()` adapter, and committing the final benchmark row via `updateGuarded()`. Runner replaces `post_state_running`/`post_finish` POSTs with `boto3` writes against a shared MinIO bucket. `/log` callback path is untouched (Phase 3 territory).

**Tech Stack:** TypeScript / NestJS / Prisma (apps/api), Python 3 (apps/benchmark-runner), `@kubernetes/client-node@0.21`, `@aws-sdk/client-s3` (new), `boto3` (new), Vitest + `aws-sdk-client-mock` for API tests, pytest + `moto` for runner tests.

**Spec:** [`docs/superpowers/specs/2026-05-25-report-storage-and-watcher-primary-design.md`](../specs/2026-05-25-report-storage-and-watcher-primary-design.md)

**Branch / worktree:** `feat/phase2-watcher-primary-and-storage` at `/Users/fangyong/vllm/modeldoctor/feat-phase2-watcher-primary` (already created; the spec lives on this branch as commit `60b038d`).

---

## File structure

**New (API):**

```
packages/contracts/src/benchmark.ts                                    # ADD reportStorageKeys + meta/result types
apps/api/src/modules/benchmark/storage/report-storage.ts               # ReportStorage interface
apps/api/src/modules/benchmark/storage/s3-report-storage.ts            # @aws-sdk/client-s3 impl
apps/api/src/modules/benchmark/storage/s3-report-storage.spec.ts       # aws-sdk-client-mock unit tests
apps/api/src/modules/benchmark/storage/report-loader.ts                # ReportLoader service
apps/api/src/modules/benchmark/storage/report-loader.spec.ts           # 5-path unit tests
apps/api/src/modules/benchmark/benchmark-files.controller.ts           # GET /benchmarks/:id/files/:alias proxy
apps/api/src/modules/benchmark/benchmark-files.controller.spec.ts      # NestJS controller tests
apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts                # nock K8s + S3 mock e2e
```

**New (runner):**

```
apps/benchmark-runner/runner/storage_keys.py                           # key factory (mirrors TS)
apps/benchmark-runner/runner/s3_writer.py                              # boto3 wrapper
apps/benchmark-runner/tests/test_storage_keys.py
apps/benchmark-runner/tests/test_s3_writer.py                          # moto S3 mock
```

**Modify (API):**

```
apps/api/src/config/env.schema.ts                                      # +S3_*, change K8S_WATCHER_MODE default
apps/api/test/setup/e2e-env-defaults.ts                                # +S3_* + K8S_WATCHER_MODE=off
apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts                # +primary branch, +mode input
apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts           # +primary matrix
apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts          # primary mode wiring, +ReportLoader dep
apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts     # +primary flows
apps/api/src/modules/benchmark/k8s/startup-reconciler.ts               # storage-first branch
apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts          # +storage case
apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts                 # +md-benchmark-storage envFrom
apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts            # +envFrom assertion
apps/api/src/modules/benchmark/benchmark.module.ts                     # wire storage + loader + files controller
apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts       # DELETE handleState + handleFinish
apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts  # DELETE corresponding cases
packages/contracts/src/benchmark.ts                                    # DELETE state + finish callback schemas
deploy/k8s/README.md                                                   # +MinIO setup instructions
```

**Modify (runner):**

```
apps/benchmark-runner/requirements.txt                                 # +boto3
apps/benchmark-runner/runner/main.py                                   # rewrite main: write S3 instead of POST /state /finish
apps/benchmark-runner/runner/callback.py                               # DELETE post_state_running + post_finish
apps/benchmark-runner/tests/test_main.py                               # update for new flow
```

**Don't touch:** `/log` callback handler, `HmacCallbackGuard`, `benchmarkLogCallbackSchema`, `post_log_batch`, `MD_CALLBACK_URL/TOKEN` env injection.

---

## Task ordering rationale

1. Bottom-up: types/contracts → pure functions → services → wiring → deletions → e2e.
2. Deletions come AFTER new path is wired + tested so we don't break old e2e while building.
3. Runner work parallelizes with API work but keep it after API contracts settle so paths/keys line up.

---

### Task 1: Add reportStorageKeys + meta/result types to contracts

**Files:**
- Modify: `packages/contracts/src/benchmark.ts` (add to end, near existing callback schemas)

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/src/benchmark.spec.ts` (or append if file already exists, check first with `ls packages/contracts/src/benchmark.spec.ts`):

```ts
import { describe, expect, it } from "vitest";
import { reportStorageKeys, reportMetaSchema, reportResultSchema } from "./benchmark.js";

describe("reportStorageKeys", () => {
  it("produces stable keys for a runId", () => {
    const k = reportStorageKeys("run-abc");
    expect(k.meta).toBe("run-abc/meta.json");
    expect(k.result).toBe("run-abc/result.json");
    expect(k.stdout).toBe("run-abc/stdout.log");
    expect(k.stderr).toBe("run-abc/stderr.log");
    expect(k.file("report.json")).toBe("run-abc/files/report.json");
  });
});

describe("reportMetaSchema", () => {
  it("accepts a valid meta payload", () => {
    expect(reportMetaSchema.parse({ toolVersion: "guidellm 0.2.1", startTimeIso: "2026-05-25T00:00:00.000Z" })).toBeTruthy();
  });
  it("rejects missing startTimeIso", () => {
    expect(() => reportMetaSchema.parse({ toolVersion: "x" })).toThrow();
  });
});

describe("reportResultSchema", () => {
  it("accepts a valid result payload", () => {
    expect(reportResultSchema.parse({
      exitCode: 0,
      finishTimeIso: "2026-05-25T01:00:00.000Z",
      files: { "report-json": "files/report.json" },
    })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @modeldoctor/contracts test -- benchmark.spec
```
Expected: FAIL — `reportStorageKeys is not a function` or similar import errors.

- [ ] **Step 3: Append to `packages/contracts/src/benchmark.ts`**

```ts
// Report shared storage — Phase 2 of #237. Object keys runner writes and
// ReportLoader reads. Keep in sync with apps/benchmark-runner/runner/storage_keys.py.
export const reportStorageKeys = (runId: string) => ({
  meta: `${runId}/meta.json`,
  result: `${runId}/result.json`,
  stdout: `${runId}/stdout.log`,
  stderr: `${runId}/stderr.log`,
  file: (alias: string) => `${runId}/files/${alias}`,
});

export const reportMetaSchema = z.object({
  toolVersion: z.string().max(50),
  startTimeIso: z.string().datetime(),
});
export type ReportMeta = z.infer<typeof reportMetaSchema>;

export const reportResultSchema = z.object({
  exitCode: z.number().int(),
  finishTimeIso: z.string().datetime(),
  files: z.record(z.string()), // alias → relative path under <runId>/
});
export type ReportResult = z.infer<typeof reportResultSchema>;
```

(`z` is already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -F @modeldoctor/contracts test -- benchmark.spec
```
Expected: PASS.

- [ ] **Step 5: Build contracts so consumers can pick up the new exports**

```bash
pnpm -F @modeldoctor/contracts build
```
Expected: builds without error; `packages/contracts/dist/benchmark.js` updated.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/benchmark.ts packages/contracts/src/benchmark.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add reportStorageKeys + meta/result schemas for Phase 2

Shared key factory and zod schemas for the runner→storage handshake.
Runner Python mirrors keys in storage_keys.py; API ReportLoader uses
reportMetaSchema / reportResultSchema to parse what comes out of S3.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add S3 env vars + flip K8S_WATCHER_MODE default to primary

**Files:**
- Modify: `apps/api/src/config/env.schema.ts:60` (K8S_WATCHER_MODE) + add S3_* keys
- Modify: `apps/api/test/setup/e2e-env-defaults.ts` (export S3 + watcher mode defaults for tests)

- [ ] **Step 1: Read current env schema near line 60**

```bash
sed -n '55,75p' apps/api/src/config/env.schema.ts
```

- [ ] **Step 2: Modify `apps/api/src/config/env.schema.ts` — add S3_* keys, change watcher default**

Find the existing line `K8S_WATCHER_MODE: z.enum(["off", "backstop", "primary"]).default("off"),` and change `default("off")` to `default("primary")`.

Add immediately after that line (still inside the schema object):

```ts
S3_ENDPOINT: z.string().url(),
S3_ACCESS_KEY: z.string().min(1),
S3_SECRET_KEY: z.string().min(1),
S3_BUCKET: z.string().min(1),
S3_REGION: z.string().default("us-east-1"),
```

(All five required except S3_REGION because MinIO ignores it but the AWS SDK requires it.)

- [ ] **Step 3: Modify `apps/api/test/setup/e2e-env-defaults.ts`**

Read existing structure first:

```bash
sed -n '38,80p' apps/api/test/setup/e2e-env-defaults.ts
```

Inside the `E2E_ENV_DEFAULTS` const, add:

```ts
K8S_WATCHER_MODE: "off",
S3_ENDPOINT: "http://localhost:9999",
S3_ACCESS_KEY: "test-access-key",
S3_SECRET_KEY: "test-secret-key",
S3_BUCKET: "test-bucket",
S3_REGION: "us-east-1",
```

Rationale: tests don't need real S3; this just makes env validation pass. E2E tests that exercise primary mode override `K8S_WATCHER_MODE` explicitly.

- [ ] **Step 4: Verify API still type-checks**

```bash
pnpm -F @modeldoctor/api type-check
```
Expected: PASS.

- [ ] **Step 5: Run existing unit tests to confirm no regression from default flip**

```bash
pnpm -F @modeldoctor/api test
```
Expected: PASS (tests that construct env should pick up E2E_ENV_DEFAULTS or already supply explicit values).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.schema.ts apps/api/test/setup/e2e-env-defaults.ts
git commit -m "$(cat <<'EOF'
feat(api): add S3 env schema + flip K8S_WATCHER_MODE default to primary

S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET required; S3_REGION defaults
to us-east-1 (MinIO ignores it but AWS SDK requires a region string).

K8S_WATCHER_MODE default off→primary. Tests override to "off" via
E2E_ENV_DEFAULTS so unrelated tests don't spin up informers.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Define `ReportStorage` interface

**Files:**
- Create: `apps/api/src/modules/benchmark/storage/report-storage.ts`

This is a pure interface file — no test needed on its own (consumed via other tests).

- [ ] **Step 1: Create the interface file**

```ts
// apps/api/src/modules/benchmark/storage/report-storage.ts

/**
 * Report-side read interface for shared object storage (MinIO / S3).
 *
 * Phase 2 of #237: API only reads — runner writes via boto3 directly.
 * Implementations: S3ReportStorage (prod / dev), in-memory mock (tests).
 *
 * Throws when the network round-trip fails or auth is rejected.
 * Returns `false` from exists() when the object is genuinely absent.
 */
export interface ReportStorage {
  exists(key: string): Promise<boolean>;
  readJson<T>(key: string): Promise<T>;
  readText(key: string): Promise<string>;
  readBytes(key: string): Promise<Buffer>;
}

export const REPORT_STORAGE = Symbol("REPORT_STORAGE");
```

- [ ] **Step 2: Verify type-check**

```bash
pnpm -F @modeldoctor/api type-check
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/benchmark/storage/report-storage.ts
git commit -m "$(cat <<'EOF'
feat(api): add ReportStorage interface (no impl)

Pure interface for the report-side read path. Implementations land
in subsequent commits (S3ReportStorage). REPORT_STORAGE token used
by Nest DI to swap implementations in tests.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add `@aws-sdk/client-s3` + `aws-sdk-client-mock` dependencies

**Files:**
- Modify: `apps/api/package.json` (dependencies + devDependencies)
- Modify: `pnpm-lock.yaml` (regenerated by pnpm)

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm -F @modeldoctor/api add @aws-sdk/client-s3
pnpm -F @modeldoctor/api add -D aws-sdk-client-mock
```

Expected: pnpm pulls `@aws-sdk/client-s3` (~3.x) and `aws-sdk-client-mock`. Lockfile updated.

- [ ] **Step 2: Verify install**

```bash
pnpm -F @modeldoctor/api list @aws-sdk/client-s3 aws-sdk-client-mock
```
Expected: shows both with concrete versions.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
build(api): add @aws-sdk/client-s3 + aws-sdk-client-mock

@aws-sdk/client-s3 is the API-side read client against MinIO / S3.
aws-sdk-client-mock is the v3-SDK-native mocking lib used in unit
tests (preferred over generic vitest mocks for SDK v3 command shapes).

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Implement `S3ReportStorage` with TDD

**Files:**
- Create: `apps/api/src/modules/benchmark/storage/s3-report-storage.ts`
- Test: `apps/api/src/modules/benchmark/storage/s3-report-storage.spec.ts`

- [ ] **Step 1: Write the failing test file**

```ts
// apps/api/src/modules/benchmark/storage/s3-report-storage.spec.ts
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3ReportStorage } from "./s3-report-storage.js";

const s3Mock = mockClient(S3Client);

function bodyFromString(s: string) {
  return Readable.from([Buffer.from(s, "utf8")]) as unknown as ReturnType<typeof Readable.from>;
}

function makeStorage() {
  return new S3ReportStorage({
    endpoint: "http://localhost:9999",
    region: "us-east-1",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "test-bucket",
  });
}

describe("S3ReportStorage", () => {
  beforeEach(() => s3Mock.reset());
  afterEach(() => s3Mock.reset());

  it("exists() returns true when HeadObject succeeds", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const storage = makeStorage();
    expect(await storage.exists("run-1/result.json")).toBe(true);
  });

  it("exists() returns false on NotFound", async () => {
    s3Mock.on(HeadObjectCommand).rejects(Object.assign(new Error("not found"), { name: "NotFound" }));
    const storage = makeStorage();
    expect(await storage.exists("run-1/result.json")).toBe(false);
  });

  it("exists() rethrows on non-NotFound errors", async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error("network down"));
    const storage = makeStorage();
    await expect(storage.exists("run-1/result.json")).rejects.toThrow("network down");
  });

  it("readJson() parses GetObject body", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString('{"exitCode":0}') as never });
    const storage = makeStorage();
    expect(await storage.readJson("run-1/result.json")).toEqual({ exitCode: 0 });
  });

  it("readText() returns full body as string", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString("hello\nworld") as never });
    const storage = makeStorage();
    expect(await storage.readText("run-1/stdout.log")).toBe("hello\nworld");
  });

  it("readBytes() returns Buffer", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString("binary") as never });
    const storage = makeStorage();
    expect((await storage.readBytes("run-1/files/x")).toString("utf8")).toBe("binary");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- s3-report-storage.spec
```
Expected: FAIL — can't import `S3ReportStorage`.

- [ ] **Step 3: Implement `S3ReportStorage`**

```ts
// apps/api/src/modules/benchmark/storage/s3-report-storage.ts
import { GetObjectCommand, HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import type { ReportStorage } from "./report-storage.js";

export interface S3ReportStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

@Injectable()
export class S3ReportStorage implements ReportStorage {
  private readonly log = new Logger(S3ReportStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3ReportStorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      maxAttempts: 2,
    });
    this.bucket = cfg.bucket;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      // SDK v3 surfaces 404 as NotFound class instance OR { name: "NotFound" } depending on path
      if (e instanceof NotFound) return false;
      if ((e as { name?: string }).name === "NotFound") return false;
      throw e;
    }
  }

  async readJson<T>(key: string): Promise<T> {
    const text = await this.readText(key);
    return JSON.parse(text) as T;
  }

  async readText(key: string): Promise<string> {
    const buf = await this.readBytes(key);
    return buf.toString("utf8");
  }

  async readBytes(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 GetObject ${key} returned empty body`);
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm -F @modeldoctor/api test -- s3-report-storage.spec
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/storage/s3-report-storage.ts apps/api/src/modules/benchmark/storage/s3-report-storage.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): S3ReportStorage implementing ReportStorage

@aws-sdk/client-s3 wrapper with forcePathStyle for MinIO, 2-attempt
retry (default 3 too aggressive for our case), and NotFound→false
on exists(). readJson/Text/Bytes share the same stream→Buffer drain.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Extend `PodStateReducer` for primary mode

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts`
- Test: `apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts`

- [ ] **Step 1: Read current reducer + test files to understand shape**

```bash
sed -n '20,50p' apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts
wc -l apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts
```

- [ ] **Step 2: Add `mode` to ReducerInput and new DesiredTransition kinds**

In `pod-state-reducer.ts`, change `DesiredTransition` to add two kinds:

```ts
export type DesiredTransition =
  | { kind: "running"; startedAt: Date }
  | { kind: "load-report" }
  | { kind: "failed-pre-start"; reason: string; message: string }
  | { kind: "failed-terminal"; exitCode: number; reason: string; message: string }
  | { kind: "noop" };
```

Change `ReducerInput` to add `mode`:

```ts
export interface ReducerInput {
  pod: V1Pod;
  currentStatus: string;
  firstFatalWaitingAt: Date | null;
  firstTerminalAt: Date | null;
  now: Date;
  config: ReducerConfig;
  mode: "backstop" | "primary";
}
```

Then refactor the existing `reduce()` function. Keep the existing backstop branch verbatim (don't touch behavior); wrap primary in an early check at the top of the body, AFTER the existing `if (!isInProgressStatus(currentStatus)) return { kind: "noop" }` guard.

Insert after the guard:

```ts
if (input.mode === "primary") {
  return reducePrimary(input);
}
// fall through to existing backstop body
```

Append at the bottom of the file:

```ts
function reducePrimary(input: ReducerInput): DesiredTransition {
  const { pod, currentStatus, firstFatalWaitingAt, now, config } = input;
  const phase = pod.status?.phase;

  // 1. Succeeded → trigger ReportLoader
  if (phase === "Succeeded") return { kind: "load-report" };

  // 2. Failed → write failed directly (no grace)
  if (phase === "Failed") {
    const term = getTerminatedOf(pod);
    return {
      kind: "failed-terminal",
      exitCode: term?.exitCode ?? -1,
      reason: term?.reason ?? "PodFailed",
      message: truncatePrimary(term ? `${term.reason}: ${term.message}` : "pod in Failed phase"),
    };
  }

  // 3. FATAL waiting + grace elapsed
  const waiting = getWaitingOf(pod);
  if (waiting && config.fatalWaitingReasons.includes(waiting.reason)) {
    if (firstFatalWaitingAt) {
      const elapsedSec = (now.getTime() - firstFatalWaitingAt.getTime()) / 1000;
      if (elapsedSec >= config.waitingFatalGraceSec) {
        return {
          kind: "failed-pre-start",
          reason: waiting.reason,
          message: truncatePrimary(`${waiting.reason}: ${waiting.message}`),
        };
      }
    }
    return { kind: "noop" };
  }

  // 4. Running + ready + currentStatus=submitted → mark running
  if (phase === "Running" && currentStatus === "submitted") {
    const runner = pod.status?.containerStatuses?.find((c) => c.name === "runner");
    if (runner?.ready) {
      const startedAt = runner.state?.running?.startedAt ?? now;
      return { kind: "running", startedAt: new Date(startedAt) };
    }
  }

  return { kind: "noop" };
}

// Helpers — reuse existing if file already has equivalents; if so use those names.
function truncatePrimary(s: string): string { return s.length > 2048 ? s.slice(0, 2048) : s; }
function getWaitingOf(pod: V1Pod): { reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.find((c) => c.name === "runner");
  const w = cs?.state?.waiting;
  if (!w?.reason) return null;
  return { reason: w.reason, message: w.message ?? "" };
}
function getTerminatedOf(pod: V1Pod): { exitCode: number; reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.find((c) => c.name === "runner");
  const t = cs?.state?.terminated;
  if (!t) return null;
  return { exitCode: t.exitCode ?? -1, reason: t.reason ?? "Unknown", message: t.message ?? "" };
}
```

If file already has `truncate` / `getWaitingReason` / `getTerminated`, delete the duplicate local helpers and reuse — check first with `grep -n "function truncate\|function getWaitingReason\|function getTerminated" apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts`. The reducer file already exports these as module-private; primary branch should use the same names rather than `truncatePrimary` etc.

- [ ] **Step 3: Update existing backstop test cases to pass `mode: "backstop"` explicitly**

In `pod-state-reducer.spec.ts`, every `reduce({ ... })` call needs `mode: "backstop"` added (the existing tests have no `mode`; they'll fail type-check now). Use a sed or batch find-replace, then sanity-check by running the existing test names.

```bash
pnpm -F @modeldoctor/api test -- pod-state-reducer.spec
```
Expected at this point: TYPE errors or test setup failures because `mode` is required. Fix by adding `mode: "backstop"` to each `reduce(...)` call.

- [ ] **Step 4: Add primary-mode test matrix**

Append to `pod-state-reducer.spec.ts`:

```ts
describe("PodStateReducer — primary mode", () => {
  const baseConfig: ReducerConfig = {
    fatalWaitingReasons: ["ImagePullBackOff", "CrashLoopBackOff"],
    waitingFatalGraceSec: 60,
    terminalReconcileGraceSec: 60,
  };
  const now = new Date("2026-05-25T01:00:00Z");

  function makePod(status: Partial<V1Pod["status"]>): V1Pod {
    return {
      metadata: { labels: { "modeldoctor.ai/run-id": "r1" } },
      status: { phase: "Pending", ...status },
    } as V1Pod;
  }

  it("Succeeded + IN_PROGRESS → load-report", () => {
    const out = reduce({
      pod: makePod({ phase: "Succeeded" }), currentStatus: "running",
      firstFatalWaitingAt: null, firstTerminalAt: null, now, config: baseConfig, mode: "primary",
    });
    expect(out).toEqual({ kind: "load-report" });
  });

  it("Failed + IN_PROGRESS → failed-terminal (no grace)", () => {
    const out = reduce({
      pod: makePod({ phase: "Failed", containerStatuses: [{
        name: "runner", ready: false, image: "x", imageID: "x", restartCount: 0,
        state: { terminated: { exitCode: 1, reason: "Error", message: "boom" } },
      }] }),
      currentStatus: "running", firstFatalWaitingAt: null, firstTerminalAt: null,
      now, config: baseConfig, mode: "primary",
    });
    expect(out).toMatchObject({ kind: "failed-terminal", exitCode: 1, reason: "Error" });
  });

  it("Running + container ready + status=submitted → running", () => {
    const startedAt = "2026-05-25T00:50:00Z";
    const out = reduce({
      pod: makePod({ phase: "Running", containerStatuses: [{
        name: "runner", ready: true, image: "x", imageID: "x", restartCount: 0,
        state: { running: { startedAt: new Date(startedAt) } },
      }] }),
      currentStatus: "submitted", firstFatalWaitingAt: null, firstTerminalAt: null,
      now, config: baseConfig, mode: "primary",
    });
    expect(out).toEqual({ kind: "running", startedAt: new Date(startedAt) });
  });

  it("Running + container NOT ready → noop", () => {
    const out = reduce({
      pod: makePod({ phase: "Running", containerStatuses: [{
        name: "runner", ready: false, image: "x", imageID: "x", restartCount: 0,
        state: { running: { startedAt: new Date(now) } },
      }] }),
      currentStatus: "submitted", firstFatalWaitingAt: null, firstTerminalAt: null,
      now, config: baseConfig, mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });

  it("Pending + ImagePullBackOff + grace not elapsed → noop", () => {
    const out = reduce({
      pod: makePod({ phase: "Pending", containerStatuses: [{
        name: "runner", ready: false, image: "x", imageID: "x", restartCount: 0,
        state: { waiting: { reason: "ImagePullBackOff", message: "no such image" } },
      }] }),
      currentStatus: "submitted",
      firstFatalWaitingAt: new Date(now.getTime() - 30_000), firstTerminalAt: null,
      now, config: baseConfig, mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });

  it("Pending + ImagePullBackOff + grace elapsed → failed-pre-start", () => {
    const out = reduce({
      pod: makePod({ phase: "Pending", containerStatuses: [{
        name: "runner", ready: false, image: "x", imageID: "x", restartCount: 0,
        state: { waiting: { reason: "ImagePullBackOff", message: "no such image" } },
      }] }),
      currentStatus: "submitted",
      firstFatalWaitingAt: new Date(now.getTime() - 70_000), firstTerminalAt: null,
      now, config: baseConfig, mode: "primary",
    });
    expect(out).toMatchObject({ kind: "failed-pre-start", reason: "ImagePullBackOff" });
  });

  it("any phase + terminal benchmark status → noop", () => {
    const out = reduce({
      pod: makePod({ phase: "Succeeded" }), currentStatus: "completed",
      firstFatalWaitingAt: null, firstTerminalAt: null, now, config: baseConfig, mode: "primary",
    });
    expect(out).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test -- pod-state-reducer.spec
```
Expected: PASS (existing backstop tests still pass with `mode: "backstop"`, new primary tests pass).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): PodStateReducer primary mode + load-report transition

Adds 'running' and 'load-report' DesiredTransition kinds plus a 'mode'
input. Backstop branch unchanged (existing tests still green with
mode: "backstop"). Primary branch:
  - phase=Succeeded → load-report (no grace)
  - phase=Failed → failed-terminal (no grace)
  - phase=Pending + FATAL waiting + grace → failed-pre-start
  - phase=Running + ready + submitted → running
  - else → noop

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Implement `ReportLoader` with TDD (5-path coverage)

**Files:**
- Create: `apps/api/src/modules/benchmark/storage/report-loader.ts`
- Test: `apps/api/src/modules/benchmark/storage/report-loader.spec.ts`

- [ ] **Step 1: Write failing tests covering all 5 paths**

```ts
// apps/api/src/modules/benchmark/storage/report-loader.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReportLoader } from "./report-loader.js";
import type { ReportStorage } from "./report-storage.js";

const fixtureMeta = { toolVersion: "guidellm 0.2.1", startTimeIso: "2026-05-25T00:00:00.000Z" };
const fixtureResult = { exitCode: 0, finishTimeIso: "2026-05-25T01:00:00.000Z", files: { "report.json": "files/report.json" } };

function makeDeps() {
  const storage: ReportStorage = {
    exists: vi.fn(async () => true),
    readJson: vi.fn(async (k: string) => {
      if (k.endsWith("meta.json")) return fixtureMeta;
      if (k.endsWith("result.json")) return fixtureResult;
      throw new Error(`unexpected key ${k}`);
    }),
    readText: vi.fn(async () => "stdout content"),
    readBytes: vi.fn(async () => Buffer.from("file content")),
  };
  const repo = {
    findById: vi.fn(async (id: string) => ({ id, status: "running", tool: "guidellm", userId: "u1", name: "n", scenario: "s", connectionId: null })),
    updateGuarded: vi.fn(async () => ({ id: "r1" })),
  };
  const notify = { emit: vi.fn(async () => {}) };
  const sse = { close: vi.fn() };
  const adapter = { parseFinalReport: vi.fn(() => ({ tool: "guidellm" as const, data: { latency: 42 } })) };
  const byTool = vi.fn(() => adapter);
  return { storage, repo, notify, sse, byTool, adapter };
}

describe("ReportLoader", () => {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(() => { deps = makeDeps(); });

  function newLoader(d: ReturnType<typeof makeDeps>) {
    return new ReportLoader({
      storage: d.storage, repo: d.repo as never, notify: d.notify as never,
      sse: d.sse as never, byTool: d.byTool as never,
    });
  }

  it("success path → updateGuarded(completed) + notify benchmark.completed", async () => {
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1",
      expect.arrayContaining(["submitted", "running"]),
      expect.objectContaining({ status: "completed", toolVersion: "guidellm 0.2.1" }),
    );
    expect(deps.notify.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: "benchmark.completed" }));
    expect(deps.sse.close).toHaveBeenCalledWith("r1");
  });

  it("storage timeout → updateGuarded(failed) + notify benchmark.failed", async () => {
    (deps.storage.readJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("timeout"));
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1", expect.anything(), expect.objectContaining({ status: "failed", statusMessage: expect.stringContaining("report load") }),
    );
  });

  it("file missing → updateGuarded(failed)", async () => {
    (deps.storage.readJson as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("NotFound"), { name: "NotFound" }));
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1", expect.anything(), expect.objectContaining({ status: "failed" }),
    );
  });

  it("parse failure → updateGuarded(failed)", async () => {
    deps.adapter.parseFinalReport = vi.fn(() => { throw new Error("bad json"); });
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.repo.updateGuarded).toHaveBeenCalledWith(
      "r1", expect.anything(), expect.objectContaining({ status: "failed", statusMessage: expect.stringContaining("report load: bad json") }),
    );
  });

  it("benchmark already terminal → noop (no storage reads)", async () => {
    deps.repo.findById = vi.fn(async () => ({ id: "r1", status: "cancelled", tool: "guidellm", userId: "u1", name: "n", scenario: "s", connectionId: null }));
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.storage.readJson).not.toHaveBeenCalled();
    expect(deps.repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("guard race: updateGuarded returns null → no notify", async () => {
    deps.repo.updateGuarded = vi.fn(async () => null);
    const loader = newLoader(deps);
    await loader.tryLoad("r1");
    expect(deps.notify.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
pnpm -F @modeldoctor/api test -- report-loader.spec
```
Expected: FAIL — can't import `ReportLoader`.

- [ ] **Step 3: Implement `ReportLoader`**

```ts
// apps/api/src/modules/benchmark/storage/report-loader.ts
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type ReportMeta,
  type ReportResult,
  reportStorageKeys,
} from "@modeldoctor/contracts";
import type { Prisma } from "@prisma/client";
import { byTool as defaultByTool } from "@modeldoctor/tool-adapters";
import type { ToolName } from "@modeldoctor/contracts";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { NotifyService } from "../../notify/notify.service.js";
import type { SseHub } from "../sse.hub.js";
import { REPORT_STORAGE, type ReportStorage } from "./report-storage.js";

const STATUS_MESSAGE_MAX = 2048;
const RAW_OUTPUT_TAIL_MAX = 64 * 1024;

export interface ReportLoaderDeps {
  storage: ReportStorage;
  repo: BenchmarkRepository;
  notify: NotifyService;
  sse: SseHub;
  byTool?: typeof defaultByTool;
}

@Injectable()
export class ReportLoader {
  private readonly log = new Logger(ReportLoader.name);
  private readonly byTool: typeof defaultByTool;

  constructor(
    @Inject(REPORT_STORAGE) storage: ReportStorage,
    repo: BenchmarkRepository,
    notify: NotifyService,
    sse: SseHub,
  );
  constructor(deps: ReportLoaderDeps);
  constructor(...args: unknown[]) {
    // Support both DI and direct construction (for tests)
    if (args.length === 1 && typeof args[0] === "object") {
      const d = args[0] as ReportLoaderDeps;
      this.storage = d.storage; this.repo = d.repo; this.notify = d.notify; this.sse = d.sse;
      this.byTool = d.byTool ?? defaultByTool;
    } else {
      this.storage = args[0] as ReportStorage;
      this.repo = args[1] as BenchmarkRepository;
      this.notify = args[2] as NotifyService;
      this.sse = args[3] as SseHub;
      this.byTool = defaultByTool;
    }
  }

  private readonly storage!: ReportStorage;
  private readonly repo!: BenchmarkRepository;
  private readonly notify!: NotifyService;
  private readonly sse!: SseHub;

  async tryLoad(runId: string): Promise<void> {
    const bench = await this.repo.findById(runId);
    if (!bench || !IN_PROGRESS_STATES.includes(bench.status)) return;
    const keys = reportStorageKeys(runId);
    try {
      const [meta, result, stdout, stderr] = await Promise.all([
        this.storage.readJson<ReportMeta>(keys.meta),
        this.storage.readJson<ReportResult>(keys.result),
        this.storage.readText(keys.stdout),
        this.storage.readText(keys.stderr),
      ]);
      const files = await this.loadFiles(runId, result.files);
      const summary = this.byTool(bench.tool as ToolName).parseFinalReport(stdout, files);
      const updated = await this.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "completed",
        toolVersion: meta.toolVersion,
        statusMessage: null,
        summaryMetrics: (summary ?? null) as Prisma.InputJsonValue,
        rawOutput: {
          stdout: stdout.slice(-RAW_OUTPUT_TAIL_MAX),
          stderr: stderr.slice(-RAW_OUTPUT_TAIL_MAX),
          files: result.files,
        } as Prisma.InputJsonValue,
        completedAt: new Date(result.finishTimeIso),
      });
      if (updated && bench.userId) {
        await this.notify.emit({
          eventType: "benchmark.completed",
          userId: bench.userId,
          connectionId: bench.connectionId ?? undefined,
          payload: {
            benchmarkId: bench.id, name: bench.name, status: "completed",
            scenario: bench.scenario, tool: bench.tool, connectionId: bench.connectionId,
            summaryMetrics: summary, message: null,
          },
        });
      }
    } catch (e) {
      const msg = `report load: ${(e as Error).message}`.slice(0, STATUS_MESSAGE_MAX);
      const updated = await this.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: msg,
        completedAt: new Date(),
      });
      if (updated && bench.userId) {
        await this.notify.emit({
          eventType: "benchmark.failed",
          userId: bench.userId,
          connectionId: bench.connectionId ?? undefined,
          payload: {
            benchmarkId: bench.id, name: bench.name, status: "failed",
            scenario: bench.scenario, tool: bench.tool, connectionId: bench.connectionId,
            summaryMetrics: null, message: msg,
          },
        });
      }
      this.log.warn(`tryLoad(${runId}) failed: ${(e as Error).message}`);
    } finally {
      this.sse.close(runId);
    }
  }

  private async loadFiles(runId: string, fileMap: Record<string, string>): Promise<Record<string, Buffer>> {
    const entries: Array<[string, Buffer]> = [];
    for (const [alias, relPath] of Object.entries(fileMap)) {
      const key = `${runId}/${relPath}`;
      entries.push([alias, await this.storage.readBytes(key)]);
    }
    return Object.fromEntries(entries);
  }
}
```

> Note: the constructor overload above is awkward but lets tests inject deps without Nest DI. Cleaner alternative: extract a `ReportLoaderImpl` class taking `ReportLoaderDeps` and a thin `@Injectable()` NestJS wrapper around it. Use whichever the rest of the codebase prefers (check `K8sJobWatcherService` constructor pattern — it uses `private readonly deps: WatcherDeps`, mirror that).

If `K8sJobWatcherService` uses the deps-object pattern, **prefer the same shape**:

```ts
@Injectable()
export class ReportLoader {
  constructor(private readonly deps: ReportLoaderDeps) {}
  async tryLoad(runId: string) { /* uses this.deps.storage etc. */ }
}
```

and update tests to construct it the same way. Confirm by grepping `constructor(private readonly deps:` in the file you're mirroring.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm -F @modeldoctor/api test -- report-loader.spec
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/storage/report-loader.ts apps/api/src/modules/benchmark/storage/report-loader.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): ReportLoader — read S3 fixture and write final benchmark row

tryLoad(runId) reads meta/result/stdout/stderr/files from ReportStorage,
calls byTool().parseFinalReport, then BenchmarkRepository.updateGuarded
with status=completed (or failed on any storage/parse error). Notify
emitted only when guard accepts the write — cancel races silently lose.

Six unit tests cover: happy path, storage timeout, file missing, parse
failure, already-terminal noop, and guard race (affected=0 → no notify).

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Wire ReportLoader into watcher service + handle new transitions

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts`

- [ ] **Step 1: Read existing watcher service to identify event handler**

```bash
sed -n '100,160p' apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts
```

Note `WatcherDeps` shape — add `reportLoader` and pass `mode` into reducer.

- [ ] **Step 2: Update `WatcherDeps` and the handler**

In `k8s-job-watcher.service.ts`, modify `WatcherDeps`:

```ts
export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
  reportLoader: ReportLoader;   // NEW
}
```

In `onModuleInit`, remove the `if (this.deps.mode === "primary") throw` early-return — `primary` is now supported.

In the event handler (find `handlePodEvent`), where it calls `reduce(...)`, pass `mode: this.deps.mode`:

```ts
const transition = reduce({
  pod, currentStatus: bench.status,
  firstFatalWaitingAt: this.firstFatalWaitingAt.get(runId) ?? null,
  firstTerminalAt: this.firstTerminalAt.get(runId) ?? null,
  now, config: this.deps.reducerConfig,
  mode: this.deps.mode === "off" ? "backstop" : this.deps.mode,
});
```

(`off` shouldn't reach here since onModuleInit early-returns, but the typing demands a literal — coerce to backstop for safety.)

Replace the switch on `transition.kind` to handle the new kinds. Current Phase 1 code only handles `failed-pre-start | failed-terminal | noop`. Add:

```ts
switch (transition.kind) {
  case "running": {
    const updated = await this.deps.repo.updateGuarded(runId, ["submitted"], {
      status: "running", startedAt: transition.startedAt,
    });
    if (updated) this.log.log(`${runId}: running (watcher)`);
    return;
  }
  case "load-report": {
    void this.deps.reportLoader.tryLoad(runId);  // fire-and-forget, self-handled
    return;
  }
  case "failed-pre-start":
  case "failed-terminal": {
    // ... existing logic, now uses updateGuarded(IN_PROGRESS_STATES, {...})
    const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
      status: "failed", statusMessage: transition.message, completedAt: now,
    });
    if (updated) this.log.log(`${runId}: failed (watcher: ${transition.reason})`);
    return;
  }
  case "noop":
    return;
}
```

Adapt to actual surrounding code (existing handler likely already has the failed-pre-start path — only add the new cases).

- [ ] **Step 3: Update watcher service tests**

In `k8s-job-watcher.service.spec.ts`:
1. Add `reportLoader: { tryLoad: vi.fn(async () => {}) }` to the deps fixture.
2. Existing tests pass `mode: "backstop"` (the Phase 1 default) — confirm those still work.
3. Add a new `describe("K8sJobWatcherService — primary mode")` block with cases:
   - Succeeded pod → `reportLoader.tryLoad(runId)` called, no direct updateGuarded
   - Running ready pod + status=submitted → `updateGuarded(["submitted"], { status: "running" })` called
   - Failed pod → `updateGuarded(IN_PROGRESS_STATES, { status: "failed" })` called immediately (no grace)
   - Backstop mode still works (smoke check: one existing case under `mode: "backstop"`)

Example primary-mode test:

```ts
describe("K8sJobWatcherService — primary mode", () => {
  let svc: K8sJobWatcherService;
  let deps: { /* same shape as existing tests, but mode: "primary" */ };
  beforeEach(() => {
    // construct same fixture but deps.mode = "primary"
    // ...
  });

  it("Succeeded pod → reportLoader.tryLoad called", async () => {
    /* feed informer event with Succeeded pod; assert reportLoader.tryLoad called once with the runId */
  });

  it("Running ready pod + submitted status → updateGuarded({running})", async () => {
    /* feed Running pod; assert updateGuarded called with ["submitted"], { status: "running" } */
  });

  it("Failed pod → updateGuarded({failed}) immediately", async () => {
    /* assert no waiting on terminalReconcileGraceSec; called immediately */
  });
});
```

- [ ] **Step 4: Run watcher tests**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher
```
Expected: existing backstop tests pass; new primary tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): wire ReportLoader into K8sJobWatcherService primary mode

Removes 'primary is not yet implemented' guard; passes mode into the
reducer so it returns running/load-report transitions; switch handler
now routes load-report → reportLoader.tryLoad (fire-and-forget) and
running → updateGuarded(['submitted'], { status: 'running' }).

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: StartupReconciler — storage-first branch

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/startup-reconciler.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts`

- [ ] **Step 1: Read existing reconciler to understand current branches**

```bash
sed -n '1,80p' apps/api/src/modules/benchmark/k8s/startup-reconciler.ts
```

- [ ] **Step 2: Add `reportLoader` + `storage` to StartupReconcilerDeps**

```ts
export interface StartupReconcilerDeps {
  // ... existing fields
  storage: ReportStorage;
  reportLoader: ReportLoader;
}
```

- [ ] **Step 3: Modify `run()` to check storage first**

Inside the loop over in-progress benchmarks, BEFORE the existing pod-cache check:

```ts
const keys = reportStorageKeys(b.id);
if (await this.deps.storage.exists(keys.result)) {
  await this.deps.reportLoader.tryLoad(b.id);
  continue;
}
// fall through to existing pod-exists check
```

- [ ] **Step 4: Update test fixture to provide storage + reportLoader**

In `startup-reconciler.spec.ts`, add mocks:

```ts
const storage = { exists: vi.fn(async () => false), readJson: vi.fn(), readText: vi.fn(), readBytes: vi.fn() };
const reportLoader = { tryLoad: vi.fn(async () => {}) };
// pass into deps
```

Add a new test case:

```ts
it("storage has result.json → calls reportLoader.tryLoad and skips pod check", async () => {
  storage.exists.mockResolvedValueOnce(true);
  await reconciler.run();
  expect(reportLoader.tryLoad).toHaveBeenCalledWith("r1");
  expect(/* pod cache mock */).not.toHaveBeenCalled();
});
```

Verify existing tests still pass — they should because storage.exists defaults to `false` so the original pod-cache branch is hit.

- [ ] **Step 5: Run tests**

```bash
pnpm -F @modeldoctor/api test -- startup-reconciler
```
Expected: existing + new test pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/startup-reconciler.ts apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): StartupReconciler storage-first branch

On boot, in-progress benchmarks with result.json present in S3 take
the ReportLoader path (storage is ground truth when pod TTL'd away
during downtime). Pod-exists check falls through unchanged when
storage is empty.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: K8s Job manifest — add `md-benchmark-storage` envFrom

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts`

- [ ] **Step 1: Find current container env construction**

```bash
grep -n "envFrom\|container.env\|MD_CALLBACK" apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts
```

- [ ] **Step 2: Add second `envFrom` entry**

In `k8s-job-manifest.ts`, find where the container is built and add `envFrom` (if absent) or append to existing list:

```ts
envFrom: [
  { secretRef: { name: perRunSecretName } },
  { secretRef: { name: "md-benchmark-storage" } },
],
```

If today's code only sets `env: [...]` and not `envFrom`, add `envFrom` next to it. The per-run Secret still carries `MD_CALLBACK_TOKEN` (we don't delete that until Phase 3); the storage Secret is operator-created.

- [ ] **Step 3: Update tests**

In `k8s-job-manifest.spec.ts`, find the existing manifest assertions and add:

```ts
expect(manifest.spec.template.spec.containers[0].envFrom).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ secretRef: expect.objectContaining({ name: "md-benchmark-storage" }) }),
  ]),
);
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-manifest
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): inject md-benchmark-storage Secret into runner Job

Adds envFrom: secretRef to point at the operator-created
md-benchmark-storage Secret (S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET/REGION).
The per-run Secret keeps MD_CALLBACK_TOKEN — still needed for /log
HMAC (Phase 3 removes it).

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: New `GET /benchmarks/:id/files/:alias` controller

**Files:**
- Create: `apps/api/src/modules/benchmark/benchmark-files.controller.ts`
- Create: `apps/api/src/modules/benchmark/benchmark-files.controller.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/src/modules/benchmark/benchmark-files.controller.spec.ts
import { ForbiddenException, NotFoundException, StreamableFile } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkFilesController } from "./benchmark-files.controller.js";

function makeCtrl(opts: {
  bench?: { id: string; userId: string | null; tool: string; status: string; rawOutput: unknown } | null;
  fileExists?: boolean;
  fileBytes?: Buffer;
}) {
  const repo = {
    findById: vi.fn(async () => opts.bench ?? null),
  };
  const storage = {
    exists: vi.fn(async () => opts.fileExists ?? true),
    readBytes: vi.fn(async () => opts.fileBytes ?? Buffer.from("data")),
    readJson: vi.fn(), readText: vi.fn(),
  };
  return { ctrl: new BenchmarkFilesController(repo as never, storage as never), repo, storage };
}

describe("BenchmarkFilesController", () => {
  it("404 when benchmark not found", async () => {
    const { ctrl } = makeCtrl({ bench: null });
    await expect(ctrl.getFile({ user: { sub: "u1" } } as never, "r1", "report.json")).rejects.toThrow(NotFoundException);
  });

  it("403 when userId mismatch", async () => {
    const { ctrl } = makeCtrl({ bench: { id: "r1", userId: "other-user", tool: "guidellm", status: "completed", rawOutput: { files: { "report.json": "files/report.json" } } } });
    await expect(ctrl.getFile({ user: { sub: "u1" } } as never, "r1", "report.json")).rejects.toThrow(ForbiddenException);
  });

  it("404 when alias not in rawOutput.files", async () => {
    const { ctrl } = makeCtrl({ bench: { id: "r1", userId: "u1", tool: "guidellm", status: "completed", rawOutput: { files: {} } } });
    await expect(ctrl.getFile({ user: { sub: "u1" } } as never, "r1", "missing.json")).rejects.toThrow(NotFoundException);
  });

  it("returns StreamableFile with content for valid request", async () => {
    const { ctrl, storage } = makeCtrl({
      bench: { id: "r1", userId: "u1", tool: "guidellm", status: "completed", rawOutput: { files: { "report.json": "files/report.json" } } },
      fileBytes: Buffer.from('{"ok":true}'),
    });
    const out = await ctrl.getFile({ user: { sub: "u1" } } as never, "r1", "report.json");
    expect(out).toBeInstanceOf(StreamableFile);
    expect(storage.readBytes).toHaveBeenCalledWith("r1/files/report.json");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm -F @modeldoctor/api test -- benchmark-files
```
Expected: FAIL — can't import.

- [ ] **Step 3: Implement controller**

```ts
// apps/api/src/modules/benchmark/benchmark-files.controller.ts
import { Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { REPORT_STORAGE, type ReportStorage } from "./storage/report-storage.js";

interface AuthedRequest extends Request {
  user?: { sub?: string };
}

@ApiTags("benchmarks")
@Controller("benchmarks/:id/files")
@UseGuards(JwtAuthGuard)
export class BenchmarkFilesController {
  constructor(
    private readonly repo: BenchmarkRepository,
    @Inject(REPORT_STORAGE) private readonly storage: ReportStorage,
  ) {}

  @Get(":alias")
  @ApiOperation({ summary: "Stream an output file from the benchmark's S3 report" })
  async getFile(@Req() req: AuthedRequest, @Param("id") id: string, @Param("alias") alias: string): Promise<StreamableFile> {
    const bench = await this.repo.findById(id);
    if (!bench) throw new NotFoundException(`benchmark ${id} not found`);
    if (bench.userId && bench.userId !== req.user?.sub) throw new ForbiddenException();

    const files = ((bench.rawOutput as { files?: Record<string, string> } | null) ?? {}).files ?? {};
    const relPath = files[alias];
    if (!relPath) throw new NotFoundException(`alias ${alias} not in this benchmark's files`);

    const key = `${id}/${relPath}`;
    const bytes = await this.storage.readBytes(key);
    return new StreamableFile(bytes, { disposition: `attachment; filename="${alias}"` });
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm -F @modeldoctor/api test -- benchmark-files
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark-files.controller.ts apps/api/src/modules/benchmark/benchmark-files.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): GET /benchmarks/:id/files/:alias proxies S3 read

Authed via JwtAuthGuard + user-id ownership check. Streams the S3
object as a StreamableFile with attachment Content-Disposition.
404 / 403 / 404 alias-not-listed are explicit.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Wire all new providers in `benchmark.module.ts`

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.module.ts`

- [ ] **Step 1: Read current module wiring**

```bash
sed -n '1,120p' apps/api/src/modules/benchmark/benchmark.module.ts
```

- [ ] **Step 2: Add storage providers + controller + ReportLoader wiring**

Add imports at top:

```ts
import { REPORT_STORAGE } from "./storage/report-storage.js";
import { S3ReportStorage } from "./storage/s3-report-storage.js";
import { ReportLoader } from "./storage/report-loader.js";
import { BenchmarkFilesController } from "./benchmark-files.controller.js";
```

Add to `controllers: [...]`:

```ts
controllers: [
  BenchmarkController,
  BenchmarkCallbackController,
  BenchmarkFilesController,  // NEW
],
```

Add to `providers: [...]`:

```ts
{
  provide: REPORT_STORAGE,
  useFactory: (config: ConfigService<Env, true>) => new S3ReportStorage({
    endpoint: config.get("S3_ENDPOINT", { infer: true }),
    region: config.get("S3_REGION", { infer: true }),
    accessKeyId: config.get("S3_ACCESS_KEY", { infer: true }),
    secretAccessKey: config.get("S3_SECRET_KEY", { infer: true }),
    bucket: config.get("S3_BUCKET", { infer: true }),
  }),
  inject: [ConfigService],
},
ReportLoader,
```

Find where `K8sJobWatcherService` is wired (the `useFactory` block around line 75 per Phase 1 spec). Inject `ReportLoader` into its deps. Same for `StartupReconciler` — inject `REPORT_STORAGE` + `ReportLoader`.

Example for watcher factory:

```ts
{
  provide: K8sJobWatcherService,
  useFactory: (config, repo, reconciler, reportLoader) => new K8sJobWatcherService({
    mode: config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode,
    namespace: config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }),
    reducerConfig: { /* existing */ },
    makeInformer: () => /* existing */,
    repo,
    reconciler,
    reportLoader,   // NEW
  }),
  inject: [ConfigService, BenchmarkRepository, StartupReconciler, ReportLoader],
},
```

- [ ] **Step 3: Build to verify wiring**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api build
```
Expected: PASS.

- [ ] **Step 4: Run module-level test (if exists) or full unit suite**

```bash
pnpm -F @modeldoctor/api test
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.module.ts
git commit -m "$(cat <<'EOF'
feat(api): wire S3ReportStorage + ReportLoader into benchmark module

REPORT_STORAGE provider constructs S3ReportStorage from env vars;
ReportLoader injected into K8sJobWatcherService and StartupReconciler
factories. BenchmarkFilesController registered alongside the existing
benchmark + callback controllers.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Add boto3 to runner requirements

**Files:**
- Modify: `apps/benchmark-runner/requirements.txt`

- [ ] **Step 1: Inspect current requirements**

```bash
cat apps/benchmark-runner/requirements.txt
```

- [ ] **Step 2: Append boto3**

Add line: `boto3>=1.34,<2`

- [ ] **Step 3: Verify install in a runner build context**

If the project has a runner Dockerfile that pip-installs from requirements.txt, dry-run install locally:

```bash
cd apps/benchmark-runner && python3 -m pip install --dry-run boto3 2>&1 | tail -3
```

Expected: confirms boto3 + botocore + s3transfer dependencies resolve. (If `--dry-run` not supported on local pip, just confirm `pip install boto3` succeeds in a venv.)

- [ ] **Step 4: Commit**

```bash
git add apps/benchmark-runner/requirements.txt
git commit -m "$(cat <<'EOF'
build(runner): add boto3 for S3 report writes

boto3 >=1.34,<2 — used by the new runner/s3_writer.py to write
meta/result/files/stdout/stderr to the shared MinIO bucket.
Image size +~12MB; acceptable since it replaces the entire
callback module's complexity.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Runner `storage_keys.py` (mirror of TS contract)

**Files:**
- Create: `apps/benchmark-runner/runner/storage_keys.py`
- Create: `apps/benchmark-runner/tests/test_storage_keys.py`

- [ ] **Step 1: Write failing test**

```python
# apps/benchmark-runner/tests/test_storage_keys.py
from runner.storage_keys import keys_for, file_key


def test_keys_for_basic():
    k = keys_for("run-abc")
    assert k.meta == "run-abc/meta.json"
    assert k.result == "run-abc/result.json"
    assert k.stdout == "run-abc/stdout.log"
    assert k.stderr == "run-abc/stderr.log"


def test_file_key():
    assert file_key("run-abc", "report.json") == "run-abc/files/report.json"
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd apps/benchmark-runner && python3 -m pytest tests/test_storage_keys.py -v
```
Expected: FAIL — ModuleNotFoundError.

- [ ] **Step 3: Implement**

```python
# apps/benchmark-runner/runner/storage_keys.py
"""Object keys for the shared report storage layer.

Mirror of packages/contracts/src/benchmark.ts:reportStorageKeys.
Keep both in sync — runner writes, API reads, both must agree.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class StorageKeys:
    meta: str
    result: str
    stdout: str
    stderr: str


def keys_for(run_id: str) -> StorageKeys:
    return StorageKeys(
        meta=f"{run_id}/meta.json",
        result=f"{run_id}/result.json",
        stdout=f"{run_id}/stdout.log",
        stderr=f"{run_id}/stderr.log",
    )


def file_key(run_id: str, alias: str) -> str:
    return f"{run_id}/files/{alias}"
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd apps/benchmark-runner && python3 -m pytest tests/test_storage_keys.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/benchmark-runner/runner/storage_keys.py apps/benchmark-runner/tests/test_storage_keys.py
git commit -m "$(cat <<'EOF'
feat(runner): storage_keys.py mirrors contracts reportStorageKeys

Single source of truth for object keys: runner writes <runId>/meta.json
etc.; API ReportLoader reads from the same paths. Plain dataclass —
no boto3 dep needed at this layer.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Runner `s3_writer.py` + moto tests

**Files:**
- Create: `apps/benchmark-runner/runner/s3_writer.py`
- Create: `apps/benchmark-runner/tests/test_s3_writer.py`
- Modify: `apps/benchmark-runner/requirements-dev.txt` (or wherever pytest deps live; add `moto[s3]`)

- [ ] **Step 1: Add moto to dev requirements**

Check current dev-deps location:

```bash
ls apps/benchmark-runner/requirements*.txt
```

Append `moto[s3]>=5,<6` to the dev requirements file (likely `requirements-dev.txt` or `pyproject.toml`).

- [ ] **Step 2: Write failing test**

```python
# apps/benchmark-runner/tests/test_s3_writer.py
import json
import os

import boto3
import pytest
from moto import mock_aws

from runner.s3_writer import S3Writer


@pytest.fixture
def s3_env(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9999")
    monkeypatch.setenv("S3_ACCESS_KEY", "test")
    monkeypatch.setenv("S3_SECRET_KEY", "test")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("S3_REGION", "us-east-1")


@mock_aws
def test_writer_puts_json_text_and_file(s3_env, tmp_path):
    boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-bucket")
    writer = S3Writer.from_env()
    writer.put_json("r1/meta.json", {"toolVersion": "x"})
    writer.put_text("r1/stdout.log", "hello\nworld")
    local = tmp_path / "report.json"
    local.write_text('{"ok":true}')
    writer.put_file("r1/files/report.json", str(local))

    s3 = boto3.client("s3", region_name="us-east-1")
    meta = json.loads(s3.get_object(Bucket="test-bucket", Key="r1/meta.json")["Body"].read())
    assert meta == {"toolVersion": "x"}
    stdout = s3.get_object(Bucket="test-bucket", Key="r1/stdout.log")["Body"].read().decode()
    assert stdout == "hello\nworld"
    report = s3.get_object(Bucket="test-bucket", Key="r1/files/report.json")["Body"].read().decode()
    assert report == '{"ok":true}'


@mock_aws
def test_writer_raises_when_bucket_missing(s3_env):
    # No bucket created — put should raise
    writer = S3Writer.from_env()
    with pytest.raises(Exception):
        writer.put_json("r1/meta.json", {})
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd apps/benchmark-runner && python3 -m pytest tests/test_s3_writer.py -v
```
Expected: FAIL — ModuleNotFoundError.

- [ ] **Step 4: Implement S3Writer**

```python
# apps/benchmark-runner/runner/s3_writer.py
"""boto3 wrapper for runner→S3 writes.

Single-purpose: read S3_* from env, write objects under <runId>/...
Multipart handled automatically by upload_file for objects >5MB.
"""

from __future__ import annotations

import json
import os

import boto3
from botocore.config import Config


class S3Writer:
    @classmethod
    def from_env(cls) -> "S3Writer":
        return cls(
            endpoint=os.environ["S3_ENDPOINT"],
            access_key=os.environ["S3_ACCESS_KEY"],
            secret_key=os.environ["S3_SECRET_KEY"],
            bucket=os.environ["S3_BUCKET"],
            region=os.environ.get("S3_REGION", "us-east-1"),
        )

    def __init__(self, *, endpoint: str, access_key: str, secret_key: str, bucket: str, region: str):
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(
                signature_version="s3v4",
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=5,
                read_timeout=30,
            ),
        )
        self.bucket = bucket

    def put_json(self, key: str, obj: object) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json")

    def put_text(self, key: str, text: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=text.encode("utf-8"), ContentType="text/plain; charset=utf-8")

    def put_file(self, key: str, local_path: str) -> None:
        # upload_file handles multipart automatically for objects > 5MB
        self.client.upload_file(local_path, self.bucket, key)
```

- [ ] **Step 5: Run test to verify pass**

```bash
cd apps/benchmark-runner && python3 -m pytest tests/test_s3_writer.py -v
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/benchmark-runner/runner/s3_writer.py apps/benchmark-runner/tests/test_s3_writer.py apps/benchmark-runner/requirements-dev.txt
git commit -m "$(cat <<'EOF'
feat(runner): S3Writer — boto3 wrapper for report uploads

put_json / put_text / put_file. upload_file auto-multiparts for
objects > 5MB (vegeta attack.bin will hit this regularly). Tests
use moto[s3] to mock S3 in-memory; no MinIO required for CI.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Rewrite `runner/main.py` to write S3 instead of POST /state /finish

**Files:**
- Modify: `apps/benchmark-runner/runner/main.py`
- Modify: `apps/benchmark-runner/tests/test_main.py`

This is the biggest single change in the plan. Approach: rewrite the main flow, keep StreamPump's `post_log_batch` invocation intact (Phase 3 territory).

- [ ] **Step 1: Read current main.py end-to-end**

```bash
cat apps/benchmark-runner/runner/main.py
```

Identify:
- Where `post_state_running` is called (likely right after `detect_tool_version`)
- Where `post_finish` is called (end of run, with rawOutput + files)
- Where output files are gathered (probably from CLI args + StreamPump)

- [ ] **Step 2: Modify `main.py` — replace post_state_running and post_finish with S3 writes**

Top of file:

```python
# DELETE
from runner.callback import post_finish, post_log_batch, post_state_running
# REPLACE with
from runner.callback import post_log_batch
from runner.s3_writer import S3Writer
from runner.storage_keys import file_key, keys_for
```

In main flow, after `tool_version = detect_tool_version(...)`:

```python
# REMOVE: post_state_running(... tool_version ...)
# REPLACE with:
s3 = S3Writer.from_env()
keys = keys_for(run_id)
s3.put_json(keys.meta, {
    "toolVersion": tool_version or "",
    "startTimeIso": iso_now(),  # use existing datetime utility
})
```

At end of run (after subprocess + StreamPump joins):

```python
# REMOVE the existing post_finish(...) call entirely
# REPLACE with:
finish_time = iso_now()

# Upload output files — adapt to whatever current code uses to collect them
files_map: dict[str, str] = {}
for alias, local_path in collect_output_files(args).items():  # whatever existing fn is
    rel = f"files/{alias}"
    s3.put_file(file_key(run_id, alias), str(local_path))
    files_map[alias] = rel

# Upload stdout/stderr tails (full buffer from StreamPump, NOT capped to 64KB —
# API-side ReportLoader will tail-cap. Runner writes everything so partial
# reads still see context).
s3.put_text(keys.stdout, stdout_pump.full_buffer())
s3.put_text(keys.stderr, stderr_pump.full_buffer())

# result.json is the sentinel — write LAST.
s3.put_json(keys.result, {
    "exitCode": proc.returncode,
    "finishTimeIso": finish_time,
    "files": files_map,
})

sys.exit(proc.returncode)
```

Critical invariant: **any S3 write failure must propagate up, causing non-zero exit so pod.phase=Failed**. boto3 raises by default; don't add `try/except` around the writes in the main path.

Pseudocode template — adapt to actual variable names in current `main.py`. The key swaps:
1. `post_state_running` → `s3.put_json(keys.meta, ...)`
2. `post_finish(state=..., files={alias: base64_bytes}, ...)` → multiple `s3.put_file` + final `s3.put_json(keys.result, ...)`
3. `post_log_batch` stays — log batching still goes through callback in Phase 2

- [ ] **Step 3: Update `tests/test_main.py`**

The existing test mocks `post_finish` etc. We now need to mock `S3Writer` (or use moto end-to-end). Simpler: mock `S3Writer.from_env` to return a Mock with `put_json/put_text/put_file` spies.

Add test:

```python
from unittest.mock import patch, MagicMock

@patch("runner.main.S3Writer")
def test_main_writes_meta_then_result_with_files_between(MockS3, ...existing fixtures...):
    writer = MagicMock()
    MockS3.from_env.return_value = writer
    # ... run main with a fake tool that exits 0
    main(...)
    # verify call order
    calls = [c.args[0] for c in writer.put_json.call_args_list + writer.put_text.call_args_list + writer.put_file.call_args_list]
    assert calls.index("r1/meta.json") < calls.index("r1/result.json")
    # verify last call is result.json
    last_json_call = writer.put_json.call_args_list[-1]
    assert last_json_call.args[0] == "r1/result.json"

@patch("runner.main.S3Writer")
def test_main_exits_nonzero_when_s3_put_raises(MockS3, ...existing fixtures...):
    writer = MagicMock()
    writer.put_file.side_effect = RuntimeError("s3 down")
    MockS3.from_env.return_value = writer
    with pytest.raises(RuntimeError):
        main(...)
```

Delete tests that exercise `post_state_running` / `post_finish` paths.

- [ ] **Step 4: Run tests**

```bash
cd apps/benchmark-runner && python3 -m pytest tests/test_main.py -v
```
Expected: PASS (with new path); old failing tests deleted.

- [ ] **Step 5: Commit**

```bash
git add apps/benchmark-runner/runner/main.py apps/benchmark-runner/tests/test_main.py
git commit -m "$(cat <<'EOF'
feat(runner): write S3 report instead of POST /state /finish

Replaces post_state_running / post_finish calls with S3 writes via
S3Writer. Key sequence: meta.json (start) → files → stdout/stderr →
result.json (sentinel, LAST). Any S3 failure raises, leading to
pod.phase=Failed, which the watcher resolves via failed-terminal.

post_log_batch retained — /log callback is Phase 3.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Delete `/state` + `/finish` handlers and contracts schemas

**Files:**
- Modify: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts` (delete two handlers)
- Modify: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` (delete corresponding cases)
- Modify: `packages/contracts/src/benchmark.ts` (delete two schemas + their types)
- Modify: `apps/benchmark-runner/runner/callback.py` (delete two functions)

- [ ] **Step 1: Remove handlers from API controller**

In `benchmark-callback.controller.ts`, delete:
- `@Post("state") handleState(...)` and its entire method body
- `@Post("finish") handleFinish(...)` and its entire method body
- Imports: `benchmarkStateCallbackSchema`, `benchmarkFinishCallbackSchema`, `BenchmarkStateCallback`, `BenchmarkFinishCallback`, `byTool`, `ToolName` (if only used by handleFinish), `Prisma` (likewise), `ZodValidationPipe` (if only used here)

Verify only `handleLog` remains:

```bash
grep -n "@Post\|handleState\|handleFinish\|handleLog" apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts
```

- [ ] **Step 2: Remove corresponding test cases**

In `benchmark-callback.controller.spec.ts`, delete every `it(...)` block that calls `ctrl.handleState` or `ctrl.handleFinish`. Keep `handleLog` cases.

- [ ] **Step 3: Delete contracts schemas + types**

In `packages/contracts/src/benchmark.ts`, delete:
- `benchmarkStateCallbackSchema` + `BenchmarkStateCallback` type
- `benchmarkFinishCallbackSchema` + `BenchmarkFinishCallback` type

Keep `benchmarkLogCallbackSchema` + `BenchmarkLogCallback`.

If these are re-exported in a barrel `packages/contracts/src/index.ts`, remove those re-exports too:

```bash
grep -n "benchmarkStateCallback\|benchmarkFinishCallback" packages/contracts/src/index.ts
```

- [ ] **Step 4: Delete runner callback functions**

In `apps/benchmark-runner/runner/callback.py`, delete `post_state_running` and `post_finish` functions and any imports only they need. Keep `post_log_batch`.

- [ ] **Step 5: Type-check + test API**

```bash
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test
```
Expected: PASS. If type-check fails because something still imports the deleted schemas, follow up and clean.

- [ ] **Step 6: Test runner**

```bash
cd apps/benchmark-runner && python3 -m pytest -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts \
        apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts \
        packages/contracts/src/benchmark.ts \
        packages/contracts/src/index.ts \
        apps/benchmark-runner/runner/callback.py
git commit -m "$(cat <<'EOF'
refactor: delete /state + /finish callback endpoints — replaced by S3 + watcher

API:
- delete handleState + handleFinish from BenchmarkCallbackController
- delete benchmarkStateCallback + benchmarkFinishCallback schemas + types
- delete corresponding controller-spec cases

Runner:
- delete post_state_running + post_finish from callback.py

Keeping /log + benchmarkLogCallback + HmacCallbackGuard + post_log_batch
(Phase 3 will retire those).

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: End-to-end test — watcher primary path

**Files:**
- Create: `apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts`
- Delete: `apps/api/test/e2e/benchmark-callback.e2e-spec.ts` (if exists and contains /state /finish e2e)

- [ ] **Step 1: Check if a callback e2e currently exists for /state /finish**

```bash
ls apps/api/test/e2e/ | grep -i callback
```

If a file exclusively tests /state /finish, delete it (Task 17 already deletes the controller handlers, so its tests will fail). If the file has /log tests too, delete only the /state /finish blocks.

- [ ] **Step 2: Write new e2e**

```ts
// apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { mockClient } from "aws-sdk-client-mock";
import nock from "nock";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupE2EApp, teardownE2EApp, type E2EAppContext } from "../setup/e2e-app.js";
import { E2E_ENV_DEFAULTS } from "../setup/e2e-env-defaults.js";

const s3Mock = mockClient(S3Client);

function body(s: string) {
  return Readable.from([Buffer.from(s, "utf8")]) as never;
}

describe("Benchmark watcher primary mode (e2e)", () => {
  let ctx: E2EAppContext;

  beforeAll(async () => {
    ctx = await setupE2EApp({
      env: { ...E2E_ENV_DEFAULTS, K8S_WATCHER_MODE: "primary" },
    });
  });

  beforeEach(() => { s3Mock.reset(); nock.cleanAll(); });
  afterEach(() => { s3Mock.reset(); nock.cleanAll(); });

  it("Succeeded pod → ReportLoader reads S3 → benchmark.status=completed", async () => {
    // 1. Seed benchmark in 'running' status owned by ctx.testUser
    const benchId = "00000000-0000-0000-0000-000000000001";
    await ctx.prisma.benchmark.create({
      data: {
        id: benchId,
        userId: ctx.testUser.id,
        status: "running",
        tool: "guidellm",
        scenario: "inference",
        name: "e2e-watcher-primary",
        params: {},
        connectionId: null,
      },
    });

    // 2. Mock S3 returns fixture meta + result + stdout/stderr + file
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/meta.json` }).resolves({ Body: body(JSON.stringify({ toolVersion: "guidellm 0.2.1", startTimeIso: "2026-05-25T00:00:00.000Z" })) });
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/result.json` }).resolves({ Body: body(JSON.stringify({ exitCode: 0, finishTimeIso: "2026-05-25T01:00:00.000Z", files: { "report.json": "files/report.json" } })) });
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/stdout.log` }).resolves({ Body: body("PROGRESS:1.0\nDone") });
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/stderr.log` }).resolves({ Body: body("") });
    s3Mock.on(GetObjectCommand, { Key: `${benchId}/files/report.json` }).resolves({ Body: body('{"latency_p50":42}') });

    // 3. Simulate watcher event by calling ReportLoader directly (or trigger via informer fixture if your e2e plumbing supports it)
    await ctx.app.get("ReportLoader").tryLoad(benchId);

    // 4. Assert row updated
    const row = await ctx.prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("completed");
    expect(row.toolVersion).toBe("guidellm 0.2.1");
    expect(row.summaryMetrics).toMatchObject({ tool: "guidellm" });
    expect(row.completedAt).toBeTruthy();
  });

  it("Succeeded pod but result.json missing → failed with statusMessage", async () => {
    const benchId = "00000000-0000-0000-0000-000000000002";
    await ctx.prisma.benchmark.create({ data: { id: benchId, userId: ctx.testUser.id, status: "running", tool: "guidellm", scenario: "inference", name: "missing-report", params: {}, connectionId: null } });
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));
    await ctx.app.get("ReportLoader").tryLoad(benchId);
    const row = await ctx.prisma.benchmark.findUniqueOrThrow({ where: { id: benchId } });
    expect(row.status).toBe("failed");
    expect(row.statusMessage).toContain("report load");
  });
});
```

> If your `setupE2EApp` doesn't already expose a way to override env or yield the Nest container directly, adapt to the actual plumbing — `e2e/playwright.config.ts` and existing e2e specs are precedent.

- [ ] **Step 3: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e -- benchmark-watcher-primary
```
Expected: PASS (both cases).

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(api): e2e for watcher primary mode + ReportLoader

Two scenarios:
1. S3 has a full fixture (meta/result/stdout/file) → ReportLoader
   writes status=completed with parsed summaryMetrics.
2. S3 returns NoSuchKey → ReportLoader writes status=failed with
   statusMessage containing 'report load: ...'.

S3 client mocked with aws-sdk-client-mock. K8S_WATCHER_MODE=primary
forced via env override on the app fixture.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Operations docs — MinIO bucket setup

**Files:**
- Modify: `deploy/k8s/README.md`

- [ ] **Step 1: Read current README**

```bash
cat deploy/k8s/README.md
```

- [ ] **Step 2: Append a `## Report storage (MinIO / S3)` section**

```markdown
## Report storage (MinIO / S3)

Phase 2 of #237 — runner writes benchmark reports to a shared bucket;
API reads them at terminal phase. The bucket and credentials must
exist BEFORE the API and runner Job can run.

### 1. Configure a bucket lifecycle (once per environment)

```bash
mc alias set myminio http://10.100.121.67:31871 <access-key> <secret-key>
mc ilm rule add --expire-days 30 myminio/<bucket>
```

30 days is the V1 retention. Adjust as ops sees fit; just don't go shorter
than the longest expected benchmark duration plus a few hours of investigation buffer.

### 2. Create the K8s Secret

The runner Job mounts `md-benchmark-storage` in the benchmarks namespace,
and the API reads the same values from its own pod env.

```bash
kubectl -n modeldoctor-benchmarks create secret generic md-benchmark-storage \
  --from-literal=S3_ENDPOINT=http://10.100.121.67:31871 \
  --from-literal=S3_ACCESS_KEY=<key> \
  --from-literal=S3_SECRET_KEY=<secret> \
  --from-literal=S3_BUCKET=<bucket> \
  --from-literal=S3_REGION=us-east-1
# Same Secret in the API namespace too (if different from modeldoctor-benchmarks)
kubectl -n modeldoctor create secret generic md-benchmark-storage --from-literal=...
```

### 3. Verify with `mc`

```bash
mc ls myminio/<bucket>/  # should succeed
```

### Pre-deploy checklist (Phase 2)

- [ ] MinIO bucket exists with lifecycle configured
- [ ] `md-benchmark-storage` Secret exists in both namespaces
- [ ] No long-running in-flight benchmark when deploying (recommended; otherwise
      it will be auto-failed by the watcher after pod phase transitions)
- [ ] `K8S_WATCHER_MODE=primary` (now the env-schema default, no override needed)
```

- [ ] **Step 3: Commit**

```bash
git add deploy/k8s/README.md
git commit -m "$(cat <<'EOF'
docs(deploy): MinIO bucket + Secret setup for Phase 2

Operator instructions: create bucket, configure 30-day lifecycle,
create md-benchmark-storage Secret in both API and benchmarks
namespaces. Pre-deploy checklist for Phase 2 ramp.

refs #237

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: Full local verification + PR prep

- [ ] **Step 1: Run the full API test suite**

```bash
pnpm -F @modeldoctor/api test
```
Expected: all green.

- [ ] **Step 2: Run the full runner test suite**

```bash
cd apps/benchmark-runner && python3 -m pytest -v
```
Expected: all green.

- [ ] **Step 3: Run contracts + workspace build**

```bash
pnpm -r build
```
Expected: all packages build clean.

- [ ] **Step 4: Lint + type-check sweep**

```bash
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/contracts type-check
```
Expected: all clean.

- [ ] **Step 5: Run the API e2e suite (real Postgres, mocked S3 + K8s)**

```bash
pnpm test:e2e:api
```
Expected: all green, including the new `benchmark-watcher-primary.e2e-spec.ts`.

- [ ] **Step 6: Browser e2e**

```bash
pnpm test:e2e:browser
```
Expected: existing benchmark.spec.ts still passes (SSE / detail page unchanged).

- [ ] **Step 7: Push branch + open PR**

```bash
git push -u origin feat/phase2-watcher-primary-and-storage
gh pr create --title "feat: Phase 0+2 — report shared storage + watcher primary mode" --body "$(cat <<'EOF'
## Summary

Atomic rewrite of runner→API status flip + final report channel for #237 Phase 2,
folding in Phase 0 (shared storage layer) since `ReportLoader` is tightly coupled
to `ReportStorage`.

After this PR:
- runner writes `meta.json` / `result.json` / `stdout.log` / `stderr.log` /
  `files/*` to a shared S3-compatible bucket (MinIO in dev, real S3 in prod)
- API `K8sJobWatcherService` in `primary` mode handles `running` / `Succeeded` /
  `Failed` directly via informer + `ReportLoader` (no callback)
- `/state` and `/finish` callback endpoints + runner POST calls **deleted**
  (clean slate, no deprecated no-op)
- `/log` callback path **unchanged** — Phase 3 will retire it

## Spec / Plan

- Spec: `docs/superpowers/specs/2026-05-25-report-storage-and-watcher-primary-design.md`
- Plan: `docs/superpowers/plans/2026-05-25-report-storage-and-watcher-primary.md`

## Pre-deploy (operator)

See `deploy/k8s/README.md` "Report storage" section. Required:

1. `md-benchmark-storage` Secret in both API and benchmarks namespaces
2. MinIO bucket lifecycle (30-day expire) configured
3. (Recommended) drain in-flight benchmarks before deploy

## Test plan

- [ ] `pnpm -F @modeldoctor/api test` green
- [ ] `pnpm test:e2e:api` green including new `benchmark-watcher-primary.e2e-spec.ts`
- [ ] `pnpm -F @modeldoctor/benchmark-runner test` green (rename to your actual pytest cmd)
- [ ] Browser e2e: `pnpm test:e2e:browser` — existing benchmark spec passes
- [ ] Manual cluster smoke: run a real benchmark against dev MinIO; verify
      meta.json / result.json / stdout.log written, API marks completed with
      parsed summaryMetrics

refs #237

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Watch CI**

```bash
gh pr checks --watch
```

Verify all checks pass. If anything red, fix in follow-up commit on the same branch — do not close + reopen.

---

## Self-review checklist (do NOT skip — run BEFORE handing back)

After completing all tasks, run this cold-read against the spec:

1. **Spec §1 Scope coverage:**
   - [ ] §1 in-scope items each map to a task above?
   - [ ] §1 out-of-scope items (Phase 3 / 4) NOT touched by any task?
2. **Spec §2 Storage interface:**
   - [ ] `reportStorageKeys` exists in contracts? (Task 1)
   - [ ] `ReportStorage` interface + `S3ReportStorage` impl exists? (Tasks 3, 5)
3. **Spec §3 K8s Secret:**
   - [ ] Job manifest injects `md-benchmark-storage`? (Task 10)
4. **Spec §4 reducer:**
   - [ ] `mode` + `running` + `load-report` transitions wired? (Task 6, 8)
5. **Spec §5 ReportLoader:**
   - [ ] 5-path coverage + `updateGuarded` guard + sse.close in finally? (Task 7)
6. **Spec §6 Watcher / Reconciler:**
   - [ ] Primary mode no longer throws? (Task 8)
   - [ ] Reconciler storage-first? (Task 9)
7. **Spec §7 Runner:**
   - [ ] `meta.json` written at start (Task 16)?
   - [ ] `result.json` written LAST as sentinel (Task 16)?
   - [ ] Any S3 write failure → non-zero exit (Task 16)?
8. **Spec §"Code deletions":**
   - [ ] All deletions covered? (Task 17)
9. **Spec §Testing:**
   - [ ] Unit tests: reducer matrix, S3 storage, ReportLoader 5-path, files controller (Tasks 5, 6, 7, 11)?
   - [ ] e2e: primary mode + storage missing (Task 18)?
   - [ ] Runner pytest: storage_keys + s3_writer + main (Tasks 14, 15, 16)?
10. **Spec §Migration / Rollout:**
    - [ ] Docs updated? (Task 19)

If any box ends up unchecked, add a task to cover the gap before opening the PR.
