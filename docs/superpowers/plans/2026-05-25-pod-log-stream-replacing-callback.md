# Phase 3 — Pod log stream replacing /log callback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runner→API `/log` callback channel with an API-pulled `Log.log(follow:true)` stream per pod, and delete the entire HMAC callback framework (controller, guard, hmac-token, env secret/url, runner callback.py, MD_CALLBACK_* envs).

**Architecture:** New `PodLogStreamerPool` (singleton) holds per-runId `PodLogStreamer` instances. `K8sJobWatcherService` calls `pool.start(runId, podName, tool)` (idempotent) when it sees `pod.phase=Running` + container ready; calls `await pool.drainAndStop(runId, 5000|0)` before invoking `reportLoader.tryLoad` / `repo.updateGuarded` on terminal events; calls `pool.stop(runId)` on pod delete. Each streamer pipes K8s log chunks → PassThrough → readline → adapter.parseProgress → SseHub + 1Hz throttled DB write. Reconnect on stream error with `sinceSeconds=10`, backoff [1s, 2s, 4s], give up after 3 failures.

**Tech Stack:** TypeScript (NestJS 10, vitest 2), `@kubernetes/client-node@0.21.0`, Node `readline` + `stream.PassThrough`, Python 3.11 runner. RBAC: K8s `pods/log:get`.

**Branch:** `feat/phase-3-pod-log-stream` (worktree at `/Users/fangyong/vllm/modeldoctor/phase-3-pod-log-stream/`). Spec: `docs/superpowers/specs/2026-05-25-pod-log-stream-replacing-callback-design.md`.

**Commit discipline:** Single PR, phase-per-commit. Each phase ends with `git add <explicit files>` + `git commit -m "<type>: <desc>"` body ending with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Working directory throughout:** `/Users/fangyong/vllm/modeldoctor/phase-3-pod-log-stream/`. All paths below are relative to that root.

---

## File Structure (locked at plan time)

**Created:**
- `apps/api/src/modules/benchmark/k8s/progress-throttle.ts` — `ProgressThrottle` class (1Hz trailing DB write)
- `apps/api/src/modules/benchmark/k8s/progress-throttle.spec.ts` — unit tests
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts` — `PodLogStreamer` class (state machine + reconnect)
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer.spec.ts`
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts` — `PodLogStreamerFactory` (handleLine closure + `probeRbac`)
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.spec.ts`
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts` — `PodLogStreamerPool` (Map + OnModuleInit/Destroy)
- `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.spec.ts`
- `apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts` — e2e (mock K8s Log + watch)

**Modified:**
- `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts` — wire pool into deps, `handlePodEvent` attach tail, `handlePodDelete` stop, `execute` terminal drain
- `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts` — attach/drain/delete cases
- `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts` — drop `MD_CALLBACK_URL` env + `MD_CALLBACK_TOKEN` secret entry
- `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts` — drop the same assertions
- `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts` — drop `BenchmarkRunInput.callback` field
- `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.spec.ts` — drop `callback:` from fixtures
- `apps/api/src/modules/benchmark/benchmark.service.ts` — drop `callbackSecret` / `callbackUrl` ctor fields + `signCallbackToken` call + `callback:` ctx
- `apps/api/src/modules/benchmark/benchmark.service.spec.ts` — drop callback-related env + spy
- `apps/api/src/modules/benchmark/benchmark.controller.spec.ts` — drop `BENCHMARK_CALLBACK_URL` env
- `apps/api/src/modules/benchmark/benchmark.module.ts` — drop `BenchmarkCallbackController` controller; add `PodLogStreamerPool` / `PodLogStreamerFactory` / `K8S_LOG_CLIENT` / `K8S_NAMESPACE` providers; pass `pool` into `K8sJobWatcherService` deps; mode=off uses NoopPodLogStreamerPool stub
- `apps/api/src/config/env.schema.ts` — delete `BENCHMARK_CALLBACK_SECRET` + `BENCHMARK_CALLBACK_URL`
- `apps/api/src/config/env.spec.ts` — drop those keys from `validEnv()` + the two require-tests
- `apps/api/test/setup/e2e-env-defaults.ts` — drop both keys
- `e2e/playwright.config.ts` — drop `BENCHMARK_CALLBACK_URL` env injection
- `packages/contracts/src/benchmark.ts` — delete `benchmarkLogCallbackSchema` + `BenchmarkLogCallback` type
- `deploy/k8s/rbac.yaml` — split pods rule, add `pods/log:get`
- `apps/benchmark-runner/runner/main.py` — drop `callback_url`/`token` env reads + `StreamPump.callback_url|token|benchmark_id` params + `_flush()` + `LOG_BATCH_INTERVAL_SEC`
- `apps/benchmark-runner/tests/test_main.py` — drop `post_log_batch` mock + assertions; keep buffer/tail tests

**Deleted (full file):**
- `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`
- `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts`
- `apps/api/src/modules/benchmark/callbacks/` (empty dir)
- `apps/api/src/common/hmac/hmac-callback.guard.ts`
- `apps/api/src/common/hmac/hmac-callback.guard.spec.ts`
- `apps/api/src/common/hmac/hmac-token.ts`
- `apps/api/src/common/hmac/hmac-token.spec.ts`
- `apps/api/src/common/hmac/` (empty dir)
- `apps/benchmark-runner/runner/callback.py`
- `apps/benchmark-runner/tests/test_callback.py`

---

## Phase 1 — `ProgressThrottle`

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/progress-throttle.ts`
- Create: `apps/api/src/modules/benchmark/k8s/progress-throttle.spec.ts`

### Steps

- [ ] **Step 1.1: Write failing spec**

Create `apps/api/src/modules/benchmark/k8s/progress-throttle.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ProgressThrottle } from "./progress-throttle.js";

function makeRepo() {
  return { update: vi.fn(async () => undefined) };
}

describe("ProgressThrottle", () => {
  it("writes the first tick immediately (lastWriteAt=0)", async () => {
    const repo = makeRepo();
    const clock = vi.fn(() => 1_000);
    const throttle = new ProgressThrottle("r1", repo as never, 1000, clock);
    throttle.tick(0.1);
    // tick() schedules a microtask via void this.flushNow(); await it.
    await new Promise((r) => setImmediate(r));
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith("r1", { progress: 0.1 });
  });

  it("coalesces successive ticks inside the window into one trailing write", async () => {
    const repo = makeRepo();
    let now = 1_000;
    const clock = () => now;
    vi.useFakeTimers();
    const throttle = new ProgressThrottle("r1", repo as never, 1000, clock);
    throttle.tick(0.1);
    await new Promise((r) => setImmediate(r));
    expect(repo.update).toHaveBeenCalledTimes(1);
    // Inside window: should defer
    now = 1_200;
    throttle.tick(0.2);
    now = 1_500;
    throttle.tick(0.3);
    now = 1_800;
    throttle.tick(0.4);
    expect(repo.update).toHaveBeenCalledTimes(1);
    // Timer fires at lastWriteAt+windowMs = 2000
    now = 2_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenLastCalledWith("r1", { progress: 0.4 });
    vi.useRealTimers();
  });

  it("flushNow drains pending and clears timer", async () => {
    const repo = makeRepo();
    let now = 1_000;
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => now);
    throttle.tick(0.1);
    await new Promise((r) => setImmediate(r));
    now = 1_500;
    throttle.tick(0.5);
    await throttle.flushNow();
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(repo.update).toHaveBeenLastCalledWith("r1", { progress: 0.5 });
  });

  it("flushNow with no pending is a no-op", async () => {
    const repo = makeRepo();
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    await throttle.flushNow();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("swallows repo.update errors (progress is best-effort)", async () => {
    const repo = { update: vi.fn(async () => { throw new Error("db down"); }) };
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    throttle.tick(0.1);
    await new Promise((r) => setImmediate(r));
    // No throw escaped
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 1.2: Verify it fails**

```bash
cd /Users/fangyong/vllm/modeldoctor/phase-3-pod-log-stream
pnpm -F @modeldoctor/api test -- progress-throttle.spec.ts
```

Expected: FAIL with `Cannot find module './progress-throttle.js'`.

- [ ] **Step 1.3: Implement**

Create `apps/api/src/modules/benchmark/k8s/progress-throttle.ts`:

```ts
import type { BenchmarkRepository } from "../benchmark.repository.js";

/** 1Hz trailing throttle for benchmark.progress DB writes.
 *  Coalesces high-frequency progress ticks (line-rate) into ≤ 1 write/sec/run.
 *  Last value wins; flushNow() drains any pending tick (called from pool
 *  drainAndStop / stop / onModuleDestroy so the terminal value is durable). */
export class ProgressThrottle {
  private pendingPct: number | null = null;
  private lastWriteAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runId: string,
    private readonly repo: Pick<BenchmarkRepository, "update">,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tick(pct: number): void {
    this.pendingPct = pct;
    const elapsed = this.clock() - this.lastWriteAt;
    if (elapsed >= this.windowMs) {
      void this.flushNow();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flushNow(), this.windowMs - elapsed);
    }
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingPct === null) return;
    const pct = this.pendingPct;
    this.pendingPct = null;
    this.lastWriteAt = this.clock();
    try {
      await this.repo.update(this.runId, { progress: pct });
    } catch {
      // progress is best-effort; final value lands via the ReportLoader path
    }
  }
}
```

- [ ] **Step 1.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/api test -- progress-throttle.spec.ts
```

Expected: 5 passing.

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/progress-throttle.ts apps/api/src/modules/benchmark/k8s/progress-throttle.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): ProgressThrottle — 1Hz trailing coalesce for benchmark.progress writes

Per Phase 3 spec D2: PodLogStreamerPool will tick this on every progress
line from the K8s log stream; throttle coalesces line-rate updates into
≤ 1 DB write/sec/run. flushNow() drains pending value on pool drainAndStop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — `PodLogStreamer`

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts`
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer.spec.ts`

### Steps

- [ ] **Step 2.1: Write failing spec**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer.spec.ts`:

```ts
import { Logger } from "@nestjs/common";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PodLogStreamer } from "./pod-log-streamer.js";

function makeK8sLogMock(streams: PassThrough[]) {
  let i = 0;
  return {
    log: vi.fn(async (_ns, _pod, _container, sink) => {
      const passthrough = streams[i++];
      if (!passthrough) throw new Error(`k8sLog.log called too many times (i=${i})`);
      // Pipe our test passthrough → caller's sink so 'end'/'error' propagate
      passthrough.pipe(sink as PassThrough);
      return { abort: vi.fn() };
    }),
  };
}

const fakeLog = new Logger("test");

describe("PodLogStreamer", () => {
  it("emits handleLine per line, resolves on clean EOF", async () => {
    const stream = new PassThrough();
    const k8s = makeK8sLogMock([stream]);
    const lines: string[] = [];
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, (l) => lines.push(l), fakeLog,
    );
    const done = streamer.run();
    stream.write("alpha\n");
    stream.write("beta\ngamma\n");
    stream.end();
    await done;
    expect(lines).toEqual(["alpha", "beta", "gamma"]);
    expect(k8s.log).toHaveBeenCalledTimes(1);
  });

  it("reconnects with sinceSeconds=10 after one error", async () => {
    const s1 = new PassThrough();
    const s2 = new PassThrough();
    const k8s = makeK8sLogMock([s1, s2]);
    const lines: string[] = [];
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, (l) => lines.push(l), fakeLog,
    );
    const done = streamer.run();
    s1.write("first\n");
    s1.destroy(new Error("connection reset"));
    // wait for reconnect backoff (1s) + flow continues
    await new Promise((r) => setTimeout(r, 1100));
    s2.write("after-reconnect\n");
    s2.end();
    await done;
    expect(lines).toContain("first");
    expect(lines).toContain("after-reconnect");
    expect(k8s.log).toHaveBeenCalledTimes(2);
    expect(k8s.log.mock.calls[1][4]).toEqual({ follow: true, sinceSeconds: 10 });
  }, 10_000);

  it("gives up after 3 consecutive failures", async () => {
    const streams = [new PassThrough(), new PassThrough(), new PassThrough()];
    const k8s = makeK8sLogMock(streams);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    const done = streamer.run();
    for (const s of streams) s.destroy(new Error("boom"));
    // backoff: 1s + 2s = 3s minimum between attempts
    await done;
    expect(k8s.log).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("abort() stops the loop and prevents further reconnects", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    const done = streamer.run();
    s1.write("x\n");
    streamer.abort();
    s1.destroy(new Error("after abort"));  // should not trigger reconnect
    await done;
    expect(k8s.log).toHaveBeenCalledTimes(1);
  });

  it("drainOrTimeout(0) aborts immediately", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    void streamer.run();
    await streamer.drainOrTimeout(0);
    // run() resolves once state=STOPPED
  });

  it("drainOrTimeout(timeoutMs) waits for natural EOF or aborts", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    void streamer.run();
    // No EOF — should timeout
    const t0 = Date.now();
    await streamer.drainOrTimeout(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });

  it("handleLine throw does not crash the loop", async () => {
    const stream = new PassThrough();
    const k8s = makeK8sLogMock([stream]);
    let count = 0;
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never,
      () => { count++; throw new Error("oops"); },
      fakeLog,
    );
    const done = streamer.run();
    stream.write("a\nb\n");
    stream.end();
    await done;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2.2: Verify it fails**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer.spec.ts
```

Expected: FAIL `Cannot find module './pod-log-streamer.js'`.

- [ ] **Step 2.3: Implement**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts`:

```ts
import type * as k8s from "@kubernetes/client-node";
import type { Logger } from "@nestjs/common";
import * as readline from "node:readline";
import { PassThrough } from "node:stream";

type StreamerState = "IDLE" | "STREAMING" | "RECONNECTING" | "STOPPED";

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];
const MAX_CONSECUTIVE_FAILURES = 3;

function createDeferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Per-runId K8s pod log streamer. State machine:
 *    IDLE → STREAMING → (EOF) STOPPED
 *                    → (error) RECONNECTING → STREAMING (up to 3 attempts)
 *                                          → (give up) STOPPED
 *    abort() at any time → STOPPED (no further reconnects).
 *  The streamer does not know about tools, SSE, DB — handleLine is injected.
 *  All errors are swallowed (logged); upstream pool / watcher are not exposed
 *  to streamer faults. */
export class PodLogStreamer {
  private state: StreamerState = "IDLE";
  private currentReq: { abort(): void } | null = null;
  private consecutiveFailures = 0;
  private readonly eof = createDeferred<void>();

  constructor(
    private readonly runId: string,
    private readonly podName: string,
    private readonly container: string,
    private readonly namespace: string,
    private readonly k8sLog: Pick<k8s.Log, "log">,
    private readonly handleLine: (line: string) => void,
    private readonly log: Logger,
  ) {}

  async run(): Promise<void> {
    while (this.state !== "STOPPED" && this.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      this.state = "STREAMING";
      const passthrough = new PassThrough();
      const rl = readline.createInterface({ input: passthrough, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          this.handleLine(line);
        } catch (e) {
          this.log.warn(`handleLine threw for ${this.runId}: ${(e as Error).message}`);
        }
      });

      const opts: k8s.LogOptions = { follow: true };
      if (this.consecutiveFailures > 0) opts.sinceSeconds = 10;

      try {
        this.currentReq = await this.k8sLog.log(
          this.namespace, this.podName, this.container, passthrough, opts,
        );
        await new Promise<void>((resolve, reject) => {
          passthrough.on("end", () => resolve());
          passthrough.on("error", (e) => reject(e));
        });
        this.consecutiveFailures = 0;
        break;
      } catch (e) {
        this.consecutiveFailures += 1;
        if (this.state === "STOPPED") break;
        this.log.warn(
          `stream broke for ${this.runId} (attempt ${this.consecutiveFailures}): ${(e as Error).message}`,
        );
        this.state = "RECONNECTING";
        const idx = this.consecutiveFailures - 1;
        const backoff = RECONNECT_BACKOFF_MS[idx] ?? RECONNECT_BACKOFF_MS.at(-1)!;
        await sleep(backoff);
      } finally {
        rl.close();
      }
    }
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.log.warn(`giving up on log stream for ${this.runId} after ${MAX_CONSECUTIVE_FAILURES} failures`);
    }
    this.state = "STOPPED";
    this.eof.resolve();
  }

  abort(): void {
    if (this.state === "STOPPED") return;
    this.state = "STOPPED";
    try {
      this.currentReq?.abort();
    } catch {
      // request may already be closed
    }
    this.eof.resolve();
  }

  async drainOrTimeout(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) {
      this.abort();
      return;
    }
    const drained = this.eof.promise.then(() => "drained" as const);
    const timeout = sleep(timeoutMs).then(() => "timeout" as const);
    const r = await Promise.race([drained, timeout]);
    if (r === "timeout") this.abort();
  }
}
```

- [ ] **Step 2.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer.spec.ts
```

Expected: 7 passing. Note tests 2.3 ("reconnects after error") and 2.4 ("gives up after 3") use real timers — they take 1-15s each.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts apps/api/src/modules/benchmark/k8s/pod-log-streamer.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): PodLogStreamer — per-pod K8s log stream with reconnect state machine

Per Phase 3 spec §PodLogStreamer + D1:
- run() loop: IDLE → STREAMING → RECONNECTING (up to 3 attempts) → STOPPED
- reconnect backoff [1s, 2s, 4s] with sinceSeconds=10 overlap, no dedup
- abort() short-circuits the loop; drainOrTimeout(ms) is the watcher's sync point
- handleLine throw is caught — streamer never exposes faults upstream

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — `PodLogStreamerFactory`

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts`
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.spec.ts`

### Steps

- [ ] **Step 3.1: Write failing spec**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PodLogStreamerFactory } from "./pod-log-streamer-factory.js";
import { ProgressThrottle } from "./progress-throttle.js";

vi.mock("@modeldoctor/tool-adapters", () => ({
  byTool: vi.fn((tool: string) => ({
    parseProgress: (line: string) => {
      if (line.startsWith("PROGRESS:")) {
        return { kind: "progress", pct: Number.parseFloat(line.slice(9)) };
      }
      if (line === "THROW") throw new Error("adapter boom");
      return null;
    },
    name: tool,
  })),
}));

function makeFactory() {
  const repo = { update: vi.fn(async () => undefined), findById: vi.fn() };
  const sse = { publish: vi.fn() };
  const k8sLog = { log: vi.fn() };
  const factory = new PodLogStreamerFactory(repo as never, sse as never, k8sLog as never, "ns");
  return { factory, repo, sse, k8sLog };
}

describe("PodLogStreamerFactory", () => {
  it("create() returns a streamer wired to the right adapter + SSE + throttle", async () => {
    const { factory, repo, sse } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000, () => 1_000);
    const streamer = factory.create("r1", "pod-r1", "guidellm", throttle);
    expect(streamer).toBeDefined();

    // Reach into the closure via injected handleLine; easier path:
    // ask factory to expose a build-handler helper for tests OR test via streamer run().
    // We test the wiring through factory.buildHandleLine (exposed for tests).
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("PROGRESS:0.5");
    expect(sse.publish).toHaveBeenCalledWith("r1", { kind: "progress", pct: 0.5 });
    // 1Hz throttle: first tick fires immediately
    await new Promise((r) => setImmediate(r));
    expect(repo.update).toHaveBeenCalledWith("r1", { progress: 0.5 });
  });

  it("buildHandleLine ignores parseProgress returning null", () => {
    const { factory, sse, repo } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000);
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("not a progress line");
    expect(sse.publish).not.toHaveBeenCalled();
  });

  it("buildHandleLine wraps parseProgress throw in fallback log event", () => {
    const { factory, sse, repo } = makeFactory();
    const throttle = new ProgressThrottle("r1", repo as never, 1000);
    const handle = factory.buildHandleLine("r1", "guidellm", throttle);
    handle("THROW");
    expect(sse.publish).toHaveBeenCalledWith("r1", {
      kind: "log",
      level: "warn",
      line: "THROW",
    });
  });

  it("probeRbac swallows 404 (RBAC OK)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("404 not found"));
    await expect(factory.probeRbac()).resolves.toBeUndefined();
  });

  it("probeRbac re-throws on 403 (RBAC missing)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("403 forbidden: pods/log"));
    await expect(factory.probeRbac()).rejects.toThrow(/RBAC missing pods\/log/);
  });

  it("probeRbac swallows other errors (transient apiserver)", async () => {
    const { factory, k8sLog } = makeFactory();
    k8sLog.log.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(factory.probeRbac()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3.2: Verify it fails**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer-factory.spec.ts
```

Expected: FAIL `Cannot find module './pod-log-streamer-factory.js'`.

- [ ] **Step 3.3: Implement**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts`:

```ts
import type * as k8s from "@kubernetes/client-node";
import { byTool, type ProgressEvent, type ToolName } from "@modeldoctor/tool-adapters";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Writable } from "node:stream";
import { BenchmarkRepository } from "../benchmark.repository.js";
import { SseHub } from "../sse/sse-hub.service.js";
import { PodLogStreamer } from "./pod-log-streamer.js";
import type { ProgressThrottle } from "./progress-throttle.js";
import { RUNNER_CONTAINER_NAME } from "./runner-container.js";

/** Nest DI tokens — see benchmark.module.ts for provider registration. */
export const K8S_LOG_CLIENT = Symbol("K8S_LOG_CLIENT");
export const K8S_NAMESPACE = Symbol("K8S_NAMESPACE");

/** Builds PodLogStreamer instances with a tool-aware handleLine closure.
 *  Separated from PodLogStreamerPool so the pool stays a thin lifecycle
 *  manager and the factory holds the SSE / adapter / DI wiring. */
@Injectable()
export class PodLogStreamerFactory {
  constructor(
    public readonly repo: BenchmarkRepository,  // public: ProgressThrottle ctor needs it
    private readonly sse: SseHub,
    @Inject(K8S_LOG_CLIENT) private readonly k8sLog: Pick<k8s.Log, "log">,
    @Inject(K8S_NAMESPACE) private readonly namespace: string,
  ) {}

  /** Synchronous — tool is passed in; no async bench lookup (watcher already
   *  has bench loaded when it calls pool.start). */
  create(runId: string, podName: string, tool: ToolName, throttle: ProgressThrottle): PodLogStreamer {
    return new PodLogStreamer(
      runId, podName, RUNNER_CONTAINER_NAME, this.namespace,
      this.k8sLog,
      this.buildHandleLine(runId, tool, throttle),
      new Logger(`PodLogStreamer:${runId}`),
    );
  }

  /** Exposed for unit tests. */
  buildHandleLine(runId: string, tool: ToolName, throttle: ProgressThrottle): (line: string) => void {
    const adapter = byTool(tool);
    return (line: string) => {
      let evt: ProgressEvent | null;
      try {
        evt = adapter.parseProgress(line);
      } catch {
        evt = { kind: "log", level: "warn", line };
      }
      if (!evt) return;
      this.sse.publish(runId, evt);
      if (evt.kind === "progress") throttle.tick(evt.pct);
    };
  }

  /** Boot-time RBAC self-check (spec D8). Probes pods/log:get against a
   *  guaranteed-nonexistent pod name; 404 means RBAC OK, 403 means
   *  missing pods/log permission → boot fail. Other errors are logged
   *  and swallowed (apiserver transient flake should not block boot). */
  async probeRbac(): Promise<void> {
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    try {
      await this.k8sLog.log(this.namespace, "__rbac-probe__", RUNNER_CONTAINER_NAME, sink, {
        follow: false,
      });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/403|forbidden/i.test(msg)) {
        throw new Error(
          `PodLogStreamerPool: RBAC missing pods/log:get in ns=${this.namespace}: ${msg}`,
        );
      }
      // 404 or transient — log only, do not fail boot
      new Logger(PodLogStreamerFactory.name).log(
        `RBAC probe non-fatal error (expected on 404): ${msg.slice(0, 200)}`,
      );
    }
  }
}
```

- [ ] **Step 3.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer-factory.spec.ts
```

Expected: 6 passing.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): PodLogStreamerFactory — adapter wiring + RBAC self-check

Per Phase 3 spec §PodLogStreamerFactory + D8:
- create() builds a streamer with a tool-aware handleLine closure that
  routes progress events to SseHub and DB writes through ProgressThrottle
- buildHandleLine() exposed for unit tests; parseProgress throw → fallback
  log event so adapter bugs don't crash the streamer loop
- probeRbac() pre-checks pods/log:get at boot — 403 fails fast

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — `PodLogStreamerPool`

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts`
- Create: `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.spec.ts`

### Steps

- [ ] **Step 4.1: Write failing spec**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.spec.ts`:

```ts
import type { ToolName } from "@modeldoctor/tool-adapters";
import { describe, expect, it, vi } from "vitest";
import { PodLogStreamerPool } from "./pod-log-streamer-pool.js";

function makePool() {
  const probeRbac = vi.fn(async () => undefined);
  const repo = { update: vi.fn(async () => undefined) };
  const streamerInstances: Array<{
    run: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    drainOrTimeout: ReturnType<typeof vi.fn>;
    runResolve: () => void;
  }> = [];
  const factory = {
    repo,
    probeRbac,
    create: vi.fn(() => {
      let runResolve!: () => void;
      const runPromise = new Promise<void>((r) => { runResolve = r; });
      const instance = {
        run: vi.fn(() => runPromise),
        abort: vi.fn(() => runResolve()),
        drainOrTimeout: vi.fn(async () => { runResolve(); }),
        runResolve,
      };
      streamerInstances.push(instance);
      return instance;
    }),
  };
  const pool = new PodLogStreamerPool(factory as never);
  return { pool, factory, probeRbac, streamerInstances };
}

describe("PodLogStreamerPool", () => {
  it("start is idempotent — second call for the same runId is a no-op", () => {
    const { pool, factory } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(pool.has("r1")).toBe(true);
  });

  it("stop force-aborts and removes from map", () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.stop("r1");
    expect(streamerInstances[0].abort).toHaveBeenCalled();
    expect(pool.has("r1")).toBe(false);
  });

  it("stop is a no-op when runId not present", () => {
    const { pool } = makePool();
    expect(() => pool.stop("missing")).not.toThrow();
  });

  it("drainAndStop calls drainOrTimeout then removes from map", async () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    await pool.drainAndStop("r1", 5000);
    expect(streamerInstances[0].drainOrTimeout).toHaveBeenCalledWith(5000);
    expect(pool.has("r1")).toBe(false);
  });

  it("onModuleInit invokes probeRbac", async () => {
    const { pool, probeRbac } = makePool();
    await pool.onModuleInit();
    expect(probeRbac).toHaveBeenCalledTimes(1);
  });

  it("onModuleDestroy aborts all streamers and clears map", async () => {
    const { pool, streamerInstances } = makePool();
    pool.start("r1", "pod-r1", "guidellm" as ToolName);
    pool.start("r2", "pod-r2", "vegeta" as ToolName);
    await pool.onModuleDestroy();
    expect(streamerInstances[0].abort).toHaveBeenCalled();
    expect(streamerInstances[1].abort).toHaveBeenCalled();
    expect(pool.has("r1")).toBe(false);
    expect(pool.has("r2")).toBe(false);
  });
});
```

- [ ] **Step 4.2: Verify it fails**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer-pool.spec.ts
```

Expected: FAIL `Cannot find module './pod-log-streamer-pool.js'`.

- [ ] **Step 4.3: Implement**

Create `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts`:

```ts
import type { ToolName } from "@modeldoctor/tool-adapters";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { PodLogStreamer } from "./pod-log-streamer.js";
import type { PodLogStreamerFactory } from "./pod-log-streamer-factory.js";
import { ProgressThrottle } from "./progress-throttle.js";

const PROGRESS_THROTTLE_WINDOW_MS = 1000;

/** Singleton pool of per-runId PodLogStreamer instances. The watcher service
 *  calls start/stop/drainAndStop in response to pod lifecycle events.
 *  All operations are idempotent so the watcher can call them on every pod
 *  event without bookkeeping. */
@Injectable()
export class PodLogStreamerPool implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PodLogStreamerPool.name);
  private readonly streamers = new Map<string, PodLogStreamer>();
  private readonly throttles = new Map<string, ProgressThrottle>();

  constructor(private readonly factory: PodLogStreamerFactory) {}

  async onModuleInit(): Promise<void> {
    await this.factory.probeRbac();
  }

  /** Idempotent. If a streamer already exists for runId, no-op. */
  start(runId: string, podName: string, tool: ToolName): void {
    if (this.streamers.has(runId)) return;
    const throttle = new ProgressThrottle(runId, this.factory.repo, PROGRESS_THROTTLE_WINDOW_MS);
    this.throttles.set(runId, throttle);
    const streamer = this.factory.create(runId, podName, tool, throttle);
    this.streamers.set(runId, streamer);
    streamer.run().catch((e) => {
      this.log.warn(`streamer.run threw for ${runId}: ${(e as Error).message}`);
    });
  }

  /** Force-stop. No drain wait. For pod-delete / cancel paths. */
  stop(runId: string): void {
    const streamer = this.streamers.get(runId);
    if (!streamer) return;
    streamer.abort();
    this.streamers.delete(runId);
    const throttle = this.throttles.get(runId);
    if (throttle) {
      void throttle.flushNow();
      this.throttles.delete(runId);
    }
  }

  /** Wait for natural EOF up to timeoutMs, then force-stop.
   *  For terminal pod events (Succeeded → 5000ms; Failed → 0ms). */
  async drainAndStop(runId: string, timeoutMs: number): Promise<void> {
    const streamer = this.streamers.get(runId);
    if (!streamer) return;
    await streamer.drainOrTimeout(timeoutMs);
    this.streamers.delete(runId);
    const throttle = this.throttles.get(runId);
    if (throttle) {
      await throttle.flushNow();
      this.throttles.delete(runId);
    }
  }

  has(runId: string): boolean {
    return this.streamers.has(runId);
  }

  async onModuleDestroy(): Promise<void> {
    for (const [, s] of this.streamers) s.abort();
    this.streamers.clear();
    for (const [, t] of this.throttles) await t.flushNow();
    this.throttles.clear();
  }
}
```

- [ ] **Step 4.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/api test -- pod-log-streamer-pool.spec.ts
```

Expected: 6 passing.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): PodLogStreamerPool — singleton pool + idempotent lifecycle

Per Phase 3 spec §PodLogStreamerPool:
- start/stop/drainAndStop all idempotent so the watcher can call them
  on every pod event without bookkeeping
- onModuleInit runs factory.probeRbac (boot fail on missing pods/log)
- onModuleDestroy aborts + flushes throttles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Watcher integration

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts`

### Steps

- [ ] **Step 5.1: Extend WatcherDeps + spec deps**

Edit `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`:

Old (around line 14):
```ts
export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
  reportLoader: ReportLoader;
}
```

New:
```ts
import type { ToolName } from "@modeldoctor/tool-adapters";
import type { PodLogStreamerPool } from "./pod-log-streamer-pool.js";

export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
  reportLoader: ReportLoader;
  pool: PodLogStreamerPool;
}
```

- [ ] **Step 5.2: Wire attach-streamer tail into handlePodEvent**

Replace the end of `handlePodEvent` (after `await this.execute(runId, transition, now);`):

```ts
    await this.execute(runId, transition, now);

    // Phase 3: idempotent attach. Informer replay on startup gives free bootstrap.
    if (
      this.deps.mode === "primary"
      && pod.status?.phase === "Running"
      && getRunnerStatus(pod)?.ready === true
      && (bench.status === "submitted" || bench.status === "running")
      && pod.metadata?.name
    ) {
      this.deps.pool.start(runId, pod.metadata.name, bench.tool as ToolName);
    }
  }
```

- [ ] **Step 5.3: Add stop call in handlePodDelete**

Old `handlePodDelete`:
```ts
  private handlePodDelete(pod: V1Pod): void {
    const runId = this.extractRunId(pod);
    if (!runId) return;
    this.firstFatalWaitingAt.delete(runId);
    this.firstTerminalAt.delete(runId);
  }
```

New:
```ts
  private handlePodDelete(pod: V1Pod): void {
    const runId = this.extractRunId(pod);
    if (!runId) return;
    this.firstFatalWaitingAt.delete(runId);
    this.firstTerminalAt.delete(runId);
    this.deps.pool.stop(runId);
  }
```

- [ ] **Step 5.4: Insert drain calls into execute() terminal cases**

Old `case "load-report"`:
```ts
      case "load-report": {
        // Fire-and-forget — ReportLoader handles its own errors and writes.
        void this.deps.reportLoader.tryLoad(runId);
        return;
      }
```

New:
```ts
      case "load-report": {
        // Phase 3: drain log streamer up to 5s before flipping status, so SSE
        // close (inside ReportLoader.tryLoad finally) does not race the last
        // lines emitted by the runner just before exit.
        await this.deps.pool.drainAndStop(runId, 5000);
        // Fire-and-forget — ReportLoader handles its own errors and writes.
        void this.deps.reportLoader.tryLoad(runId);
        return;
      }
```

Old `case "failed-pre-start": case "failed-terminal":`:
```ts
      case "failed-pre-start":
      case "failed-terminal": {
        try {
          const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
            status: "failed",
            statusMessage: t.message,
            completedAt: now,
          });
```

New (insert `drainAndStop(0)` before the try):
```ts
      case "failed-pre-start":
      case "failed-terminal": {
        // Phase 3: stderr is already in S3 via Phase 2; no need to wait for drain.
        await this.deps.pool.drainAndStop(runId, 0);
        try {
          const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
            status: "failed",
            statusMessage: t.message,
            completedAt: now,
          });
```

- [ ] **Step 5.5: Update existing watcher spec — add pool to deps**

Edit `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts`. In `makeDeps`:

Add to return-type annotation and ctor:
```ts
function makeDeps(mode: WatcherMode = "backstop"): {
  deps: WatcherDeps;
  informer: ReturnType<typeof makeFakeInformer>;
  repo: { findById: ReturnType<typeof vi.fn>; updateGuarded: ReturnType<typeof vi.fn> };
  reconciler: { run: ReturnType<typeof vi.fn> };
  reportLoader: { tryLoad: ReturnType<typeof vi.fn> };
  pool: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    drainAndStop: ReturnType<typeof vi.fn>;
    has: ReturnType<typeof vi.fn>;
  };
} {
  const informer = makeFakeInformer();
  const repo = {
    findById: vi.fn(async () => null),
    updateGuarded: vi.fn(async () => null),
  };
  const reconciler = { run: vi.fn(async () => undefined) };
  const reportLoader = { tryLoad: vi.fn(async () => {}) };
  const pool = {
    start: vi.fn(),
    stop: vi.fn(),
    drainAndStop: vi.fn(async () => {}),
    has: vi.fn(() => false),
  };
  return {
    deps: {
      mode,
      namespace: "modeldoctor-benchmarks",
      reducerConfig: {
        fatalWaitingReasons: ["ImagePullBackOff"],
        waitingFatalGraceSec: 60,
        terminalReconcileGraceSec: 60,
      },
      makeInformer: () => informer as unknown as Informer<V1Pod>,
      repo: repo as never,
      reconciler: reconciler as never,
      reportLoader: reportLoader as never,
      pool: pool as never,
    },
    informer,
    repo,
    reconciler,
    reportLoader,
    pool,
  };
}
```

- [ ] **Step 5.6: Add Phase 3 cases to watcher spec**

Append to the existing test file (find a sensible location — e.g. inside a new `describe("Phase 3 — pod log streamer", ...)` block):

```ts
import { podRunning } from "./__fixtures__/pod-fixtures.js";

describe("Phase 3 — pod log streamer", () => {
  it("Running pod (ready, status=submitted, mode=primary) calls pool.start", async () => {
    const { deps, informer, repo, pool } = makeDeps("primary");
    repo.findById.mockResolvedValueOnce({ id: "r1", status: "submitted", tool: "guidellm" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("add", podRunning({ runId: "r1", containerReady: true }));
    await new Promise((r) => setImmediate(r));
    expect(pool.start).toHaveBeenCalledWith("r1", expect.any(String), "guidellm");
  });

  it("Running pod in mode=backstop does NOT call pool.start", async () => {
    const { deps, informer, repo, pool } = makeDeps("backstop");
    repo.findById.mockResolvedValueOnce({ id: "r1", status: "submitted", tool: "guidellm" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("add", podRunning({ runId: "r1", containerReady: true }));
    await new Promise((r) => setImmediate(r));
    expect(pool.start).not.toHaveBeenCalled();
  });

  it("Succeeded pod calls pool.drainAndStop(5000) before reportLoader.tryLoad", async () => {
    const { deps, informer, repo, pool, reportLoader } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: "r1", status: "running", tool: "guidellm" });
    const callOrder: string[] = [];
    pool.drainAndStop.mockImplementation(async () => { callOrder.push("drain"); });
    reportLoader.tryLoad.mockImplementation(async () => { callOrder.push("tryLoad"); });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("update", podSucceeded({ runId: "r1" }));
    await new Promise((r) => setImmediate(r));
    expect(pool.drainAndStop).toHaveBeenCalledWith("r1", 5000);
    expect(callOrder).toEqual(["drain", "tryLoad"]);
  });

  it("Failed pod calls pool.drainAndStop(0) before repo.updateGuarded", async () => {
    const { deps, informer, repo, pool } = makeDeps("primary");
    repo.findById.mockResolvedValue({ id: "r1", status: "running", tool: "guidellm" });
    repo.updateGuarded.mockResolvedValue({ id: "r1" });
    const callOrder: string[] = [];
    pool.drainAndStop.mockImplementation(async () => { callOrder.push("drain"); });
    repo.updateGuarded.mockImplementation(async () => { callOrder.push("update"); return { id: "r1" }; });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("update", podFailed({ runId: "r1" }));
    await new Promise((r) => setImmediate(r));
    expect(pool.drainAndStop).toHaveBeenCalledWith("r1", 0);
    expect(callOrder).toEqual(["drain", "update"]);
  });

  it("pod delete event calls pool.stop", async () => {
    const { deps, informer, pool } = makeDeps("primary");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("delete", podRunning({ runId: "r1", containerReady: true }));
    expect(pool.stop).toHaveBeenCalledWith("r1");
  });
});
```

Make sure `podSucceeded` and `podFailed` are already imported from the fixtures file (lines 4-9 of the existing spec). If `podRunning` accepts `containerReady` — verify by reading the fixtures file. If not, adapt to whatever the fixture exposes (most likely `podRunning({ runId, ready: true })` or similar).

- [ ] **Step 5.7: Run watcher spec, verify pass**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher.service.spec.ts
```

Expected: all existing tests still pass + 5 new Phase 3 tests pass.

If `podRunning` signature mismatch causes failures, read `apps/api/src/modules/benchmark/k8s/__fixtures__/pod-fixtures.ts` and adapt the calls. **Report the deviation in this turn**, don't silently rewrite the plan.

- [ ] **Step 5.8: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): watcher wires PodLogStreamerPool — attach / drain / stop

Per Phase 3 spec §K8sJobWatcherService.execute + D3 + D5:
- handlePodEvent tail: idempotent pool.start on Running+ready (primary mode)
- handlePodDelete: pool.stop
- execute(): await pool.drainAndStop(5s) before void tryLoad on Succeeded;
  drainAndStop(0) before repo.updateGuarded on failed-* — ensures last log
  lines reach SSE before the runId stream closes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Benchmark module wiring

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.module.ts`

### Steps

- [ ] **Step 6.1: Add providers and wire pool into watcher useFactory**

Edit `apps/api/src/modules/benchmark/benchmark.module.ts`. Add imports at top:

```ts
import { K8S_LOG_CLIENT, K8S_NAMESPACE, PodLogStreamerFactory } from "./k8s/pod-log-streamer-factory.js";
import { PodLogStreamerPool } from "./k8s/pod-log-streamer-pool.js";
```

Add `K8S_LOG_CLIENT`, `K8S_NAMESPACE`, `PodLogStreamerFactory`, `PodLogStreamerPool` providers inside the `providers` array. Replace the existing watcher useFactory inject + body so it also passes `pool`.

Concretely, append these provider entries (after `ReportLoader`, before `K8sJobWatcherService`):

```ts
    {
      provide: K8S_NAMESPACE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string | undefined)
          ?? "modeldoctor-benchmarks",
    },
    {
      provide: K8S_LOG_CLIENT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const mode = config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode;
        if (mode === "off") {
          // Tests / dev never call into real K8s — return a stub.
          return { log: async () => { throw new Error("K8S_LOG_CLIENT unavailable in mode=off"); } };
        }
        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        return new k8s.Log(kc);
      },
    },
    PodLogStreamerFactory,
    PodLogStreamerPool,
```

Now modify the `K8sJobWatcherService` factory entry. Old `inject:` line:
```ts
      inject: [ConfigService, BenchmarkRepository, ReportLoader, REPORT_STORAGE],
```

New:
```ts
      inject: [ConfigService, BenchmarkRepository, ReportLoader, REPORT_STORAGE, PodLogStreamerPool],
```

Old `useFactory:` signature:
```ts
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
        reportLoader: ReportLoader,
        storage: ReportStorage,
      ): Promise<K8sJobWatcherService> => {
```

New:
```ts
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
        reportLoader: ReportLoader,
        storage: ReportStorage,
        pool: PodLogStreamerPool,
      ): Promise<K8sJobWatcherService> => {
```

Now pass `pool` into both `WatcherDeps` constructions in the factory body. The `mode === "off"` branch becomes:

```ts
        if (mode === "off") {
          return new K8sJobWatcherService({
            mode, namespace, reducerConfig,
            makeInformer: () => { throw new Error("makeInformer called in mode=off"); },
            repo,
            reconciler: new StartupReconciler({
              namespace, repo,
              podCache: { get: () => undefined, list: () => [] },
              storage, reportLoader,
            }),
            reportLoader,
            pool,
          });
        }
```

And the `mode === "backstop" || "primary"` branch's return becomes:

```ts
        return new K8sJobWatcherService({
          mode, namespace, reducerConfig,
          makeInformer: () => informer,
          repo, reconciler, reportLoader,
          pool,
        });
```

- [ ] **Step 6.2: Remove BenchmarkCallbackController from controllers list**

In the `@Module({ controllers: [...] })` array, drop `BenchmarkCallbackController`:

Old:
```ts
  controllers: [BenchmarkController, BenchmarkCallbackController, BenchmarkFilesController],
```

New:
```ts
  controllers: [BenchmarkController, BenchmarkFilesController],
```

Also delete the unused import at the top of the file:
```ts
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
```

- [ ] **Step 6.3: Typecheck module**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: PASS. If `BenchmarkCallbackController` deleted but the file still exists (it does — Phase 7 deletes it), the import was just dropped — fine. Pool / factory / namespace provider should resolve.

If typecheck complains about the K8S_LOG_CLIENT stub Promise type, widen the return type explicitly:

```ts
useFactory: async (config: ConfigService<Env, true>): Promise<Pick<import("@kubernetes/client-node").Log, "log">> => { ... }
```

- [ ] **Step 6.4: Run benchmark module integration tests**

```bash
pnpm -F @modeldoctor/api test -- benchmark
```

Expected: existing tests still pass. The callback controller spec is still wired in (Phase 7 deletes it) — it should still pass since the controller code hasn't been removed yet.

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.module.ts
git commit -m "$(cat <<'EOF'
feat(api): wire PodLogStreamerPool + factory into BenchmarkModule

Per Phase 3 spec §代码面变更 changed:
- K8S_NAMESPACE / K8S_LOG_CLIENT providers (Log instance lazy-loaded only
  when mode != off so tests / dev never import @kubernetes/client-node)
- PodLogStreamerFactory + PodLogStreamerPool registered as Nest providers
- K8sJobWatcherService factory now also receives pool
- BenchmarkCallbackController dropped from controllers list (Phase 7 deletes
  the file itself)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Delete API callback surface

**Files:**
- Delete: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`
- Delete: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts`
- Delete: `apps/api/src/modules/benchmark/callbacks/` (empty dir)
- Delete: `apps/api/src/common/hmac/hmac-callback.guard.ts`
- Delete: `apps/api/src/common/hmac/hmac-callback.guard.spec.ts`
- Delete: `apps/api/src/common/hmac/hmac-token.ts`
- Delete: `apps/api/src/common/hmac/hmac-token.spec.ts`
- Delete: `apps/api/src/common/hmac/` (empty dir)
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.spec.ts`
- Modify: `apps/api/test/setup/e2e-env-defaults.ts`
- Modify: `e2e/playwright.config.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.spec.ts`
- Modify: `packages/contracts/src/benchmark.ts`

### Steps

- [ ] **Step 7.1: Verify no other consumers of HMAC token / callback secret**

```bash
rg -n 'signCallbackToken|verifyCallbackToken|HmacCallbackGuard|BENCHMARK_CALLBACK_SECRET|BENCHMARK_CALLBACK_URL|benchmarkLogCallbackSchema|BenchmarkLogCallback'  apps packages e2e --type ts --type py
```

Expected outputs to verify match the deletion list. Anything outside the planned deletion targets is a deviation — **report it in this turn**, don't silently delete.

- [ ] **Step 7.2: Delete API callback files**

```bash
git rm apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts \
       apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts \
       apps/api/src/common/hmac/hmac-callback.guard.ts \
       apps/api/src/common/hmac/hmac-callback.guard.spec.ts \
       apps/api/src/common/hmac/hmac-token.ts \
       apps/api/src/common/hmac/hmac-token.spec.ts
rmdir apps/api/src/modules/benchmark/callbacks apps/api/src/common/hmac
```

- [ ] **Step 7.3: Remove BENCHMARK_CALLBACK_* from env.schema.ts**

In `apps/api/src/config/env.schema.ts`, delete:

```ts
  // Secret used to derive per-run HMAC callback tokens.
  BENCHMARK_CALLBACK_SECRET: z.string().min(32),
  // K8s job runner config — subprocess driver removed in #101.
  BENCHMARK_CALLBACK_URL: z.string().url(),
```

Replace with:
```ts
  // K8s job runner config — subprocess driver removed in #101.
```

(Phase 3 removes the callback secret/url; Job manifest still reads `BENCHMARK_K8S_NAMESPACE` which stays.)

Also fix the comment on line 136 (ALERTMANAGER_WEBHOOK_SECRET) that says "Length matches BENCHMARK_CALLBACK_SECRET":

Old:
```ts
  // Length matches BENCHMARK_CALLBACK_SECRET.
  ALERTMANAGER_WEBHOOK_SECRET: z.string().min(32),
```

New:
```ts
  // 32-byte minimum — same minimum we historically used for HMAC secrets.
  ALERTMANAGER_WEBHOOK_SECRET: z.string().min(32),
```

- [ ] **Step 7.4: Strip BENCHMARK_CALLBACK_* from env.spec.ts**

Edit `apps/api/src/config/env.spec.ts`:

Delete from `validEnv()` (line 14-15):
```ts
  BENCHMARK_CALLBACK_SECRET: "y".repeat(48),
  BENCHMARK_CALLBACK_URL: "http://localhost:3001",
```

Delete from the required-keys array (line ~68):
```ts
      "BENCHMARK_CALLBACK_SECRET",
      "BENCHMARK_CALLBACK_URL",
```

Delete the entire test block (lines ~108-111):
```ts
  it("rejects BENCHMARK_CALLBACK_SECRET shorter than 32 chars", () => {
    expect(() => validateEnv({ ...validEnv(), BENCHMARK_CALLBACK_SECRET: "x".repeat(31) })).toThrow(
      /BENCHMARK_CALLBACK_SECRET/,
    );
  });
```

- [ ] **Step 7.5: Strip from test setup**

Edit `apps/api/test/setup/e2e-env-defaults.ts` (lines 40-41), delete both entries:
```ts
  BENCHMARK_CALLBACK_SECRET: required("BENCHMARK_CALLBACK_SECRET"),
  BENCHMARK_CALLBACK_URL: required("BENCHMARK_CALLBACK_URL"),
```

Edit `e2e/playwright.config.ts` (line ~72), delete:
```ts
        BENCHMARK_CALLBACK_URL: `http://localhost:${E2E_API_PORT}/api/runs/callback`,
```

Plus delete `BENCHMARK_CALLBACK_SECRET` env if present in that file:
```bash
rg -n 'BENCHMARK_CALLBACK_SECRET' e2e/playwright.config.ts
```

- [ ] **Step 7.6: Strip callback fields from benchmark.service.ts**

In `apps/api/src/modules/benchmark/benchmark.service.ts`:

Delete import (line 22):
```ts
import { signCallbackToken } from "../../common/hmac/hmac-token.js";
```

Delete constant (lines ~41-44):
```ts
// 15-minute slack on top of adapter.getMaxDurationSeconds(): a final /finish
// callback shouldn't be rejected if the runner overruns by clock skew or
// shutdown grace.
const CALLBACK_TTL_SLACK_SECONDS = 15 * 60;
```

Delete fields (lines 49-50):
```ts
  private readonly callbackSecret: Buffer;
  private readonly callbackUrl: string;
```

Delete the ctor block that initializes them (lines 62-78):
```ts
    const secret = this.config.get("BENCHMARK_CALLBACK_SECRET", { infer: true }) as
      | string
      | undefined;
    if (!secret) {
      throw new Error(
        "BenchmarkService: BENCHMARK_CALLBACK_SECRET is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackSecret = Buffer.from(secret, "utf8");

    const url = this.config.get("BENCHMARK_CALLBACK_URL", { infer: true }) as string | undefined;
    if (!url) {
      throw new Error(
        "BenchmarkService: BENCHMARK_CALLBACK_URL is required. Env schema must enforce presence outside test mode.",
      );
    }
    this.callbackUrl = url;
```

In `start()` (line ~205-235), drop the `callbackToken` derivation and `callback:` field. Old:
```ts
      const adapter = byTool(row.tool as ToolName);
      const adapterMaxDuration = adapter.getMaxDurationSeconds(row.params);
      const callbackToken = signCallbackToken(
        row.id,
        this.callbackSecret,
        adapterMaxDuration + CALLBACK_TTL_SLACK_SECONDS,
      );
      const buildResult = adapter.buildCommand({
        runId: row.id,
        params: row.params,
        connection: {
          baseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          model: conn.model,
          customHeaders: conn.customHeaders,
          queryParams: conn.queryParams,
          tokenizerHfId: conn.tokenizerHfId,
          prometheusDatasource: conn.prometheusDatasource,
        },
        callback: { url: this.callbackUrl, token: callbackToken },
      });
      const result = await this.runner.start({
        runId: row.id,
        tool: row.tool as ToolName,
        buildResult,
        callback: { url: this.callbackUrl, token: callbackToken },
        image: imageForTool(row.tool as ToolName, this.config),
      });
```

New:
```ts
      const adapter = byTool(row.tool as ToolName);
      const buildResult = adapter.buildCommand({
        runId: row.id,
        params: row.params,
        connection: {
          baseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          model: conn.model,
          customHeaders: conn.customHeaders,
          queryParams: conn.queryParams,
          tokenizerHfId: conn.tokenizerHfId,
          prometheusDatasource: conn.prometheusDatasource,
        },
      });
      const result = await this.runner.start({
        runId: row.id,
        tool: row.tool as ToolName,
        buildResult,
        image: imageForTool(row.tool as ToolName, this.config),
      });
```

> **Note:** `adapter.buildCommand` and `BenchmarkRunInput` still type-require a `callback` field at this point. Phase 9 deletes the field from both contracts. Until Phase 9 lands, this code may fail typecheck — that is expected, and Phase 9 below closes the loop. If you need a green build after Phase 7 alone, defer this `start()` rewrite to Phase 9 and only delete the ctor + import in Phase 7. The plan order is: 7 deletes the API surface, 8 the runner, 9 the contract field — and final typecheck runs in Phase 12.

- [ ] **Step 7.7: Strip callback from benchmark.service.spec.ts + benchmark.controller.spec.ts**

In `apps/api/src/modules/benchmark/benchmark.service.spec.ts`:
- Remove `BENCHMARK_CALLBACK_URL: "http://api/"` and `BENCHMARK_CALLBACK_SECRET: ...` from the fixture env (around line 14, 65)
- Delete the `signSpy` test (around line 465-466) and any other `hmacToken` references
- Remove the `import * as hmacToken from "../../common/hmac/hmac-token.js"` (or similar) if present

```bash
rg -n 'hmacToken|signCallbackToken|BENCHMARK_CALLBACK' apps/api/src/modules/benchmark/benchmark.service.spec.ts apps/api/src/modules/benchmark/benchmark.controller.spec.ts
```

For each match, delete the line (or the surrounding `it(...)` block if the test was specifically about HMAC).

Edit `apps/api/src/modules/benchmark/benchmark.controller.spec.ts` line ~71:
```ts
  BENCHMARK_CALLBACK_URL: "http://api/",
```
Delete it. Same for any `BENCHMARK_CALLBACK_SECRET` line if present.

- [ ] **Step 7.8: Delete contracts log callback schema**

In `packages/contracts/src/benchmark.ts`, find and delete `benchmarkLogCallbackSchema` + `BenchmarkLogCallback` type export:

```bash
rg -n 'benchmarkLogCallbackSchema|BenchmarkLogCallback' packages/contracts/src/benchmark.ts
```

Delete those exports. Check no other contracts file re-exports them:

```bash
rg -n 'benchmarkLogCallbackSchema|BenchmarkLogCallback' packages
```

Should return only the file we just edited (its own definition). If other files re-export, delete those re-exports too.

- [ ] **Step 7.9: Rebuild contracts**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: PASS.

- [ ] **Step 7.10: Typecheck — expected to fail on BenchmarkRunInput.callback / adapter.callback (closed by Phase 9)**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: FAIL with errors like `Property 'callback' is missing in type 'BuildCommandContext'` or similar — these close in Phase 9. **Document the failing files in commit message**.

- [ ] **Step 7.11: Commit**

```bash
git add apps/api/src/modules/benchmark/callbacks apps/api/src/common/hmac \
        apps/api/src/config/env.schema.ts apps/api/src/config/env.spec.ts \
        apps/api/test/setup/e2e-env-defaults.ts e2e/playwright.config.ts \
        apps/api/src/modules/benchmark/benchmark.service.ts \
        apps/api/src/modules/benchmark/benchmark.service.spec.ts \
        apps/api/src/modules/benchmark/benchmark.controller.spec.ts \
        packages/contracts/src/benchmark.ts
git commit -m "$(cat <<'EOF'
refactor(api): delete HMAC callback API surface

Per Phase 3 spec §代码面变更 deleted:
- BenchmarkCallbackController (the only /log consumer is gone)
- HmacCallbackGuard + hmac-token (only consumer was the controller)
- BENCHMARK_CALLBACK_SECRET / _URL env (no readers)
- benchmarkLogCallbackSchema + BenchmarkLogCallback contracts type
- BenchmarkService callback ctor fields + signCallbackToken call

Note: typecheck will fail on BenchmarkRunInput.callback / adapter buildCommand
callback field until Phase 9 closes the contract; intentional sequencing
within a phase-per-commit single-PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Delete runner callback path

**Files:**
- Delete: `apps/benchmark-runner/runner/callback.py`
- Delete: `apps/benchmark-runner/tests/test_callback.py`
- Modify: `apps/benchmark-runner/runner/main.py`
- Modify: `apps/benchmark-runner/tests/test_main.py`

### Steps

- [ ] **Step 8.1: Delete callback files**

```bash
git rm apps/benchmark-runner/runner/callback.py apps/benchmark-runner/tests/test_callback.py
```

- [ ] **Step 8.2: Strip callback from runner/main.py**

Edit `apps/benchmark-runner/runner/main.py`:

Delete imports:
```python
from runner.callback import post_log_batch
```

Delete `LOG_BATCH_INTERVAL_SEC` const (line 25):
```python
LOG_BATCH_INTERVAL_SEC = 0.25
```

Refactor `StreamPump` — drop `callback_url`/`token`/`benchmark_id` ctor args, drop `buffer` list, drop `_flush`, drop the `last_flush` timing in `run()`:

Old (lines 74-135):
```python
class StreamPump:
    """Drains a file-like stream into a full-buffer + a /log batch sender."""

    def __init__(
        self,
        stream,
        name: str,
        callback_url: str,
        token: str,
        benchmark_id: str,
    ):
        self.stream = stream
        self.name = name
        self.callback_url = callback_url
        self.token = token
        self.benchmark_id = benchmark_id
        self.buffer: list[str] = []
        self.full: deque[str] = deque()
        self.full_bytes: int = 0
        self._stop = threading.Event()

    def run(self) -> None:
        last_flush = time.monotonic()
        while True:
            line_bytes = self.stream.readline()
            if not line_bytes:
                break
            try:
                line = line_bytes.decode("utf-8", errors="replace")
            except Exception:
                line = repr(line_bytes)
            line = line.rstrip("\n")[:LOG_LINE_MAX_BYTES]
            self.full.append(line)
            # +1 accounts for the \n that "\n".join(...) will reinsert on
            # read — keeps the byte accounting consistent with the output size.
            self.full_bytes += len(line.encode("utf-8")) + 1
            # Evict oldest lines until we are within the tail-byte cap so that
            # a 30-min benchmark's worth of progress output cannot exhaust RSS.
            while self.full_bytes > LOG_TAIL_MAX_BYTES and self.full:
                evicted = self.full.popleft()
                self.full_bytes -= len(evicted.encode("utf-8")) + 1
            self.buffer.append(line)
            now = time.monotonic()
            if now - last_flush >= LOG_BATCH_INTERVAL_SEC:
                self._flush()
                last_flush = now
        self._flush()

    def _flush(self) -> None:
        if not self.buffer:
            return
        try:
            post_log_batch(
                callback_url=self.callback_url,
                token=self.token,
                benchmark_id=self.benchmark_id,
                stream=self.name,
                lines=self.buffer,
            )
        except Exception as e:
            log.warning("post_log_batch failed: %s", e)
        self.buffer = []
```

New (replacement):
```python
class StreamPump:
    """Drains a subprocess pipe into a bounded tail buffer (LOG_TAIL_MAX_BYTES).
    Phase 3: API now reads live logs directly via K8s pods/log:get; runner
    only retains the tail for the post-mortem stdout.log / stderr.log writes
    to S3 (Phase 2 path)."""

    def __init__(self, stream, name: str):
        self.stream = stream
        self.name = name
        self.full: deque[str] = deque()
        self.full_bytes: int = 0

    def run(self) -> None:
        while True:
            line_bytes = self.stream.readline()
            if not line_bytes:
                break
            try:
                line = line_bytes.decode("utf-8", errors="replace")
            except Exception:
                line = repr(line_bytes)
            line = line.rstrip("\n")[:LOG_LINE_MAX_BYTES]
            self.full.append(line)
            # +1 accounts for the \n that "\n".join(...) reinserts on read
            self.full_bytes += len(line.encode("utf-8")) + 1
            while self.full_bytes > LOG_TAIL_MAX_BYTES and self.full:
                evicted = self.full.popleft()
                self.full_bytes -= len(evicted.encode("utf-8")) + 1
```

Also drop the now-unused imports if present (`threading.Event` is still used? No, `_stop` was the only consumer — verify). Run:
```bash
rg -n 'threading\.' apps/benchmark-runner/runner/main.py
```
Keep `threading.Thread` if still used (it is, for the pump threads). Drop `import time` only if no other usage:
```bash
rg -n '\\btime\\.' apps/benchmark-runner/runner/main.py
```

In `main()` (around line 204-244), delete:
```python
    callback_url = os.environ["MD_CALLBACK_URL"]
    token = os.environ["MD_CALLBACK_TOKEN"]
```

and change StreamPump construction:

Old:
```python
    out_pump = StreamPump(proc.stdout, "stdout", callback_url, token, benchmark_id)
    err_pump = StreamPump(proc.stderr, "stderr", callback_url, token, benchmark_id)
```

New:
```python
    out_pump = StreamPump(proc.stdout, "stdout")
    err_pump = StreamPump(proc.stderr, "stderr")
```

- [ ] **Step 8.3: Update test_main.py**

Edit `apps/benchmark-runner/tests/test_main.py`. Delete any `mock_post_log = mocker.patch("runner.main.post_log_batch")` line and the assertions that follow it. Verify the buffer/tail test (line 320 area) still uses the new `StreamPump(stream, name)` signature:

```bash
rg -n 'StreamPump\(' apps/benchmark-runner/tests/test_main.py
```

For each call site, drop the trailing `callback_url, token, benchmark_id` args.

- [ ] **Step 8.4: Run runner tests, verify pass**

```bash
cd apps/benchmark-runner && uv run pytest tests/ -x
```

(If `uv` isn't the runner — fall back to whatever `pyproject.toml` / `pytest.ini` declares. Check `apps/benchmark-runner/README.md` if unsure.)

Expected: tests pass; no `runner.callback` import errors.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/fangyong/vllm/modeldoctor/phase-3-pod-log-stream
git add apps/benchmark-runner/runner apps/benchmark-runner/tests
git commit -m "$(cat <<'EOF'
refactor(runner): drop /log POST path + MD_CALLBACK_* env reads

Per Phase 3 spec §Runner 改造:
- delete runner/callback.py + tests/test_callback.py
- StreamPump now only retains the tail buffer (LOG_TAIL_MAX_BYTES); no batching, no POST
- main() drops MD_CALLBACK_URL / MD_CALLBACK_TOKEN env reads
- API reads live log via K8s pods/log:get (Phase 3 PodLogStreamerPool);
  tailed stdout.log / stderr.log still uploaded to S3 (Phase 2 path)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Job manifest + BenchmarkRunInput contract cleanup

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.spec.ts`
- Modify: `packages/tool-adapters/src/core/interface.ts` (drop `callback` from `BuildCommandContext`)
- Modify: any tool-adapter runtime that reads `ctx.callback` (vegeta, evalscope, aiperf, prefix-cache-probe, guidellm)

### Steps

- [ ] **Step 9.1: Drop MD_CALLBACK_URL env from Job manifest**

Edit `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`. In `buildJobManifest`, remove from `env` array (around line 65):

```ts
    { name: "MD_CALLBACK_URL", value: ctx.callback.url },
```

- [ ] **Step 9.2: Drop MD_CALLBACK_TOKEN from per-run Secret**

In `buildSecretManifest` (line 38-40), change:

Old:
```ts
  const stringData: Record<string, string> = {
    ...ctx.buildResult.secretEnv,
    MD_CALLBACK_TOKEN: ctx.callback.token,
  };
```

New:
```ts
  const stringData: Record<string, string> = {
    ...ctx.buildResult.secretEnv,
  };
```

- [ ] **Step 9.3: Drop callback field from BenchmarkRunInput**

Edit `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts`. Delete line 20:

Old:
```ts
export interface BenchmarkRunInput {
  runId: string;
  tool: ToolName;
  buildResult: BuildCommandResult;
  callback: { url: string; token: string };
  image: string;
}
```

New:
```ts
export interface BenchmarkRunInput {
  runId: string;
  tool: ToolName;
  buildResult: BuildCommandResult;
  image: string;
}
```

Also update the class-level docstring referencing "callbacks":

Old (line 30-32):
```ts
 * #101). Lifecycle progression after `start()` flows through HTTP
 * callbacks; this class only handles spawn + cancel + cleanup.
```

New:
```ts
 * #101). Lifecycle progression after `start()` flows through the K8s
 * watcher + pod log stream (Phase 1–3); this class only handles
 * spawn + cancel + cleanup.
```

- [ ] **Step 9.4: Drop callback from adapter ctx**

Locate `BuildCommandContext`:

```bash
rg -n 'interface BuildCommandContext|callback:' packages/tool-adapters/src/core/interface.ts
```

If `BuildCommandContext` has a `callback: { url: string; token: string }` field, delete it. Then grep all tool runtimes for `ctx.callback`:

```bash
rg -n 'ctx\.callback|context\.callback' packages/tool-adapters
```

For each match, delete the consumer. The runner already ignores `MD_CALLBACK_URL` / `MD_CALLBACK_TOKEN` now (Phase 8), and the spec said adapters never directly used callback for any business logic — they were only forwarding URL/token into env. If an adapter materializes them into env explicitly (not via the manifest's MD_CALLBACK_URL), delete that env entry too. Verify there is no remaining `MD_CALLBACK_URL` / `MD_CALLBACK_TOKEN` reference anywhere:

```bash
rg -n 'MD_CALLBACK_URL|MD_CALLBACK_TOKEN' apps packages
```

Should return zero matches.

- [ ] **Step 9.5: Update adapter test fixtures**

```bash
rg -n 'callback:' packages/tool-adapters/src/**/*.spec.ts apps/api/src/modules/benchmark/k8s/*.spec.ts
```

For each fixture passing `callback: { url, token }`, remove that line.

- [ ] **Step 9.6: Update k8s-job-manifest.spec.ts assertions**

Edit `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts`. Delete the fixture's `callback: { url: "http://api/", token: "tk" }` (around line 15). Delete any assertion that asserts `MD_CALLBACK_URL` in env or `MD_CALLBACK_TOKEN` in secret data.

```bash
rg -n 'MD_CALLBACK|callback:' apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts
```

After edits, the file should not reference either name.

- [ ] **Step 9.7: Update k8s-benchmark-runner.spec.ts fixture**

Same drill for `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.spec.ts` line ~13:

Delete:
```ts
  callback: { url: "http://api/", token: "tk" },
```

- [ ] **Step 9.8: Rebuild contracts + tool-adapters**

```bash
pnpm -F @modeldoctor/contracts build
pnpm -F @modeldoctor/tool-adapters build
```

Expected: PASS. If tool-adapter API surface changed (BuildCommandContext shape), tests may fail; rerun:

```bash
pnpm -F @modeldoctor/tool-adapters test
```

- [ ] **Step 9.9: Full typecheck**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: **PASS now** (Phase 7's intentional gap closes here).

- [ ] **Step 9.10: Run all api unit + spec tests**

```bash
pnpm -F @modeldoctor/api test
```

Expected: all PASS. If anything still references `callback` field, fix and re-run.

- [ ] **Step 9.11: Commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts \
        apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts \
        apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts \
        apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.spec.ts \
        packages/tool-adapters
git commit -m "$(cat <<'EOF'
refactor(api,adapters): drop callback field from BenchmarkRunInput + tool ctx

Per Phase 3 spec §代码面变更:
- BenchmarkRunInput.callback field removed (no consumer after Phase 7+8)
- BuildCommandContext.callback removed in tool-adapters
- Job manifest no longer injects MD_CALLBACK_URL env or MD_CALLBACK_TOKEN
  into the per-run Secret
- specs / fixtures updated to match

Closes the typecheck gap opened by Phase 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — RBAC: add pods/log:get

**Files:**
- Modify: `deploy/k8s/rbac.yaml`

### Steps

- [ ] **Step 10.1: Split the pods rule, add pods/log**

Edit `deploy/k8s/rbac.yaml`. In the `Role` named `modeldoctor-benchmark-driver`, the existing block (lines 30-32):

```yaml
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
```

Replace with:
```yaml
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

- [ ] **Step 10.2: yamllint / kubeval (best-effort)**

```bash
which yamllint && yamllint deploy/k8s/rbac.yaml || echo "yamllint not available, skipping"
```

- [ ] **Step 10.3: Commit**

```bash
git add deploy/k8s/rbac.yaml
git commit -m "$(cat <<'EOF'
chore(k8s): RBAC adds pods/log:get for benchmark log streaming

Per Phase 3 spec §RBAC + D7: K8s convention is to split pods and pods/log
into separate rules because the verb sets differ (pods/log only supports
get). modeldoctor-api needs this to call k8sLog.log(...) and follow
runner pod stdout/stderr without 403.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — e2e: pod log stream happy path

**Files:**
- Create: `apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts`

### Steps

- [ ] **Step 11.1: Inspect existing e2e fixtures**

```bash
ls apps/api/test/e2e/ && cat apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts 2>/dev/null | head -80
```

Phase 2 added a watcher e2e — model the Phase 3 e2e on it (same K8s informer mock, same S3 mock harness). Read its imports / setup helpers so you can re-use them.

- [ ] **Step 11.2: Write e2e**

Create `apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts`. Concrete skeleton (adapt imports + helpers to match whatever benchmark-watcher-primary.e2e-spec.ts uses):

```ts
import { Test } from "@nestjs/testing";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { K8S_LOG_CLIENT } from "../../src/modules/benchmark/k8s/pod-log-streamer-factory.js";
// import shared helpers used by benchmark-watcher-primary.e2e-spec.ts:
import {
  createBenchmarkRow,
  pushPodEvent,
  setupS3Mock,
  setupK8sWatchMock,
} from "./helpers/benchmark-e2e-harness.js";

describe("Benchmark pod log stream e2e", () => {
  let app: import("@nestjs/common").INestApplication;
  let logStream: PassThrough;
  let mockK8sLog: { log: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    // Phase 3 e2e env: primary mode + mocked K8s Log client
    process.env.K8S_WATCHER_MODE = "primary";
    logStream = new PassThrough();
    mockK8sLog = {
      log: vi.fn(async (_ns, _pod, _container, sink) => {
        // Pipe our controlled PassThrough into the streamer's sink
        logStream.pipe(sink as PassThrough);
        return { abort: vi.fn() };
      }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(K8S_LOG_CLIENT)
      .useValue(mockK8sLog)
      .compile();
    app = moduleRef.createNestApplication();
    setupS3Mock();
    setupK8sWatchMock();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    logStream.destroy();
  });

  it("Running pod → log stream → SSE delivers progress + DB row gets throttled writes", async () => {
    const runId = "e2e-stream-run-1";
    await createBenchmarkRow({ id: runId, tool: "guidellm", status: "submitted" });

    // Fire Running pod → watcher should call pool.start
    pushPodEvent({ type: "ADDED", phase: "Running", runId, podName: "pod-1", containerReady: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(mockK8sLog.log).toHaveBeenCalledTimes(1);

    // Drive log lines through the streamer
    // (Use a format that the guidellm adapter parseProgress recognizes — check
    //  packages/tool-adapters/src/guidellm/runtime.ts for the live progress regex.)
    logStream.write('[guidellm] progress: 25%\n');
    logStream.write('[guidellm] progress: 50%\n');
    logStream.write('[guidellm] progress: 75%\n');
    await new Promise((r) => setTimeout(r, 100));

    // Subscribe to SSE and verify progress events arrived
    const sseRes = await fetch(`http://127.0.0.1:${process.env.E2E_API_PORT}/api/benchmarks/${runId}/sse`);
    expect(sseRes.ok).toBe(true);
    // ... parse SSE stream, assert at least one progress event with pct >= 0.25

    // Cleanly terminate the runner — Succeeded pod → drainAndStop(5s) → ReportLoader
    logStream.end();
    pushPodEvent({ type: "MODIFIED", phase: "Succeeded", runId, podName: "pod-1" });
    await new Promise((r) => setTimeout(r, 200));

    // Final DB state via API
    const final = await fetch(`http://127.0.0.1:${process.env.E2E_API_PORT}/api/benchmarks/${runId}`);
    const { status } = await final.json();
    expect(status).toBe("completed");
  });
});
```

> **Honest note:** the exact helper API and SSE subscription pattern depend on what `benchmark-watcher-primary.e2e-spec.ts` already provides. If the existing harness does not expose `setupK8sWatchMock` / `pushPodEvent`, the agent should follow the existing pattern (likely `nock` against the apiserver URL) and **report any deviation** rather than inventing helper APIs. Treat this skeleton as a structural target.

- [ ] **Step 11.3: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e -- benchmark-pod-log-stream.e2e-spec.ts
```

Expected: PASS. If it hangs on SSE subscribe — debug by checking the SseHub's stream lifecycle (likely a race between subscribe-after-publish; subscribe BEFORE pushing the SUCCEEDED event).

- [ ] **Step 11.4: Commit**

```bash
git add apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts
git commit -m "$(cat <<'EOF'
test(api): e2e — pod log stream → SSE → terminal flip

Phase 3: drives a mocked K8s Log stream end-to-end:
- Running pod → pool.start → live log lines through PassThrough
- SSE subscribers receive progress events
- Succeeded pod → drainAndStop(5s) → ReportLoader → status=completed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12 — Final validation + PR

### Steps

- [ ] **Step 12.1: Full workspace typecheck**

```bash
pnpm -r type-check
```

Expected: all packages green.

- [ ] **Step 12.2: Full workspace lint**

```bash
pnpm -r lint
```

Expected: green. Fix any biome diagnostics introduced by the new files (Phase 1-4 most likely culprits).

- [ ] **Step 12.3: Full unit test suite**

```bash
pnpm -r test
```

Expected: green.

- [ ] **Step 12.4: API e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```

Expected: green. Includes the new Phase 11 e2e.

- [ ] **Step 12.5: Browser e2e (smoke)**

```bash
pnpm test:e2e:browser
```

Expected: existing benchmark spec passes unchanged. If a flake appears, retry once. If still failing, debug.

- [ ] **Step 12.6: Push branch**

```bash
git push -u origin feat/phase-3-pod-log-stream
```

- [ ] **Step 12.7: Open PR**

```bash
gh pr create --title "feat: Phase 3 — pod log stream replaces /log callback (#237)" --body "$(cat <<'EOF'
## Summary

Phase 3 of #237 — replaces the runner→API `/log` callback channel with an
API-pulled `Log.log(follow:true)` stream per pod, and deletes the entire
HMAC callback framework.

- API: new `PodLogStreamerPool` (singleton) + `PodLogStreamer` (state machine,
  reconnect with sinceSeconds=10 / 3-attempt give-up) + `PodLogStreamerFactory`
  (adapter-aware handleLine + RBAC boot self-check) + `ProgressThrottle`
  (1Hz trailing DB writes)
- Watcher: `handlePodEvent` idempotent attach on Running+ready; `handlePodDelete`
  force-stop; `execute()` `await pool.drainAndStop(5000|0)` before terminal
  status flip so SSE close doesn't race the final log lines
- Deleted: `BenchmarkCallbackController`, `HmacCallbackGuard`, `hmac-token`,
  `BENCHMARK_CALLBACK_SECRET`/`_URL` env, `benchmarkLogCallbackSchema`,
  `runner/callback.py`, `StreamPump` POST path, `MD_CALLBACK_URL` env,
  `MD_CALLBACK_TOKEN` per-run Secret entry, `BenchmarkRunInput.callback` field
- RBAC: split `pods` rule, add `pods/log:get`

Spec: `docs/superpowers/specs/2026-05-25-pod-log-stream-replacing-callback-design.md`

addresses #237

## Test plan

- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r lint` green
- [ ] `pnpm -r test` green
- [ ] `pnpm -F @modeldoctor/api test:e2e` green (includes Phase 11 e2e)
- [ ] `pnpm test:e2e:browser` green
- [ ] Pre-deploy: apply updated `deploy/k8s/rbac.yaml` to add `pods/log:get` BEFORE deploying the new API image (spec D8 self-check will boot-fail without it)
- [ ] Post-deploy smoke: start a real benchmark on dev MinIO + dev K8s; confirm SSE log lines stream + progress updates + final status=completed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12.8: PR follow-through**

Per CLAUDE.md, after `gh pr create`:

```bash
PR=$(gh pr view --json number -q .number)
gh pr view "$PR" --json comments,reviews,statusCheckRollup,mergeStateStatus
gh api repos/weetime/modeldoctor/pulls/"$PR"/comments
gh pr checks "$PR"
```

If checks are pending: `gh run watch <run-id> --exit-status`. Surface reviewer feedback and any red checks. After the umbrella issue #237 has all checkboxes complete, post a Phase 3 status comment on #237 summarizing what shipped.

---

## Spec coverage self-check

Skim each spec section vs. plan task. Every requirement maps to a phase:

| Spec section | Plan phase |
|---|---|
| `PodLogStreamerPool` + idempotent | Phase 4 |
| `PodLogStreamer` state machine + reconnect | Phase 2 |
| `PodLogStreamerFactory` + RBAC probe | Phase 3 |
| `ProgressThrottle` 1Hz trailing | Phase 1 |
| Watcher `execute()` drainAndStop | Phase 5 step 5.4 |
| Watcher attach in `handlePodEvent` | Phase 5 step 5.2 |
| Watcher `pool.stop` in `handlePodDelete` | Phase 5 step 5.3 |
| Module DI wiring | Phase 6 |
| Delete API callback surface | Phase 7 |
| Delete `BENCHMARK_CALLBACK_SECRET` / `_URL` env | Phase 7 |
| Delete contracts log schema | Phase 7 step 7.8 |
| Delete runner callback.py + StreamPump POST | Phase 8 |
| Drop `MD_CALLBACK_URL` env + `MD_CALLBACK_TOKEN` Secret + `BenchmarkRunInput.callback` | Phase 9 |
| Drop adapter `BuildCommandContext.callback` | Phase 9 step 9.4 |
| RBAC `pods/log:get` | Phase 10 |
| e2e | Phase 11 |
| All-suite validation + PR | Phase 12 |

No gaps. Spec D1-D8 all encoded into the implementation steps.
