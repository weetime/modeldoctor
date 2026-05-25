# Watch-based runner status — Phase 1 实施计划（watcher backstop）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 apps/api 加一个 K8s pod Informer + StartupReconciler，只做 **backstop** 兜底——在 callback 永远拿不到的两种场景下把 benchmark 翻 `failed`：(1) pod 卡在 ImagePullBackOff / CrashLoopBackOff / ErrImagePull 等 FATAL waiting 状态超过宽限期；(2) pod 进了终态但 benchmark 仍在 IN_PROGRESS 超过宽限期。callback 三个 endpoint **保留不动**，runner 镜像零改动。

**Architecture:** Informer 长连接订阅 `app.kubernetes.io/name=modeldoctor-run` label 选中的所有 pod，事件 → 纯函数 `PodStateReducer` → 守卫式 SQL UPDATE（status 必须仍是 `pending/submitted/running` 才生效，避免覆盖已到终态的 benchmark）。所有时序判断（grace period）由 watcher service 持有的 in-memory `Map<runId, Date>` 状态完成，reducer 接受外部传入的 "since" 时间戳保持纯函数。启动期 reconciler 跑一次，处理 API 停机期间漏掉的事件。

**Tech Stack:** NestJS 11 (CJS), `@kubernetes/client-node@0.21` (现有依赖，不升级), Prisma 6, Vitest 2, Postgres (现有 modeldoctor_test DB).

**Spec:** `docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`（本 PR 一并提交）
**Tracking issue:** #237 (refs #189 P1)

---

## File Structure

**Create:**
- `apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts` — 纯函数 reducer
- `apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts` — 密集 unit 覆盖
- `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts` — Informer 接入 + 时序状态
- `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts` — service unit 测试（fake informer）
- `apps/api/src/modules/benchmark/k8s/startup-reconciler.ts` — boot 对账
- `apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts` — reconciler unit
- `apps/api/src/modules/benchmark/k8s/__fixtures__/pod-fixtures.ts` — V1Pod 测试夹具

**Modify:**
- `apps/api/src/config/env.schema.ts` — 加 `K8S_WATCHER_MODE`、`WAITING_FATAL_GRACE_SEC`、`TERMINAL_RECONCILE_GRACE_SEC`
- `apps/api/.env.example` — 同步三个新 env 的样例
- `apps/api/src/modules/benchmark/constants.ts`（**新建**）— 提取 `IN_PROGRESS_STATES` 让 watcher / reducer / service 都用一份
- `apps/api/src/modules/benchmark/benchmark.service.ts` — 改成从 constants 导入 `IN_PROGRESS_STATES`，去掉本地重复定义
- `apps/api/src/modules/benchmark/benchmark.repository.ts` — 加 `updateGuarded()` 方法（status forward-only 写）
- `apps/api/src/modules/benchmark/benchmark.module.ts` — 注入 KubeConfig provider + 注册 watcher / reducer / reconciler

**Docs:**
- `docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`（已写好，需 commit）
- `docs/operations/k8s-rbac.md`（**新建**或追加）— 给 ops 文档化新增的 RBAC 需求（`pods:list/get/watch`）

---

## Pre-flight

- [ ] **Step 0a: 创建 git worktree**

```bash
# Per CLAUDE.md: 在 /Users/fangyong/vllm/modeldoctor/ 下用 worktree
git worktree add /Users/fangyong/vllm/modeldoctor/feat-watch-phase-1 -b feat/watch-runner-status-phase-1
cd /Users/fangyong/vllm/modeldoctor/feat-watch-phase-1
```

- [ ] **Step 0b: 新 worktree 需要先建一次 dist（memory: project_worktree_build_first）**

```bash
pnpm install
pnpm -r build
```

Expected: `packages/contracts/dist/` 和 `packages/tool-adapters/dist/` 存在，否则下面 apps/api typecheck 会失败。

- [ ] **Step 0c: 确认基线 typecheck + test 通过**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api test
```

Expected: 两条命令都退出 0。这是后续每个任务结束时的回归基线。

---

### Task 1: Commit spec + 加 env 配置

**Files:**
- Add: `docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`（controller 已预放置到 feat worktree）
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: 确认 spec + plan 在 feat worktree**

```bash
ls docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md
ls docs/superpowers/plans/2026-05-25-watch-based-runner-status-phase-1.md
```

Expected: 两个文件都存在。如果不在，BLOCKED 回报 controller。

- [ ] **Step 2: 看 env.schema.ts 当前结构**

读 `apps/api/src/config/env.schema.ts`，确认现有 K8s 相关项位置：

```
55:  BENCHMARK_K8S_NAMESPACE: z.string().min(1).default("modeldoctor-benchmarks"),
80:  KUBECONFIG: z.string().optional(),
```

新增三个变量加在 `BENCHMARK_K8S_NAMESPACE` 之后（K8s 配置区集中）。

- [ ] **Step 3: 编辑 env.schema.ts 加三个变量**

在 `BENCHMARK_K8S_NAMESPACE` 那一行后面插入：

```ts
  // K8s watcher (Phase 1: backstop only).
  //   off: informer 不启动（开发本机默认）
  //   backstop: informer 启动，只做 FATAL waiting / terminal-no-callback 兜底
  //   primary: Phase 2 之后才用，本 phase 不实施
  K8S_WATCHER_MODE: z.enum(["off", "backstop", "primary"]).default("off"),
  // 等待状态进 ImagePullBackOff/CrashLoopBackOff 等 FATAL waiting 多久后翻 failed。
  // K8s 社区惯例 60s；registry 限速 / 短暂网络抖动通常 < 30s。
  WAITING_FATAL_GRACE_SEC: z.coerce.number().int().positive().default(60),
  // pod 进终态后给 callback 多少时间到达；超时则 watcher 接管翻 failed。
  // 默认 60s，覆盖 /finish 序列化大 stdout/files + 网络往返。
  TERMINAL_RECONCILE_GRACE_SEC: z.coerce.number().int().positive().default(60),
```

- [ ] **Step 4: 同步 .env.example**

在 `BENCHMARK_K8S_NAMESPACE=...` 后追加：

```
# K8s pod watcher mode: off | backstop | primary
# - off: no watcher (dev default)
# - backstop: watcher detects pre-start failures + silent runner death
# - primary: reserved for Phase 2 (do not set yet)
K8S_WATCHER_MODE=off
# Grace seconds before FATAL waiting reasons (ImagePullBackOff, ...) → failed.
WAITING_FATAL_GRACE_SEC=60
# Grace seconds after pod terminal state before watcher acts (callback wins inside this window).
TERMINAL_RECONCILE_GRACE_SEC=60
```

- [ ] **Step 5: 跑 env-example check + typecheck**

```bash
pnpm -F @modeldoctor/api check:env-example
pnpm -F @modeldoctor/api type-check
```

Expected: 两条都通过。`check:env-example` 会比对 schema 跟 .env.example 是否对齐。

- [ ] **Step 6: commit**

```bash
git add docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md \
  docs/superpowers/plans/2026-05-25-watch-based-runner-status-phase-1.md \
  apps/api/src/config/env.schema.ts \
  apps/api/.env.example
git commit -m "$(cat <<'EOF'
docs+build: spec + plan + env flags for K8s watcher Phase 1 (refs #237)

Design spec for watch-based runner status (replaces #177's reference-only
callback approach with a more aggressive pull-only architecture). Phase 1
ships only the backstop watcher; callbacks stay primary.

Env flags introduced:
- K8S_WATCHER_MODE (off|backstop|primary) — feature gate, defaults off
- WAITING_FATAL_GRACE_SEC — pre-start failure detection threshold
- TERMINAL_RECONCILE_GRACE_SEC — callback wins for this window after pod term

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 提取 IN_PROGRESS_STATES 到共享常量 + 加 updateGuarded()

**Files:**
- Create: `apps/api/src/modules/benchmark/constants.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts:37-40`
- Modify: `apps/api/src/modules/benchmark/benchmark.repository.ts`
- Create: `apps/api/src/modules/benchmark/benchmark.repository.spec.ts` (如不存在则新建)

- [ ] **Step 1: 新建 constants.ts**

```ts
// apps/api/src/modules/benchmark/constants.ts
/** Benchmark lifecycle states where the runner has not yet reached a terminal verdict. */
export const IN_PROGRESS_STATES = ["pending", "submitted", "running"] as const;
export type InProgressStatus = (typeof IN_PROGRESS_STATES)[number];

export function isInProgressStatus(status: string): boolean {
  return (IN_PROGRESS_STATES as readonly string[]).includes(status);
}

/** Terminal states. Once a benchmark reaches one, no further status writes are allowed. */
export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalStatus = (typeof TERMINAL_STATES)[number];
```

- [ ] **Step 2: 改 benchmark.service.ts 引用共享常量**

打开 `apps/api/src/modules/benchmark/benchmark.service.ts`。

替换 line 32 (`const TERMINAL_STATES = ...`) 到 line 40 之间的本地定义，改为：

```ts
import {
  IN_PROGRESS_STATES,
  TERMINAL_STATES,
  isInProgressStatus,
} from "./constants.js";
```

（原 import 块顶部加进去，删掉本地 const 定义和本地 `isInProgressStatus` 函数。注意保留所有现有 import 语句，只是去掉 line 32 和 37-40 的本地定义。）

- [ ] **Step 3: 跑现有 service test 确认零回归**

```bash
pnpm -F @modeldoctor/api test -- benchmark.service.spec
```

Expected: 全部 PASS。

- [ ] **Step 4: 写 updateGuarded() 的测试（先红）**

打开或新建 `apps/api/src/modules/benchmark/benchmark.repository.spec.ts`。如果文件已存在但没相关用例，追加；不存在则新建。

```ts
// apps/api/src/modules/benchmark/benchmark.repository.spec.ts
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { BenchmarkRepository } from "./benchmark.repository.js";

describe("BenchmarkRepository.updateGuarded", () => {
  let repo: BenchmarkRepository;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [BenchmarkRepository, PrismaService],
    }).compile();
    repo = mod.get(BenchmarkRepository);
    prisma = mod.get(PrismaService);
    await prisma.benchmark.deleteMany({});
  });

  it("updates when current status is in allowedStatuses", async () => {
    const b = await prisma.benchmark.create({
      data: {
        name: "t",
        scenario: "chat",
        tool: "guidellm",
        params: {},
        status: "running",
      },
    });
    const updated = await repo.updateGuarded(
      b.id,
      ["pending", "submitted", "running"],
      { status: "failed", statusMessage: "watcher: test" },
    );
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("failed");
    expect(updated?.statusMessage).toBe("watcher: test");
  });

  it("returns null when current status is NOT in allowedStatuses", async () => {
    const b = await prisma.benchmark.create({
      data: {
        name: "t",
        scenario: "chat",
        tool: "guidellm",
        params: {},
        status: "completed",
      },
    });
    const updated = await repo.updateGuarded(
      b.id,
      ["pending", "submitted", "running"],
      { status: "failed", statusMessage: "should not apply" },
    );
    expect(updated).toBeNull();
    // confirm DB row unchanged
    const reloaded = await prisma.benchmark.findUnique({ where: { id: b.id } });
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.statusMessage).toBeNull();
  });

  it("returns null when row does not exist", async () => {
    const updated = await repo.updateGuarded(
      "00000000-0000-0000-0000-000000000000",
      ["running"],
      { status: "failed" },
    );
    expect(updated).toBeNull();
  });
});
```

- [ ] **Step 5: 跑 test 确认它失败**

```bash
pnpm -F @modeldoctor/api test -- benchmark.repository.spec
```

Expected: FAIL，因为 `updateGuarded` 方法不存在。

- [ ] **Step 6: 实现 updateGuarded()**

在 `apps/api/src/modules/benchmark/benchmark.repository.ts` 的 `update()` 方法之后追加：

```ts
  /**
   * Conditional update: only writes when current `status` is in `allowedStatuses`.
   * Returns the updated row, or `null` if the guard rejected the write (row not
   * found OR status outside allowed set).
   *
   * Implementation uses Prisma's `updateMany` with a `where: { status: { in } }`
   * filter; if `count === 0` the guard rejected. Followed by a `findUnique` to
   * return the new row. Two queries instead of one, but cleaner than raw SQL
   * and the watcher path is low-volume.
   */
  async updateGuarded(
    id: string,
    allowedStatuses: readonly string[],
    input: UpdateBenchmarkInput,
  ): Promise<PrismaBenchmark | null> {
    const result = await this.prisma.benchmark.updateMany({
      where: { id, status: { in: [...allowedStatuses] } },
      data: input,
    });
    if (result.count === 0) return null;
    return this.prisma.benchmark.findUnique({ where: { id } });
  }
```

- [ ] **Step 7: 跑 test 确认通过**

```bash
pnpm -F @modeldoctor/api test -- benchmark.repository.spec
```

Expected: 三个 case 全 PASS。

- [ ] **Step 8: 跑全套 api test 确认零回归**

```bash
pnpm -F @modeldoctor/api test
```

Expected: 全 PASS。

- [ ] **Step 9: commit**

```bash
git add apps/api/src/modules/benchmark/constants.ts \
  apps/api/src/modules/benchmark/benchmark.service.ts \
  apps/api/src/modules/benchmark/benchmark.repository.ts \
  apps/api/src/modules/benchmark/benchmark.repository.spec.ts
git commit -m "$(cat <<'EOF'
refactor(api): extract IN_PROGRESS_STATES + add Repository.updateGuarded (refs #237)

constants.ts becomes the SSOT for benchmark lifecycle state buckets so the
forthcoming watcher and the existing service share one definition.

updateGuarded() lets writers say "only update if current status is in this
set" — used by the watcher to enforce status-forward-only writes (D5 in the
spec): terminal benchmarks never get overwritten even under race with
callbacks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: PodStateReducer 纯函数 + 密集 unit 测试

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/__fixtures__/pod-fixtures.ts`
- Create: `apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts`
- Create: `apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts`

- [ ] **Step 1: 写 pod fixtures**

```ts
// apps/api/src/modules/benchmark/k8s/__fixtures__/pod-fixtures.ts
import type { V1Pod } from "@kubernetes/client-node";

const RUN_ID = "run-abc";

const BASE: V1Pod = {
  metadata: {
    name: `run-${RUN_ID}-xyz`,
    namespace: "modeldoctor-benchmarks",
    labels: {
      "app.kubernetes.io/name": "modeldoctor-run",
      "app.kubernetes.io/managed-by": "modeldoctor-api",
      "modeldoctor.ai/run-id": RUN_ID,
    },
  },
  spec: { containers: [{ name: "runner", image: "x:latest" }] },
  status: {},
};

export function podRunId(): string {
  return RUN_ID;
}

export function podPending(): V1Pod {
  return { ...BASE, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "True" }] } };
}

export function podPendingWaiting(reason: string, message = "test"): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Pending",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "",
          state: { waiting: { reason, message } },
        },
      ],
    },
  };
}

export function podRunning(): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "runner",
          ready: true,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { running: { startedAt: new Date() } },
        },
      ],
    },
  };
}

export function podSucceeded(): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Succeeded",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { terminated: { exitCode: 0, reason: "Completed", finishedAt: new Date() } },
        },
      ],
    },
  };
}

export function podFailed(exitCode = 1, reason = "Error", message = "tool exit 1"): V1Pod {
  return {
    ...BASE,
    status: {
      phase: "Failed",
      containerStatuses: [
        {
          name: "runner",
          ready: false,
          restartCount: 0,
          image: "x:latest",
          imageID: "x@sha256:abc",
          state: { terminated: { exitCode, reason, message, finishedAt: new Date() } },
        },
      ],
    },
  };
}

export function podNoLabels(): V1Pod {
  return {
    metadata: { name: "rogue", namespace: "modeldoctor-benchmarks", labels: {} },
    spec: { containers: [{ name: "x", image: "x" }] },
    status: { phase: "Running" },
  };
}
```

- [ ] **Step 2: 写 reducer 测试（先红）**

```ts
// apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts
import { describe, expect, it } from "vitest";
import {
  podFailed,
  podPending,
  podPendingWaiting,
  podRunning,
  podSucceeded,
} from "./__fixtures__/pod-fixtures.js";
import { reduce, type ReducerConfig } from "./pod-state-reducer.js";

const CONFIG: ReducerConfig = {
  fatalWaitingReasons: [
    "ImagePullBackOff",
    "CrashLoopBackOff",
    "ErrImagePull",
    "CreateContainerConfigError",
    "CreateContainerError",
    "InvalidImageName",
  ],
  waitingFatalGraceSec: 60,
  terminalReconcileGraceSec: 60,
};

const NOW = new Date("2026-05-25T10:00:00Z");

describe("PodStateReducer", () => {
  describe("noop cases", () => {
    it("returns noop when benchmark already terminal", () => {
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "completed",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on plain Pending (no waiting reason yet)", () => {
      const r = reduce({
        pod: podPending(),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on Running (backstop does not flip to running)", () => {
      const r = reduce({
        pod: podRunning(),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });

    it("returns noop on transient ContainerCreating waiting", () => {
      const r = reduce({
        pod: podPendingWaiting("ContainerCreating"),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("FATAL waiting → failed-pre-start", () => {
    for (const reason of [
      "ImagePullBackOff",
      "CrashLoopBackOff",
      "ErrImagePull",
      "CreateContainerConfigError",
      "CreateContainerError",
      "InvalidImageName",
    ]) {
      it(`flags ${reason} after grace`, () => {
        const firstSeen = new Date(NOW.getTime() - 61_000);
        const r = reduce({
          pod: podPendingWaiting(reason, "details here"),
          currentStatus: "submitted",
          firstFatalWaitingAt: firstSeen,
          firstTerminalAt: null,
          now: NOW,
          config: CONFIG,
        });
        expect(r.kind).toBe("failed-pre-start");
        if (r.kind === "failed-pre-start") {
          expect(r.reason).toBe(reason);
          expect(r.message).toContain("details here");
        }
      });
    }

    it("does NOT flag within grace window", () => {
      const firstSeen = new Date(NOW.getTime() - 30_000);
      const r = reduce({
        pod: podPendingWaiting("ImagePullBackOff"),
        currentStatus: "submitted",
        firstFatalWaitingAt: firstSeen,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });

    it("does NOT flag when firstFatalWaitingAt is null (just saw it)", () => {
      const r = reduce({
        pod: podPendingWaiting("ImagePullBackOff"),
        currentStatus: "submitted",
        firstFatalWaitingAt: null,
        firstTerminalAt: null,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("terminal phase + IN_PROGRESS → failed-terminal (after grace)", () => {
    it("Failed pod after grace → failed-terminal with exitCode/reason/message", () => {
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podFailed(137, "OOMKilled", "Memory limit exceeded"),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("failed-terminal");
      if (r.kind === "failed-terminal") {
        expect(r.exitCode).toBe(137);
        expect(r.reason).toBe("OOMKilled");
        expect(r.message).toContain("Memory limit exceeded");
      }
    });

    it("Succeeded pod after grace + IN_PROGRESS → failed-terminal (silent runner)", () => {
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("failed-terminal");
      if (r.kind === "failed-terminal") {
        expect(r.exitCode).toBe(0);
        expect(r.message).toMatch(/callback never arrived|no callback/i);
      }
    });

    it("Failed pod within grace window → noop (give callback a chance)", () => {
      const firstTerm = new Date(NOW.getTime() - 30_000);
      const r = reduce({
        pod: podFailed(),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });

    it("Terminal pod + benchmark already terminal → noop", () => {
      const firstTerm = new Date(NOW.getTime() - 999_000);
      const r = reduce({
        pod: podSucceeded(),
        currentStatus: "completed",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
      });
      expect(r.kind).toBe("noop");
    });
  });

  describe("statusMessage construction", () => {
    it("truncates long messages to 2048 chars", () => {
      const longMsg = "x".repeat(5000);
      const firstTerm = new Date(NOW.getTime() - 61_000);
      const r = reduce({
        pod: podFailed(1, "Error", longMsg),
        currentStatus: "running",
        firstFatalWaitingAt: null,
        firstTerminalAt: firstTerm,
        now: NOW,
        config: CONFIG,
      });
      if (r.kind === "failed-terminal") {
        expect(r.message.length).toBeLessThanOrEqual(2048);
      }
    });
  });
});
```

- [ ] **Step 3: 跑 test 确认全红**

```bash
pnpm -F @modeldoctor/api test -- pod-state-reducer
```

Expected: 全部 FAIL（module not found）。

- [ ] **Step 4: 实现 reducer**

```ts
// apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts
import type { V1Pod } from "@kubernetes/client-node";
import { isInProgressStatus } from "../constants.js";

export interface ReducerConfig {
  fatalWaitingReasons: readonly string[];
  waitingFatalGraceSec: number;
  terminalReconcileGraceSec: number;
}

export type DesiredTransition =
  | { kind: "failed-pre-start"; reason: string; message: string }
  | { kind: "failed-terminal"; exitCode: number; reason: string; message: string }
  | { kind: "noop" };

export interface ReducerInput {
  pod: V1Pod;
  currentStatus: string;
  /** Earliest time the watcher service observed this pod in a FATAL waiting state.
   *  null if not currently in FATAL waiting OR this is the first observation. */
  firstFatalWaitingAt: Date | null;
  /** Earliest time the watcher service observed this pod in a terminal phase.
   *  null if not in terminal phase. */
  firstTerminalAt: Date | null;
  now: Date;
  config: ReducerConfig;
}

const MAX_MSG_LEN = 2048;

function truncate(s: string): string {
  return s.length > MAX_MSG_LEN ? s.slice(0, MAX_MSG_LEN) : s;
}

function getWaitingReason(pod: V1Pod): { reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.[0];
  const w = cs?.state?.waiting;
  if (!w?.reason) return null;
  return { reason: w.reason, message: w.message ?? "" };
}

function getTerminated(pod: V1Pod): { exitCode: number; reason: string; message: string } | null {
  const cs = pod.status?.containerStatuses?.[0];
  const t = cs?.state?.terminated;
  if (!t) return null;
  return {
    exitCode: t.exitCode ?? -1,
    reason: t.reason ?? "Unknown",
    message: t.message ?? "",
  };
}

export function reduce(input: ReducerInput): DesiredTransition {
  const { pod, currentStatus, firstFatalWaitingAt, firstTerminalAt, now, config } = input;

  // Hard guard: never touch benchmarks that are already in a terminal state.
  if (!isInProgressStatus(currentStatus)) return { kind: "noop" };

  const phase = pod.status?.phase;

  // 1. FATAL waiting (pre-start failure)
  const waiting = getWaitingReason(pod);
  if (waiting && config.fatalWaitingReasons.includes(waiting.reason)) {
    if (firstFatalWaitingAt) {
      const elapsedSec = (now.getTime() - firstFatalWaitingAt.getTime()) / 1000;
      if (elapsedSec >= config.waitingFatalGraceSec) {
        return {
          kind: "failed-pre-start",
          reason: waiting.reason,
          message: truncate(`${waiting.reason}: ${waiting.message}`),
        };
      }
    }
    return { kind: "noop" };
  }

  // 2. Terminal phase (Succeeded or Failed) + benchmark still IN_PROGRESS + grace elapsed
  if (phase === "Failed" || phase === "Succeeded") {
    if (firstTerminalAt) {
      const elapsedSec = (now.getTime() - firstTerminalAt.getTime()) / 1000;
      if (elapsedSec >= config.terminalReconcileGraceSec) {
        const term = getTerminated(pod);
        if (phase === "Failed") {
          return {
            kind: "failed-terminal",
            exitCode: term?.exitCode ?? -1,
            reason: term?.reason ?? "PodFailed",
            message: truncate(
              term ? `${term.reason}: ${term.message}` : "pod in Failed phase",
            ),
          };
        }
        // Succeeded but benchmark still IN_PROGRESS = runner exited 0 but no callback arrived.
        return {
          kind: "failed-terminal",
          exitCode: 0,
          reason: "NoCallback",
          message: "runner pod succeeded but callback never arrived",
        };
      }
    }
    return { kind: "noop" };
  }

  // 3. Running / Pending / Unknown — backstop does nothing.
  return { kind: "noop" };
}
```

- [ ] **Step 5: 跑 test 确认全绿**

```bash
pnpm -F @modeldoctor/api test -- pod-state-reducer
```

Expected: 所有 case PASS（约 14 个）。如果有未通过的，先把 reducer 调到全绿再下一步。

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts \
  apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts \
  apps/api/src/modules/benchmark/k8s/__fixtures__/pod-fixtures.ts
git commit -m "$(cat <<'EOF'
feat(api): PodStateReducer pure fn for K8s watcher backstop (refs #237)

Decides whether a pod event should trigger a benchmark status transition.
Backstop mode only: FATAL waiting > grace → failed-pre-start; terminal phase
(Failed or Succeeded) + still IN_PROGRESS + grace → failed-terminal.

Pure: time tracking (firstFatalWaitingAt / firstTerminalAt) is passed in by
the watcher service; reducer just answers "given these inputs, what should
happen now?". Dense unit coverage of all phase × reason × status combos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: K8sJobWatcherService 骨架 + fake informer test 基础设施

**Files:**
- Create: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`
- Create: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts`

本任务只搭骨架：构造函数 + lifecycle，先不接 Informer。下一任务再接。

- [ ] **Step 1: 写 service 测试（先红）— 测 lifecycle + mode=off short-circuit**

```ts
// apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts
import type { Informer, V1Pod } from "@kubernetes/client-node";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { K8sJobWatcherService, type WatcherDeps } from "./k8s-job-watcher.service.js";

function makeFakeInformer() {
  const handlers = new Map<string, Array<(arg: unknown) => void>>();
  const informer: Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    on: vi.fn((verb: string, cb: (arg: unknown) => void) => {
      if (!handlers.has(verb)) handlers.set(verb, []);
      handlers.get(verb)!.push(cb);
    }),
    off: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    fire: (verb: string, payload: unknown) => {
      handlers.get(verb)?.forEach((cb) => cb(payload));
    },
  } as unknown as Informer<V1Pod> & {
    fire: (verb: string, payload: unknown) => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  return informer;
}

function makeDeps(mode: "off" | "backstop" = "backstop"): {
  deps: WatcherDeps;
  informer: ReturnType<typeof makeFakeInformer>;
  repo: { findById: ReturnType<typeof vi.fn>; updateGuarded: ReturnType<typeof vi.fn> };
  reconciler: { run: ReturnType<typeof vi.fn> };
} {
  const informer = makeFakeInformer();
  const repo = {
    findById: vi.fn(async () => null),
    updateGuarded: vi.fn(async () => null),
  };
  const reconciler = { run: vi.fn(async () => undefined) };
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
    },
    informer,
    repo,
    reconciler,
  };
}

describe("K8sJobWatcherService", () => {
  describe("mode=off", () => {
    it("does NOT start informer or run reconciler on init", async () => {
      const { deps, informer, reconciler } = makeDeps("off");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      expect(informer.start).not.toHaveBeenCalled();
      expect(reconciler.run).not.toHaveBeenCalled();
    });
  });

  describe("mode=backstop", () => {
    it("starts informer + runs reconciler on init", async () => {
      const { deps, informer, reconciler } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      expect(informer.start).toHaveBeenCalledOnce();
      expect(reconciler.run).toHaveBeenCalledOnce();
    });

    it("stops informer on destroy", async () => {
      const { deps, informer } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleInit();
      await svc.onModuleDestroy();
      expect(informer.stop).toHaveBeenCalledOnce();
    });

    it("is destroy-safe when init never ran", async () => {
      const { deps, informer } = makeDeps("backstop");
      const svc = new K8sJobWatcherService(deps);
      await svc.onModuleDestroy();
      expect(informer.stop).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 跑 test 确认全红**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher.service
```

Expected: FAIL，module not found。

- [ ] **Step 3: 实现 service 骨架**

```ts
// apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts
import type { Informer, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import type { ReducerConfig } from "./pod-state-reducer.js";
import type { StartupReconciler } from "./startup-reconciler.js";

export type WatcherMode = "off" | "backstop" | "primary";

export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  /** Factory so callers can inject a fake in tests without touching K8s. */
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
}

@Injectable()
export class K8sJobWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(K8sJobWatcherService.name);
  private informer: Informer<V1Pod> | null = null;
  /** runId → earliest moment this pod was observed in a FATAL waiting state. */
  private readonly firstFatalWaitingAt = new Map<string, Date>();
  /** runId → earliest moment this pod was observed in a terminal phase. */
  private readonly firstTerminalAt = new Map<string, Date>();

  constructor(private readonly deps: WatcherDeps) {}

  async onModuleInit(): Promise<void> {
    if (this.deps.mode === "off") {
      this.log.log("K8S_WATCHER_MODE=off → skipping informer + reconciler");
      return;
    }
    if (this.deps.mode === "primary") {
      throw new Error("K8S_WATCHER_MODE=primary is reserved for Phase 2; not yet implemented");
    }
    // mode === "backstop"
    this.informer = this.deps.makeInformer();
    // Handlers wired in Task 5
    await this.informer.start();
    this.log.log(`K8s watcher started (mode=backstop, ns=${this.deps.namespace})`);
    await this.deps.reconciler.run();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.informer) {
      await this.informer.stop();
      this.log.log("K8s watcher stopped");
    }
  }
}
```

- [ ] **Step 4: 跑 test 确认通过**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher.service
```

Expected: 4 个 case 全 PASS。

- [ ] **Step 5: typecheck 整个 api**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: 0 errors. （StartupReconciler 还不存在 → 用 `type` import 不会触发 runtime 引用错，但 ts 编译会报 module not found。如果报，先 stub 一个空文件 `startup-reconciler.ts`：`export class StartupReconciler { async run() {} }`，下一任务再实现。）

如果 typecheck 报 StartupReconciler 找不到，临时建一个 stub：

```ts
// apps/api/src/modules/benchmark/k8s/startup-reconciler.ts (临时 stub, Task 6 替换)
export class StartupReconciler {
  async run(): Promise<void> {}
}
```

并把 stub 加进 staged 文件。

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts \
  apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts \
  apps/api/src/modules/benchmark/k8s/startup-reconciler.ts
git commit -m "$(cat <<'EOF'
feat(api): K8sJobWatcherService skeleton + lifecycle (refs #237)

Mode dispatch (off|backstop|primary) and Informer start/stop wired to
NestJS lifecycle. Informer factory is injected via WatcherDeps so tests
can pass a fake without touching K8s.

Pod event handlers (ADD/UPDATE/DELETE/ERROR/CONNECT) wired in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 接 Informer 事件 → Reducer → updateGuarded

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts`

- [ ] **Step 1: 追加 service 测试（先红）— 测事件 → 动作**

在 `k8s-job-watcher.service.spec.ts` 末尾追加新 describe 块：

```ts
import { podFailed, podPendingWaiting, podRunId, podSucceeded } from "./__fixtures__/pod-fixtures.js";

describe("K8sJobWatcherService event handling", () => {
  it("ADD with FATAL waiting → starts tracking + no immediate update", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();

    informer.fire("ADD", podPendingWaiting("ImagePullBackOff"));
    // grace not elapsed → no update
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("UPDATE after grace with FATAL waiting → updateGuarded(failed)", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    // simulate earlier observation by injecting state
    (svc as unknown as { firstFatalWaitingAt: Map<string, Date> }).firstFatalWaitingAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );

    informer.fire("UPDATE", podPendingWaiting("ImagePullBackOff", "boom"));
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringContaining("ImagePullBackOff"),
      }),
    );
  });

  it("UPDATE with non-fatal waiting clears firstFatalWaitingAt", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "submitted" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as { firstFatalWaitingAt: Map<string, Date> };
    state.firstFatalWaitingAt.set(podRunId(), new Date());

    informer.fire("UPDATE", podPendingWaiting("ContainerCreating"));
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
  });

  it("UPDATE with Succeeded pod after grace + IN_PROGRESS → failed-terminal", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "running" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    (svc as unknown as { firstTerminalAt: Map<string, Date> }).firstTerminalAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );

    informer.fire("UPDATE", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      podRunId(),
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringMatching(/no callback|never arrived/i),
      }),
    );
  });

  it("DELETE clears in-memory state for the runId", async () => {
    const { deps, informer } = makeDeps("backstop");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    const state = svc as unknown as {
      firstFatalWaitingAt: Map<string, Date>;
      firstTerminalAt: Map<string, Date>;
    };
    state.firstFatalWaitingAt.set(podRunId(), new Date());
    state.firstTerminalAt.set(podRunId(), new Date());

    informer.fire("DELETE", podFailed());
    await new Promise((r) => setTimeout(r, 5));
    expect(state.firstFatalWaitingAt.has(podRunId())).toBe(false);
    expect(state.firstTerminalAt.has(podRunId())).toBe(false);
  });

  it("ignores pods without modeldoctor.ai/run-id label", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    informer.fire("ADD", {
      metadata: { name: "rogue", namespace: "x", labels: {} },
      status: { phase: "Running" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("ignores benchmarks already in terminal state", async () => {
    const { deps, informer, repo } = makeDeps("backstop");
    repo.findById.mockResolvedValue({ id: podRunId(), status: "completed" });
    const svc = new K8sJobWatcherService(deps);
    await svc.onModuleInit();
    (svc as unknown as { firstTerminalAt: Map<string, Date> }).firstTerminalAt.set(
      podRunId(),
      new Date(Date.now() - 120_000),
    );
    informer.fire("UPDATE", podSucceeded());
    await new Promise((r) => setTimeout(r, 5));
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑 test 确认全红**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher.service
```

Expected: 新增 7 个 case 全 FAIL。

- [ ] **Step 3: 实现事件处理**

替换 `k8s-job-watcher.service.ts` 整个文件内容为：

```ts
// apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts
import type { Informer, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";
import { type DesiredTransition, type ReducerConfig, reduce } from "./pod-state-reducer.js";
import type { StartupReconciler } from "./startup-reconciler.js";

export type WatcherMode = "off" | "backstop" | "primary";

const RUN_ID_LABEL = "modeldoctor.ai/run-id";

export interface WatcherDeps {
  mode: WatcherMode;
  namespace: string;
  reducerConfig: ReducerConfig;
  makeInformer: () => Informer<V1Pod>;
  repo: BenchmarkRepository;
  reconciler: StartupReconciler;
}

@Injectable()
export class K8sJobWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(K8sJobWatcherService.name);
  private informer: Informer<V1Pod> | null = null;
  private readonly firstFatalWaitingAt = new Map<string, Date>();
  private readonly firstTerminalAt = new Map<string, Date>();
  private consecutiveErrors = 0;

  constructor(private readonly deps: WatcherDeps) {}

  async onModuleInit(): Promise<void> {
    if (this.deps.mode === "off") {
      this.log.log("K8S_WATCHER_MODE=off → skipping informer + reconciler");
      return;
    }
    if (this.deps.mode === "primary") {
      throw new Error("K8S_WATCHER_MODE=primary is reserved for Phase 2; not yet implemented");
    }
    this.informer = this.deps.makeInformer();
    this.informer.on("ADD", (p) => this.handlePodEvent(p));
    this.informer.on("UPDATE", (p) => this.handlePodEvent(p));
    this.informer.on("DELETE", (p) => this.handlePodDelete(p));
    this.informer.on("CONNECT", () => {
      this.consecutiveErrors = 0;
      this.log.log("informer connected");
    });
    this.informer.on("ERROR", (e) => {
      this.consecutiveErrors += 1;
      this.log.warn(
        `informer error (#${this.consecutiveErrors}): ${e instanceof Error ? e.message : String(e)}`,
      );
      // The informer auto-reconnects; we only log. Future: emit ops alert at threshold.
    });
    await this.informer.start();
    this.log.log(`K8s watcher started (mode=backstop, ns=${this.deps.namespace})`);
    await this.deps.reconciler.run();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.informer) {
      await this.informer.stop();
      this.log.log("K8s watcher stopped");
    }
  }

  private extractRunId(pod: V1Pod): string | null {
    return pod.metadata?.labels?.[RUN_ID_LABEL] ?? null;
  }

  /** Updates in-memory tracking maps based on current pod state. */
  private trackTiming(pod: V1Pod, runId: string, now: Date): void {
    const phase = pod.status?.phase;
    const waitingReason = pod.status?.containerStatuses?.[0]?.state?.waiting?.reason;
    const isFatalWaiting =
      !!waitingReason && this.deps.reducerConfig.fatalWaitingReasons.includes(waitingReason);

    if (isFatalWaiting) {
      if (!this.firstFatalWaitingAt.has(runId)) this.firstFatalWaitingAt.set(runId, now);
    } else {
      this.firstFatalWaitingAt.delete(runId);
    }

    if (phase === "Failed" || phase === "Succeeded") {
      if (!this.firstTerminalAt.has(runId)) this.firstTerminalAt.set(runId, now);
    } else {
      this.firstTerminalAt.delete(runId);
    }
  }

  private async handlePodEvent(pod: V1Pod): Promise<void> {
    const runId = this.extractRunId(pod);
    if (!runId) return;

    const now = new Date();
    this.trackTiming(pod, runId, now);

    let bench: Awaited<ReturnType<BenchmarkRepository["findById"]>>;
    try {
      bench = await this.deps.repo.findById(runId);
    } catch (e) {
      this.log.warn(`findById(${runId}) failed: ${(e as Error).message}`);
      return;
    }
    if (!bench) return;

    const transition = reduce({
      pod,
      currentStatus: bench.status,
      firstFatalWaitingAt: this.firstFatalWaitingAt.get(runId) ?? null,
      firstTerminalAt: this.firstTerminalAt.get(runId) ?? null,
      now,
      config: this.deps.reducerConfig,
    });

    await this.execute(runId, transition, now);
  }

  private handlePodDelete(pod: V1Pod): void {
    const runId = this.extractRunId(pod);
    if (!runId) return;
    this.firstFatalWaitingAt.delete(runId);
    this.firstTerminalAt.delete(runId);
  }

  private async execute(runId: string, t: DesiredTransition, now: Date): Promise<void> {
    if (t.kind === "noop") return;
    try {
      const updated = await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: t.message,
        completedAt: now,
      });
      if (!updated) {
        this.log.log(
          `guard rejected update for ${runId} (status already terminal); watcher backed off`,
        );
        return;
      }
      this.log.log(`watcher marked ${runId} failed: ${t.kind}`);
    } catch (e) {
      this.log.warn(`updateGuarded(${runId}) failed: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: 跑 service test 确认全绿**

```bash
pnpm -F @modeldoctor/api test -- k8s-job-watcher.service
```

Expected: 全部 PASS (4 lifecycle + 7 event handling = 11 cases)。

- [ ] **Step 5: 跑全套 api test 确认零回归**

```bash
pnpm -F @modeldoctor/api test
```

Expected: 全 PASS。

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts \
  apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api): K8sJobWatcherService event handlers + reducer dispatch (refs #237)

ADD/UPDATE → trackTiming → findById → reduce → updateGuarded.
DELETE → clear in-memory state for the runId.
CONNECT/ERROR → log + count consecutive errors (no alerting yet).

Pods without modeldoctor.ai/run-id label are silently ignored (defensive
against rogue pods landing in the namespace). All status writes go through
updateGuarded so terminal benchmarks are never overwritten.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: StartupReconciler

**Files:**
- Modify: `apps/api/src/modules/benchmark/k8s/startup-reconciler.ts`（替换 Task 4 的 stub）
- Create: `apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.repository.ts`（加 `listByStatus`）

- [ ] **Step 1: 加 `BenchmarkRepository.listByStatus()`**

打开 `apps/api/src/modules/benchmark/benchmark.repository.ts`，在 `updateGuarded` 之后追加：

```ts
  /**
   * List benchmarks whose status is in the given set. Used by StartupReconciler
   * to find IN_PROGRESS benchmarks at boot time and reconcile against cluster
   * state. Bounded at 500 rows for safety; in practice the IN_PROGRESS set is
   * tiny (benchmarks finish in minutes, not hours).
   */
  async listByStatus(statuses: readonly string[]): Promise<PrismaBenchmark[]> {
    return this.prisma.benchmark.findMany({
      where: { status: { in: [...statuses] } },
      take: 500,
    });
  }
```

- [ ] **Step 2: 写 reconciler 测试（先红）**

```ts
// apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartupReconciler, type ReconcilerDeps } from "./startup-reconciler.js";

function makeDeps(): {
  deps: ReconcilerDeps;
  repo: {
    listByStatus: ReturnType<typeof vi.fn>;
    updateGuarded: ReturnType<typeof vi.fn>;
  };
  cache: { get: ReturnType<typeof vi.fn> };
} {
  const repo = {
    listByStatus: vi.fn(async () => []),
    updateGuarded: vi.fn(async () => ({ id: "x" })),
  };
  const cache = { get: vi.fn(() => undefined) };
  return {
    deps: {
      namespace: "modeldoctor-benchmarks",
      repo: repo as never,
      podCache: cache as never,
    },
    repo,
    cache,
  };
}

describe("StartupReconciler", () => {
  it("no-op when no IN_PROGRESS benchmarks", async () => {
    const { deps, repo } = makeDeps();
    await new StartupReconciler(deps).run();
    expect(repo.listByStatus).toHaveBeenCalledOnce();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("leaves benchmarks alone when matching pod exists (informer will handle)", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    cache.get.mockReturnValue({
      metadata: { name: "run-abc", labels: { "modeldoctor.ai/run-id": "abc" } },
      status: { phase: "Running" },
    });
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).not.toHaveBeenCalled();
  });

  it("marks failed when pod is gone (orphan)", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([{ id: "abc", status: "running" }]);
    cache.get.mockReturnValue(undefined);
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledWith(
      "abc",
      ["pending", "submitted", "running"],
      expect.objectContaining({
        status: "failed",
        statusMessage: expect.stringMatching(/pod gone|orphan/i),
      }),
    );
  });

  it("processes multiple benchmarks independently", async () => {
    const { deps, repo, cache } = makeDeps();
    repo.listByStatus.mockResolvedValue([
      { id: "a", status: "running" },
      { id: "b", status: "submitted" },
      { id: "c", status: "running" },
    ]);
    cache.get.mockImplementation((name: string) => {
      if (name === "run-b") return { metadata: { labels: {} }, status: { phase: "Running" } };
      return undefined;
    });
    await new StartupReconciler(deps).run();
    expect(repo.updateGuarded).toHaveBeenCalledTimes(2);
    expect(repo.updateGuarded).toHaveBeenCalledWith("a", expect.any(Array), expect.any(Object));
    expect(repo.updateGuarded).toHaveBeenCalledWith("c", expect.any(Array), expect.any(Object));
  });
});
```

- [ ] **Step 3: 跑 test 确认全红**

```bash
pnpm -F @modeldoctor/api test -- startup-reconciler
```

Expected: FAIL — StartupReconciler is still the stub from Task 4。

- [ ] **Step 4: 实现 reconciler（替换 Task 4 的 stub）**

```ts
// apps/api/src/modules/benchmark/k8s/startup-reconciler.ts
import type { ObjectCache, V1Pod } from "@kubernetes/client-node";
import { Injectable, Logger } from "@nestjs/common";
import { IN_PROGRESS_STATES } from "../constants.js";
import type { BenchmarkRepository } from "../benchmark.repository.js";

export interface ReconcilerDeps {
  namespace: string;
  repo: BenchmarkRepository;
  podCache: ObjectCache<V1Pod>;
}

@Injectable()
export class StartupReconciler {
  private readonly log = new Logger(StartupReconciler.name);

  constructor(private readonly deps: ReconcilerDeps) {}

  async run(): Promise<void> {
    const inProgress = await this.deps.repo.listByStatus(IN_PROGRESS_STATES);
    if (inProgress.length === 0) {
      this.log.log("reconcile: no IN_PROGRESS benchmarks");
      return;
    }
    this.log.log(`reconcile: ${inProgress.length} IN_PROGRESS benchmark(s) to check`);

    for (const b of inProgress) {
      const podName = `run-${b.id}`;
      const pod = this.deps.podCache.get(podName, this.deps.namespace);
      if (pod) {
        // Informer will deliver events for this pod; nothing to do here.
        continue;
      }
      // Phase 1 scope: no storage yet, so any orphan IN_PROGRESS → failed.
      // Phase 2 will check storage first (report file may exist even if pod is gone).
      const updated = await this.deps.repo.updateGuarded(b.id, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: "pod gone before reconcile",
        completedAt: new Date(),
      });
      if (updated) {
        this.log.log(`reconcile: marked ${b.id} failed (orphan)`);
      }
    }
  }
}
```

- [ ] **Step 5: 跑 test 确认通过**

```bash
pnpm -F @modeldoctor/api test -- startup-reconciler
```

Expected: 4 cases PASS。

- [ ] **Step 6: 跑全套 api test**

```bash
pnpm -F @modeldoctor/api test
```

Expected: 全 PASS。

- [ ] **Step 7: commit**

```bash
git add apps/api/src/modules/benchmark/k8s/startup-reconciler.ts \
  apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts \
  apps/api/src/modules/benchmark/benchmark.repository.ts
git commit -m "$(cat <<'EOF'
feat(api): StartupReconciler for orphan IN_PROGRESS benchmarks (refs #237)

On boot, lists all IN_PROGRESS benchmarks (pending/submitted/running) and
cross-checks against the informer's pod cache. Pods that no longer exist
(API was down longer than the Job TTL of 1h) → benchmark marked failed
with 'pod gone before reconcile'.

Phase 1 scope: storage is not yet a thing, so any orphan → failed. Phase 2
will check storage first (a completed report may exist even if the pod has
been TTL'd away by then) and route through ReportLoader.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire BenchmarkModule + KubeConfig provider

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.module.ts`

- [ ] **Step 1: 读现状**

```bash
cat apps/api/src/modules/benchmark/benchmark.module.ts
```

注意现有 `K8sBenchmarkRunner` 的 useFactory 已经在做 `kc.loadFromFile/loadFromDefault`，新 watcher provider 用同样模式。

- [ ] **Step 2: 改 benchmark.module.ts 加 watcher 相关 provider**

替换 providers 数组（保留所有现有 provider，追加新的），完整文件内容：

```ts
// apps/api/src/modules/benchmark/benchmark.module.ts
import type { CoreV1Api, KubeConfig, V1Pod } from "@kubernetes/client-node";
import { assertScenariosInvariant } from "@modeldoctor/tool-adapters";
import { Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { BaselineModule } from "../baseline/baseline.module.js";
import { BenchmarkTemplateModule } from "../benchmark-template/benchmark-template.module.js";
import { ConnectionModule } from "../connection/connection.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { BenchmarkChartsService } from "./benchmark-charts.service.js";
import { BenchmarkController } from "./benchmark.controller.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { BenchmarkService } from "./benchmark.service.js";
import { BenchmarkCallbackController } from "./callbacks/benchmark-callback.controller.js";
import { K8sBenchmarkRunner } from "./k8s/k8s-benchmark-runner.js";
import { K8sJobWatcherService, type WatcherMode } from "./k8s/k8s-job-watcher.service.js";
import { StartupReconciler } from "./k8s/startup-reconciler.js";
import { SseHub } from "./sse/sse-hub.service.js";

const FATAL_WAITING_REASONS = [
  "ImagePullBackOff",
  "CrashLoopBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "InvalidImageName",
] as const;

async function loadKubeConfig(config: ConfigService<Env, true>): Promise<KubeConfig> {
  const k8s = await import("@kubernetes/client-node");
  const kc = new k8s.KubeConfig();
  const explicit = config.get("KUBECONFIG", { infer: true }) as string | undefined;
  if (explicit) kc.loadFromFile(explicit);
  else kc.loadFromDefault();
  return kc;
}

@Module({
  imports: [
    ConfigModule,
    ConnectionModule,
    BenchmarkTemplateModule,
    BaselineModule,
    NotificationsModule,
  ],
  controllers: [BenchmarkController, BenchmarkCallbackController],
  providers: [
    PrismaService,
    BenchmarkRepository,
    BenchmarkService,
    BenchmarkChartsService,
    SseHub,
    {
      // K8sBenchmarkRunner — existing wiring (unchanged from before).
      provide: K8sBenchmarkRunner,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>): Promise<K8sBenchmarkRunner> => {
        const ns =
          (config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string | undefined) ??
          "modeldoctor-benchmarks";
        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        return new K8sBenchmarkRunner(
          ns,
          kc.makeApiClient(k8s.BatchV1Api),
          kc.makeApiClient(k8s.CoreV1Api),
        );
      },
    },
    {
      // K8sJobWatcherService — Phase 1 backstop watcher.
      // useFactory loads KubeConfig + builds Informer factory + StartupReconciler.
      provide: K8sJobWatcherService,
      inject: [ConfigService, BenchmarkRepository],
      useFactory: async (
        config: ConfigService<Env, true>,
        repo: BenchmarkRepository,
      ): Promise<K8sJobWatcherService> => {
        const mode = config.get("K8S_WATCHER_MODE", { infer: true }) as WatcherMode;
        const namespace = config.get("BENCHMARK_K8S_NAMESPACE", { infer: true }) as string;
        const waitingFatalGraceSec = config.get("WAITING_FATAL_GRACE_SEC", {
          infer: true,
        }) as number;
        const terminalReconcileGraceSec = config.get("TERMINAL_RECONCILE_GRACE_SEC", {
          infer: true,
        }) as number;

        if (mode === "off") {
          // Build a minimal service that no-ops everything; avoids loading K8s in dev.
          return new K8sJobWatcherService({
            mode,
            namespace,
            reducerConfig: {
              fatalWaitingReasons: FATAL_WAITING_REASONS,
              waitingFatalGraceSec,
              terminalReconcileGraceSec,
            },
            makeInformer: () => {
              throw new Error("makeInformer called in mode=off");
            },
            repo,
            reconciler: new StartupReconciler({
              namespace,
              repo,
              podCache: { get: () => undefined, list: () => [] },
            }),
          });
        }

        const k8s = await import("@kubernetes/client-node");
        const kc = await loadKubeConfig(config);
        const coreV1 = kc.makeApiClient(k8s.CoreV1Api);
        const podPath = `/api/v1/namespaces/${namespace}/pods`;
        const labelSelector = "app.kubernetes.io/name=modeldoctor-run";
        const listFn = () => coreV1.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector);
        const informer = k8s.makeInformer<V1Pod>(kc, podPath, listFn, labelSelector);
        const reconciler = new StartupReconciler({
          namespace,
          repo,
          podCache: informer,
        });

        return new K8sJobWatcherService({
          mode,
          namespace,
          reducerConfig: {
            fatalWaitingReasons: FATAL_WAITING_REASONS,
            waitingFatalGraceSec,
            terminalReconcileGraceSec,
          },
          makeInformer: () => informer,
          repo,
          reconciler,
        });
      },
    },
  ],
  exports: [BenchmarkRepository, BenchmarkService, BenchmarkChartsService, SseHub],
})
export class BenchmarkModule implements OnModuleInit {
  onModuleInit() {
    assertScenariosInvariant();
  }
}
```

- [ ] **Step 3: typecheck**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: 0 errors。

注意：`listNamespacedPod` 在 0.21 的签名是 `listNamespacedPod(namespace, pretty?, allowWatchBookmarks?, _continue?, fieldSelector?, labelSelector?, ...)`。我们传 5 个 undefined 然后 labelSelector — 这跟现有 `K8sBenchmarkRunner` 里位置参数风格一致。如果 typecheck 报参数数量不匹配，去 `node_modules/@kubernetes/client-node/dist/gen/api/coreV1Api.d.ts` 查准确签名后微调。

- [ ] **Step 4: 跑全套 test 确认零回归**

```bash
pnpm -F @modeldoctor/api test
```

Expected: 全 PASS。注意 BenchmarkModule 在测试里用 `overrideProvider(K8sBenchmarkRunner)` 替换；K8sJobWatcherService 也需要 override，否则 e2e 启动会真试图加载 K8s。在 e2e setup 里追加：

```ts
// 找 apps/api/test/setup/* 里组装 testing module 的地方
.overrideProvider(K8sJobWatcherService)
.useValue({
  onModuleInit: async () => undefined,
  onModuleDestroy: async () => undefined,
})
```

如果 e2e 失败，先 grep 找已有的 `overrideProvider(K8sBenchmarkRunner)`：

```bash
grep -rn "overrideProvider(K8sBenchmarkRunner)" apps/api
```

在同一处加一个对 `K8sJobWatcherService` 的 override。

- [ ] **Step 5: 跑 e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```

Expected: 全 PASS。

- [ ] **Step 6: commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.module.ts apps/api/test/
git commit -m "$(cat <<'EOF'
feat(api): wire K8sJobWatcherService into BenchmarkModule (refs #237)

Phase 1 default is K8S_WATCHER_MODE=off so dev / CI envs continue to skip
K8s entirely. Setting mode=backstop loads the kube config (same factory as
K8sBenchmarkRunner), builds an Informer over the benchmark namespace
selected by app.kubernetes.io/name=modeldoctor-run, and starts the watcher
+ reconciler.

E2E setup overrides the provider with a no-op stub (same pattern already
used for K8sBenchmarkRunner) so the test DB env doesn't try to talk to
a cluster.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: RBAC 文档

**Files:**
- Create or modify: `docs/operations/k8s-rbac.md`

- [ ] **Step 1: 看现有文档结构**

```bash
ls docs/operations/ 2>/dev/null || echo "dir not yet exists"
find docs -name "*rbac*" -o -name "*k8s*" -o -name "*deploy*" 2>/dev/null | head -10
```

- [ ] **Step 2: 创建/追加 RBAC 文档**

如果 `docs/operations/k8s-rbac.md` 不存在则新建；存在则在末尾追加新 section。

```markdown
## K8s RBAC for apps/api ServiceAccount

The api process needs RBAC permissions on the benchmark namespace
(default `modeldoctor-benchmarks`):

### Existing (Job lifecycle)

- `batch/jobs`: create, delete, patch
- `core/secrets`: create, delete, patch

### Added in Phase 1 (#237 — K8s watcher backstop)

- `core/pods`: **list, get, watch** — required by the Informer

### Reserved for Phase 3 (pod log streamer)

- `core/pods/log`: get — required by the per-pod log follower

### Sample ClusterRole

\`\`\`yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: modeldoctor-api
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "delete", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["list", "get", "watch"]
\`\`\`

Phase 1 deployments MUST update the role with the `pods` rule before
flipping `K8S_WATCHER_MODE` from `off` to `backstop`. Without it the
Informer will fail to list and the watcher will crash-loop logging RBAC
denials.
```

- [ ] **Step 3: commit**

```bash
git add docs/operations/k8s-rbac.md
git commit -m "$(cat <<'EOF'
docs(ops): K8s RBAC additions for watcher Phase 1 (refs #237)

Lists existing Job/Secret permissions and the new pods list/get/watch
required by the Informer. Phase 3 pods/log rule is noted as forthcoming.

Sample ClusterRole snippet included so operators can diff against their
current bindings.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Manual verification checklist + PR

**Files:** none (verification only)

- [ ] **Step 1: 全套 typecheck + lint + test 收尾**

```bash
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api test:e2e
```

Expected: 全 PASS。

- [ ] **Step 2: 跑 root build 确认其他包没被波及**

```bash
pnpm -r build
```

Expected: 0 errors。

- [ ] **Step 3: push 分支**

```bash
git push -u origin feat/watch-runner-status-phase-1
```

- [ ] **Step 4: 开 PR**

```bash
gh pr create --title "feat(api): K8s watcher backstop — Phase 1 of watch-based runner status" --body "$(cat <<'EOF'
## Summary

Phase 1 of #237 — adds a K8s pod Informer that runs as a **backstop** to
the existing callback path. Solves the two failure modes the callback
flow cannot:

- Pre-start failures (ImagePullBackOff / CrashLoopBackOff / …) — benchmark
  transitions to `failed` within `WAITING_FATAL_GRACE_SEC` (default 60s)
- Silent runner death (pod terminates without `/finish` reaching the API) —
  benchmark transitions to `failed` within `TERMINAL_RECONCILE_GRACE_SEC`
  (default 60s)

Callbacks (`/state`, `/log`, `/finish`) stay as the primary path. Runner
image is unchanged. Zero regression to normal completed/failed flows.

Default `K8S_WATCHER_MODE=off` — operators flip to `backstop` after
updating RBAC per `docs/operations/k8s-rbac.md`.

## Design

Full design spec committed in this PR:
`docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`

Key decisions:
- All status writes go through `BenchmarkRepository.updateGuarded()` so
  terminal benchmarks are never overwritten (spec §D5)
- Pure `PodStateReducer` with dense unit coverage of all pod.phase ×
  waiting.reason × benchmark.status combinations
- In-memory timing state (`firstFatalWaitingAt`, `firstTerminalAt`) lives
  on the watcher service; reducer is time-stateless

## Test plan

- [ ] CI green (type-check + lint + unit + e2e)
- [ ] Manual cluster test: create benchmark with `image: ghcr.io/typo:notreal`
      → benchmark transitions to `failed` within ~60s with statusMessage
      `ImagePullBackOff: ...`
- [ ] Manual cluster test: start normal benchmark, `kubectl delete pod -l
      modeldoctor.ai/run-id=<id>` mid-run → benchmark transitions to
      `failed` within ~60s
- [ ] Manual cluster test: restart api pod while a benchmark is `running` →
      StartupReconciler logs, benchmark either stays running (if pod still
      exists) or transitions to `failed` (if pod TTL'd away during downtime)
- [ ] Normal completed benchmark: zero regression — same final state via
      callback path, watcher never touches the row (guard rejects)

Refs #237, refs #189

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: PR follow-through (per CLAUDE.md)**

```bash
PR_NUM=$(gh pr view --json number -q .number)
gh pr view $PR_NUM --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks $PR_NUM
```

如果 CI 失败：定位失败原因 → 修复 → 新 commit（不要 amend）→ 重 push。

---

## Out of scope (Phase 2/3/4 — separate plans)

- ReportLoader 接共享存储
- 删除 callback controllers
- `/log` 替换为 PodLogStreamerPool
- runner 改造（停 POST，写存储）
- 共享存储层本身（独立 spec/PR，是 Phase 2 的硬依赖）

## Acceptance for Phase 1 (per spec §Phase 1 验收)

1. ✅ Image-typo benchmark → `failed` within 30s（手动 cluster 测试，见 PR test plan）
2. ✅ Manual `kubectl delete pod` → benchmark → `failed` within 60s（同上）
3. ✅ API restart → StartupReconciler runs, orphan IN_PROGRESS → `failed`（同上）
4. ✅ Normal flow zero regression（CI e2e suite）

## References

- Spec: `docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`
- Tracking issue: #237
- Roadmap umbrella: #189 P1
- 0.21 informer signature: `node_modules/@kubernetes/client-node/dist/informer.d.ts`
- Existing K8s wiring pattern: `apps/api/src/modules/benchmark/benchmark.module.ts:33-61`
- Pod label conventions: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts:11-14`
