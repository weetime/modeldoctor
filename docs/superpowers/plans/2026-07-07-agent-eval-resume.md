# Agent 评测断点续跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 tau3(τ³-bench)Agent 评测的长跑 Job 在 pod 死亡后不丢已完成 episodes:runner 定期把 tau3 的 `data/simulations/` 目录 checkpoint 到 MinIO,pod 死后 run 标 `interrupted`,用户手动「继续」→ 同 runId 重提交 Job(先删旧 Job)→ restore + `--auto-resume` 接着跑。

**Architecture:** 复用现有 K8s Job → MinIO 链路。新增能力全部 gated on `MD_CHECKPOINT_DIR`(由 `ToolAdapter.checkpointDir` 声明,仅 tau3 设),非 tau3 工具逐字不变。interrupted-vs-failed 由 S3-aware 的 reconciler 独断;informer 对可续 run 的 pod-Failed 只 defer(不写终止)。resume 是同 runId 重提交(删旧 Job + start(resume=true)),不新建行。

**Tech Stack:** Python 3.11(benchmark-runner,boto3/pytest/ruff)、TypeScript(tool-adapters/contracts/api NestJS/web React,vitest)、Prisma(**本特性零 migration** — status 是 String 列)。

**关联 spec:** `docs/superpowers/specs/2026-07-07-agent-eval-resume-design.md`(读它了解决策与理由)。Issue #350。

## Global Constraints

- **tau3-only,靠 gating**:唯一 source of truth 是 `ToolAdapter.checkpointDir?: string`(tau3=`"data/simulations"`,其余 undefined)。所有新逻辑仅当该值存在时激活;非可续工具的 manifest/reducer/status 路径**逐字不变**,必须有回归断言。
- **零 Prisma migration**:`Benchmark.status` 是 `String @default("pending")`(schema.prisma:139)。加 `"interrupted"` 只改 zod enum + 各消费点。禁止 migration。
- **storage_keys 双向镜像**:`apps/benchmark-runner/runner/storage_keys.py` 与 `packages/contracts/src/benchmark.ts:222` 的 `reportStorageKeys()` 必须同步(两文件都有 "Keep in sync" 注释)。checkpoint key 布局 = `<runId>/checkpoint/<相对路径>`。
- **result.json 是完成 sentinel**:任一 attempt 写出 `<runId>/result.json` 即"存储完成"→ reconciler 走 load-report。interrupted 只在**无 result.json** 时发生。
- **同 runId 重提交**:tau3 `--save-to <runId>_<domain>` 按 runId 命名 → 必须同 runId 才能让 restore 的目录被 `--auto-resume` 认出。resume 前**必须先删旧 Job**(Job 名固定 `run-<runId>`,creates 幂等吞 409,旧 Job 存活至 ttl=1h)。
- **commit 规约**:conventional prefix、显式 `git add <files>`(禁 `-A`)、body 末 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **runner 是 py3.11**;tau3 只在镜像(3.12)里,runner 测试不 import tau3 —— checkpoint/restore 逻辑对工具无感(只搬目录),测试用假目录即可。
- **vitest 配置文件在 apps/api 必须 `.mts`**;api tsconfig 不设 incremental。

## File Structure

**修改**
- `apps/benchmark-runner/runner/storage_keys.py` — 加 `checkpoint_prefix(run_id)`。
- `packages/contracts/src/benchmark.ts` — `reportStorageKeys()` 镜像加 checkpoint;`benchmarkStatusSchema` 加 `"interrupted"`。
- `apps/benchmark-runner/runner/s3_writer.py` — 加 `list_keys` + `download_prefix`。
- `apps/benchmark-runner/runner/main.py` — restore + checkpoint 线程 + final checkpoint(gated)。
- `packages/tool-adapters/src/core/interface.ts` — `ToolAdapter.checkpointDir?`。
- `packages/tool-adapters/src/tau3/runtime.ts` — 设 `checkpointDir`。
- `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts` — `BenchmarkRunInput.resume?`;start() 查 checkpointDir 传 opts;新增 `deleteRun(runId)`。
- `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts` — 注入 MD_CHECKPOINT_DIR/INTERVAL/RESUME。
- `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts` — execute() 对可续 run 的 failed-terminal defer。
- `apps/api/src/modules/benchmark/k8s/benchmark-reconciler.ts` — 两个 failed-no-result 点按可续改 interrupted。
- `apps/api/src/modules/benchmark/constants.ts` — TERMINAL_STATES 加 interrupted。
- `apps/api/src/modules/benchmark/resumable.ts`(新)— `isResumable(tool)` 共享 helper。
- `apps/api/src/modules/benchmark/benchmark.controller.ts` — `POST /:id/resume`。
- `apps/api/src/modules/benchmark/benchmark.service.ts` — `resume(id, ownerId?)`。
- `apps/web/src/features/benchmarks/{api.ts,queries.ts,status-display.tsx,BenchmarkDetailPage.tsx}` + i18n `benchmarks.json`(zh/en)。

---

## Task 1: checkpoint key 布局(storage_keys + TS 镜像)

**Files:**
- Modify: `apps/benchmark-runner/runner/storage_keys.py`
- Modify: `packages/contracts/src/benchmark.ts` (`reportStorageKeys()` ~L222-228)
- Test: `apps/benchmark-runner/tests/test_storage_keys.py`(已存在,追加)

**Interfaces:**
- Produces: `checkpoint_prefix(run_id: str) -> str` == `f"{run_id}/checkpoint/"`(注意末尾斜杠);TS 侧 `reportStorageKeys(runId).checkpointPrefix` 同值。

- [ ] **Step 1: 失败测试** — 追加到 `tests/test_storage_keys.py`:
```python
from runner.storage_keys import checkpoint_prefix
def test_checkpoint_prefix():
    assert checkpoint_prefix("run123") == "run123/checkpoint/"
```
- [ ] **Step 2: Run** `cd apps/benchmark-runner && uv run pytest tests/test_storage_keys.py -q` → FAIL(ImportError)。
- [ ] **Step 3: 实现** — 在 `storage_keys.py` `file_key` 旁加:
```python
def checkpoint_prefix(run_id: str) -> str:
    return f"{run_id}/checkpoint/"
```
- [ ] **Step 4: TS 镜像** — 在 `packages/contracts/src/benchmark.ts` 的 `reportStorageKeys()` 返回对象里加 `checkpointPrefix: \`${runId}/checkpoint/\``(与其它 key 同风格);保持 "Keep in sync" 注释准确。
- [ ] **Step 5: Run** pytest → PASS;`pnpm -F @modeldoctor/contracts build` → clean。
- [ ] **Step 6: Commit**
```bash
git add apps/benchmark-runner/runner/storage_keys.py packages/contracts/src/benchmark.ts apps/benchmark-runner/tests/test_storage_keys.py
git commit -m "feat(benchmark): checkpoint_prefix key layout (runner + contracts mirror)"
```

---

## Task 2: S3Writer 下载能力

**Files:**
- Modify: `apps/benchmark-runner/runner/s3_writer.py`(class `S3Writer`,L46-69）
- Test: `apps/benchmark-runner/tests/test_s3_writer.py`（已存在,追加）

**Interfaces:**
- Produces:
  - `S3Writer.list_keys(self, prefix: str) -> list[str]` — 分页列 `prefix` 下所有 object key。
  - `S3Writer.download_prefix(self, prefix: str, local_dir: str) -> int` — 把 `prefix` 下每个 object 下到 `local_dir/<key 去掉 prefix 的相对路径>`(重建子目录),返回下载文件数;`prefix` 不存在返回 0。

- [ ] **Step 1: 失败测试** — 用现有 test 的 boto3 stub/mock 风格(看文件头怎么造 client)。若用 `unittest.mock`:
```python
from unittest.mock import MagicMock
from runner.s3_writer import S3Writer

def test_list_keys_paginates():
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "run1/checkpoint/a.json"}]},
        {"Contents": [{"Key": "run1/checkpoint/d/b.json"}]},
    ]
    w = S3Writer(client=client, bucket="b")
    assert w.list_keys("run1/checkpoint/") == ["run1/checkpoint/a.json", "run1/checkpoint/d/b.json"]

def test_download_prefix_rebuilds_subdirs(tmp_path):
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "run1/checkpoint/x_air/results.json"}]},
    ]
    w = S3Writer(client=client, bucket="b")
    n = w.download_prefix("run1/checkpoint/", str(tmp_path))
    assert n == 1
    client.download_file.assert_called_once()
    # local path = tmp_path/x_air/results.json
    args = client.download_file.call_args[0]
    assert args[0] == "b" and args[1] == "run1/checkpoint/x_air/results.json"
    assert args[2].endswith("x_air/results.json")

def test_download_prefix_empty_returns_zero():
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [{}]  # no Contents
    assert S3Writer(client=client, bucket="b").download_prefix("nope/", "/tmp") == 0
```
- [ ] **Step 2: Run** `uv run pytest tests/test_s3_writer.py -q` → FAIL。
- [ ] **Step 3: 实现** — 加到 `S3Writer`(用 paginator 稳妥处理 >1000 objects;`self.client` 是 raw boto3 client):
```python
    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys

    def download_prefix(self, prefix: str, local_dir: str) -> int:
        import os
        count = 0
        for key in self.list_keys(prefix):
            rel = key[len(prefix):] if key.startswith(prefix) else key
            if not rel:  # the prefix "dir" placeholder object, if any
                continue
            dest = os.path.join(local_dir, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            self.client.download_file(self.bucket, key, dest)
            count += 1
        return count
```
- [ ] **Step 4: Run** pytest → PASS;`uv run ruff check runner/s3_writer.py tests/test_s3_writer.py` → clean。
- [ ] **Step 5: Commit**
```bash
git add apps/benchmark-runner/runner/s3_writer.py apps/benchmark-runner/tests/test_s3_writer.py
git commit -m "feat(benchmark-runner): S3Writer list_keys + download_prefix"
```

---

## Task 3: runner checkpoint 线程 + restore(gated)

**Files:**
- Modify: `apps/benchmark-runner/runner/main.py`（`main()` L271-350;新增一个 `_CheckpointUploader` 小类）
- Test: `apps/benchmark-runner/tests/test_checkpoint.py`（新）

**Interfaces:**
- Consumes: `S3Writer.download_prefix`/`put_file`(Task 2)、`checkpoint_prefix`(Task 1)。
- Produces:
  - `_checkpoint_dir_abs() -> str | None` — 读 `MD_CHECKPOINT_DIR`,解析成 `Path.cwd()/<dir>` 的绝对路径;未设返回 None。
  - `_upload_checkpoint_once(s3, run_id, dir_abs) -> None` — 遍历 `dir_abs` 下所有文件,`put_file(f"{checkpoint_prefix(run_id)}{rel}", full)`。
  - `class _CheckpointUploader(threading.Thread)` — `__init__(s3, run_id, dir_abs, interval)`;`run()` 每 `interval` 秒 `_upload_checkpoint_once`,直到 `stop()` set 的 `Event`;daemon。

- [ ] **Step 1: 失败测试** — `tests/test_checkpoint.py`(不 import tau3;纯目录搬运):
```python
import os
from unittest.mock import MagicMock
from runner.main import _upload_checkpoint_once, _CheckpointUploader

def test_upload_checkpoint_walks_dir(tmp_path):
    d = tmp_path / "data" / "simulations" / "run1_air"
    d.mkdir(parents=True)
    (d / "results.json").write_text("{}")
    s3 = MagicMock()
    _upload_checkpoint_once(s3, "run1", str(tmp_path / "data" / "simulations"))
    # uploaded under run1/checkpoint/run1_air/results.json
    key = s3.put_file.call_args[0][0]
    assert key == "run1/checkpoint/run1_air/results.json"

def test_uploader_thread_uploads_then_stops(tmp_path):
    (tmp_path / "f.json").write_text("{}")
    s3 = MagicMock()
    up = _CheckpointUploader(s3, "run1", str(tmp_path), interval=0.05)
    up.start()
    import time; time.sleep(0.12)
    up.stop(); up.join(timeout=1)
    assert s3.put_file.call_count >= 1
```
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 实现** — 在 `main.py` 顶部区加(用 `os.walk`,`threading.Event`):
```python
def _checkpoint_dir_abs() -> str | None:
    rel = os.environ.get("MD_CHECKPOINT_DIR")
    if not rel:
        return None
    return str(Path.cwd() / rel)

def _upload_checkpoint_once(s3: S3Writer, run_id: str, dir_abs: str) -> None:
    from runner.storage_keys import checkpoint_prefix
    if not os.path.isdir(dir_abs):
        return
    prefix = checkpoint_prefix(run_id)
    for root, _dirs, files in os.walk(dir_abs):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, dir_abs)
            s3.put_file(f"{prefix}{rel}", full)

class _CheckpointUploader(threading.Thread):
    def __init__(self, s3: S3Writer, run_id: str, dir_abs: str, interval: float):
        super().__init__(daemon=True)
        self._s3, self._run_id, self._dir, self._interval = s3, run_id, dir_abs, interval
        self._stop = threading.Event()
    def run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                _upload_checkpoint_once(self._s3, self._run_id, self._dir)
            except Exception as e:  # noqa: BLE001 - checkpoint is best-effort
                log.warning("checkpoint upload failed (will retry): %s", e)
    def stop(self) -> None:
        self._stop.set()
```
- [ ] **Step 4: 接线 main()** — 三处(全 gated on `_checkpoint_dir_abs()`):
  - **restore(L302 之前,Popen 之前)**:
    ```python
    ckpt_dir = _checkpoint_dir_abs()
    if ckpt_dir and os.environ.get("MD_RESUME") == "1":
        n = s3.download_prefix(f"{benchmark_id}/checkpoint/", ckpt_dir)
        log.info("restored %d checkpoint file(s) into %s", n, ckpt_dir)
    ```
  - **线程启动(L314 t1/t2.start() 之后)**:
    ```python
    uploader = None
    if ckpt_dir:
        interval = float(os.environ.get("MD_CHECKPOINT_INTERVAL_SEC", "60"))
        uploader = _CheckpointUploader(s3, benchmark_id, ckpt_dir, interval)
        uploader.start()
    ```
  - **收尾(L317 proc.wait() 之后、写 result.json L339 之前)**:
    ```python
    if uploader:
        uploader.stop(); uploader.join(timeout=10)
        _upload_checkpoint_once(s3, benchmark_id, ckpt_dir)  # final flush
    ```
- [ ] **Step 5: Run** `uv run pytest tests/test_checkpoint.py tests/test_main.py -q`(test_main 回归:MD_CHECKPOINT_DIR 未设时不激活)→ PASS;ruff clean。
- [ ] **Step 6: Commit**
```bash
git add apps/benchmark-runner/runner/main.py apps/benchmark-runner/tests/test_checkpoint.py
git commit -m "feat(benchmark-runner): periodic checkpoint upload + restore-on-resume (gated on MD_CHECKPOINT_DIR)"
```

---

## Task 4: ToolAdapter.checkpointDir + tau3 声明

**Files:**
- Modify: `packages/tool-adapters/src/core/interface.ts`（`ToolAdapter` L111-137)
- Modify: `packages/tool-adapters/src/tau3/runtime.ts`（`tau3Adapter` L8-25)
- Test: `packages/tool-adapters/src/tau3/runtime.spec.ts`（追加）

**Interfaces:**
- Produces: `ToolAdapter.checkpointDir?: string`;`tau3Adapter.checkpointDir === "data/simulations"`;其余适配器 undefined。

- [ ] **Step 1: 失败测试** — 追加到 `runtime.spec.ts`:
```ts
it("tau3 declares its checkpoint dir; others don't", () => {
  expect(tau3Adapter.checkpointDir).toBe("data/simulations");
});
```
再在 `packages/tool-adapters/src/scenarios.spec.ts`(或 registry spec)加:
```ts
import { allAdapters } from "./core/registry.js";
it("only tau3 declares checkpointDir", () => {
  for (const a of allAdapters()) {
    if (a.name === "tau3") expect(a.checkpointDir).toBe("data/simulations");
    else expect(a.checkpointDir).toBeUndefined();
  }
});
```
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/tool-adapters exec vitest run src/tau3/runtime.spec.ts` → FAIL。
- [ ] **Step 3: 实现** — `interface.ts` 在 readonly 字段块(L112-116)加,带 changelog 风格注释:
```ts
  /**
   * cwd-relative dir the tool writes RESUMABLE incremental state into. Presence
   * declares the tool supports 断点续跑: the runner checkpoints this dir to MinIO
   * periodically and restores it before the subprocess on resume. The dir name
   * must be stable across the SAME runId (tau3's --save-to <runId>_<domain>).
   * undefined = not resumable; all checkpoint/interrupted paths stay inert.
   * Deliberate interface evolution (see file-level contract comment).
   */
  readonly checkpointDir?: string;
```
`tau3/runtime.ts` 在 `tau3Adapter` 对象里加 `checkpointDir: "data/simulations",`。
- [ ] **Step 4: Run** `pnpm -F @modeldoctor/tool-adapters exec vitest run` → PASS;`pnpm -F @modeldoctor/tool-adapters build` → clean。
- [ ] **Step 5: Commit**
```bash
git add packages/tool-adapters/src/core/interface.ts packages/tool-adapters/src/tau3/runtime.ts packages/tool-adapters/src/tau3/runtime.spec.ts packages/tool-adapters/src/scenarios.spec.ts
git commit -m "feat(tool-adapters): ToolAdapter.checkpointDir; tau3 declares data/simulations"
```

---

## Task 5: Job manifest 注入 + runner start(resume) + deleteRun

**Files:**
- Modify: `packages/tool-adapters` 无;`apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts`（`BenchmarkRunInput` L16-21、`start()` L90-155;新增 `deleteRun`)
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`（env 数组 L66-70、`buildJobManifest` 签名 L65)
- Test: `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts`（新或追加）

**Interfaces:**
- Consumes: `byTool(tool).checkpointDir`(Task 4)。
- Produces:
  - `BenchmarkRunInput.resume?: boolean`。
  - `buildJobManifest(ctx, opts)`:`opts` 增 `checkpointDir?: string; checkpointIntervalSec?: number`。当 `opts.checkpointDir` 存在 → env push `MD_CHECKPOINT_DIR`=dir、`MD_CHECKPOINT_INTERVAL_SEC`=String(intervalSec ?? 60);当 `ctx.resume` → push `MD_RESUME`="1"。`backoffLimit`/`restartPolicy` 不变。
  - `K8sBenchmarkRunner.deleteRun(runId): Promise<void>` — 前台删除 Job `run-<runId>`(cascade → pods + per-run Secret via ownerRef);404 视为已删(幂等)。
  - `start(ctx)`:计算 `checkpointDir = byTool(ctx.tool).checkpointDir`,`buildJobManifest(ctx, { namespace, hf, checkpointDir, checkpointIntervalSec: this.checkpointIntervalSec })`。

- [ ] **Step 1: 失败测试** — `k8s-job-manifest.spec.ts`:
```ts
import { buildJobManifest } from "./k8s-job-manifest.js";
const base = { runId: "r1", tool: "tau3", image: "img",
  buildResult: { argv: ["tau2","run"], env: {}, secretEnv: {}, outputFiles: {} } } as any;
function envOf(job: any) {
  const e = job.spec.template.spec.containers[0].env as {name:string;value:string}[];
  return Object.fromEntries(e.map(x => [x.name, x.value]));
}
it("injects checkpoint env when opts.checkpointDir set", () => {
  const j = buildJobManifest(base, { namespace: "ns", checkpointDir: "data/simulations", checkpointIntervalSec: 60 });
  const env = envOf(j);
  expect(env.MD_CHECKPOINT_DIR).toBe("data/simulations");
  expect(env.MD_CHECKPOINT_INTERVAL_SEC).toBe("60");
  expect(env.MD_RESUME).toBeUndefined();
});
it("adds MD_RESUME=1 only when ctx.resume", () => {
  const j = buildJobManifest({ ...base, resume: true }, { namespace: "ns", checkpointDir: "data/simulations" });
  expect(envOf(j).MD_RESUME).toBe("1");
});
it("no checkpoint env when checkpointDir absent (non-resumable tool unchanged)", () => {
  const env = envOf(buildJobManifest(base, { namespace: "ns" }));
  expect(env.MD_CHECKPOINT_DIR).toBeUndefined();
  expect(env.MD_RESUME).toBeUndefined();
});
```
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark/k8s/k8s-job-manifest.spec.ts` → FAIL。
- [ ] **Step 3: 实现 manifest** — `JobManifestOptions` 加 `checkpointDir?: string; checkpointIntervalSec?: number;`;`BenchmarkRunInput` 加 `resume?: boolean;`;env 数组 L70 之后:
```ts
  if (opts.checkpointDir) {
    env.push({ name: "MD_CHECKPOINT_DIR", value: opts.checkpointDir });
    env.push({ name: "MD_CHECKPOINT_INTERVAL_SEC", value: String(opts.checkpointIntervalSec ?? 60) });
    if (ctx.resume) env.push({ name: "MD_RESUME", value: "1" });
  }
```
- [ ] **Step 4: 实现 runner** — `k8s-benchmark-runner.ts`:ctor 增 `checkpointIntervalSec`(从 config,默认 60,像 hf 那样注入);`start()` L101 改为
```ts
  const checkpointDir = byTool(ctx.tool).checkpointDir;
  const job = buildJobManifest(ctx, { namespace: ns, hf: this.hf, checkpointDir, checkpointIntervalSec: this.checkpointIntervalSec });
```
加 `deleteRun`(用 batch api 前台删 Job;参考 cancel 现有删除调用的 error 处理,404 吞掉):
```ts
  async deleteRun(runId: string): Promise<void> {
    const ns = this.namespace;
    await this.withRetry("deleteNamespacedJob", () =>
      this.batch.deleteNamespacedJob(jobName(runId), ns, undefined, undefined, undefined, undefined, "Foreground"),
      { idempotent: true }); // idempotent swallows 404 (already gone)
  }
```
（`jobName` 从 `k8s-job-manifest.ts` 导入;确认 deleteNamespacedJob 的实参顺序对齐你项目的 @kubernetes/client-node 版本 —— 实现时核对签名。）
- [ ] **Step 5: Run** manifest spec → PASS;`pnpm -F @modeldoctor/api build`(需先 `pnpm -r build` 让 tool-adapters dist 有 checkpointDir)→ clean。
- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts
git commit -m "feat(api): inject checkpoint env into Job; runner resume flag + deleteRun"
```

---

## Task 6: interrupted 状态 + reducer defer + reconciler 判定

**Files:**
- Modify: `packages/contracts/src/benchmark.ts`（`benchmarkStatusSchema` L20-27)
- Modify: `apps/api/src/modules/benchmark/constants.ts`（TERMINAL_STATES)
- Create: `apps/api/src/modules/benchmark/resumable.ts`（`isResumable`)
- Modify: `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`（execute() failed-terminal defer)
- Modify: `apps/api/src/modules/benchmark/k8s/benchmark-reconciler.ts`（两个 failed-no-result 点)
- Test: `apps/api/src/modules/benchmark/benchmark-reconciler.spec.ts`（追加）+ `resumable.spec.ts`（新）

**Interfaces:**
- Produces:
  - `benchmarkStatusSchema` 含 `"interrupted"`;`TERMINAL_STATES` 含 `"interrupted"`。
  - `isResumable(tool: string): boolean` == `byTool(tool as ToolName).checkpointDir != null`(未知 tool → false,不抛)。
  - reconciler:可续 run + 终止/孤儿 + 无 result.json → status `"interrupted"`(无 completedAt);非可续 → `"failed"`(不变)。
  - watcher execute():`case "failed-terminal"` 若 `isResumable(bench.tool)` → 不写 failed(defer 给 reconciler),否则不变。

- [ ] **Step 1: 失败测试** — `resumable.spec.ts`:
```ts
import { isResumable } from "./resumable.js";
it("tau3 resumable, guidellm not, unknown false", () => {
  expect(isResumable("tau3")).toBe(true);
  expect(isResumable("guidellm")).toBe(false);
  expect(isResumable("nope")).toBe(false);
});
```
在 `benchmark-reconciler.spec.ts` 加(mirror 现有 reconciler 测试的 mock 风格):一个 tau3 run,pod 终止无 result.json → `repo.updateGuarded` 被以 `status:"interrupted"`(无 completedAt)调用;一个 guidellm 同场景 → `status:"failed"`(回归)。
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 实现**
  - `benchmark.ts`:enum 加 `"interrupted"`。
  - `constants.ts`:`TERMINAL_STATES` 数组加 `"interrupted"`(保持 IN_PROGRESS_STATES 不含它 → reconciler 不再轮询已 interrupted 的 run)。
  - `resumable.ts`:
    ```ts
    import { byTool, type ToolName } from "@modeldoctor/tool-adapters";
    export function isResumable(tool: string): boolean {
      try { return byTool(tool as ToolName).checkpointDir != null; } catch { return false; }
    }
    ```
  - reconciler 两处 `updateGuarded(..., { status: "failed", ... completedAt })` → 
    ```ts
    const status = isResumable(b.tool) ? "interrupted" : "failed";
    const updated = await this.deps.repo.updateGuarded(b.id, IN_PROGRESS_STATES,
      status === "interrupted" ? { status, statusMessage: msg } : { status, statusMessage: msg, completedAt: new Date() });
    ```
    (interrupted 不设 completedAt —— 它不是终结,可 resume。)
  - watcher `execute()` `case "failed-terminal"`:开头加
    ```ts
    if (isResumable(bench.tool)) { this.log.log(`${runId} pod failed but resumable — deferring to reconciler`); return; }
    ```
    (需把 `bench`(或 `bench.tool`)传进 execute();现签名 `execute(runId, transition, now)` → 改 `execute(runId, transition, now, tool)`,调用点 L213 传 `bench.tool`。)
- [ ] **Step 4: Run** `pnpm -F @modeldoctor/api exec vitest run src/modules/benchmark` → PASS;`pnpm -F @modeldoctor/api build` → clean。
- [ ] **Step 5: Commit**
```bash
git add packages/contracts/src/benchmark.ts apps/api/src/modules/benchmark/constants.ts apps/api/src/modules/benchmark/resumable.ts apps/api/src/modules/benchmark/resumable.spec.ts apps/api/src/modules/benchmark/k8s/benchmark-reconciler.ts apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts apps/api/src/modules/benchmark/benchmark-reconciler.spec.ts
git commit -m "feat(api): interrupted status — reconciler marks resumable runs interrupted, informer defers"
```

---

## Task 7: resume endpoint(delete old Job → start(resume),guarded)

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.controller.ts`（mirror cancel L109-113)
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`（新 `resume()`;`start()` 支持 resume 透传)
- Test: `apps/api/src/modules/benchmark/benchmark.service.spec.ts`（追加）

**Interfaces:**
- Consumes: `runner.deleteRun`(Task 5)、`isResumable`(Task 6)、`updateGuarded`(guard `["interrupted"]`)。
- Produces: `POST /benchmarks/:id/resume` → `service.resume(id, ownerId?)`:校验 `status==="interrupted"` 且 `isResumable(tool)`,否则 `BadRequestException`;`updateGuarded(id, ["interrupted"], { status: "pending", statusMessage: null, completedAt: null })`(CAS,防并发双 resume)→ `runner.deleteRun(id)` → `start(id, { resume: true })`。`start()` 增可选 `opts?: { resume?: boolean }` 透传到 `runner.start({..., resume: opts?.resume })`。

- [ ] **Step 1: 失败测试** — `benchmark.service.spec.ts`:
```ts
it("resume: interrupted tau3 → deletes old job then starts with resume=true", async () => {
  repo.findById.mockResolvedValue({ id: "r1", status: "interrupted", tool: "tau3", userId: "u", connectionId: "c", params: {}, scenario: "agent" });
  repo.updateGuarded.mockResolvedValue({ id: "r1" }); // CAS ok
  // ...mock connections/runner as in start() tests...
  await service.resume("r1", "u");
  expect(runner.deleteRun).toHaveBeenCalledWith("r1");
  expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ runId: "r1", resume: true }));
});
it("resume: non-interrupted → BadRequest, no delete", async () => {
  repo.findById.mockResolvedValue({ id: "r1", status: "failed", tool: "tau3", userId: "u", connectionId: "c" });
  await expect(service.resume("r1", "u")).rejects.toThrow(BadRequestException);
  expect(runner.deleteRun).not.toHaveBeenCalled();
});
it("resume: CAS loss (already resumed) → BadRequest", async () => {
  repo.findById.mockResolvedValue({ id: "r1", status: "interrupted", tool: "tau3", userId: "u", connectionId: "c" });
  repo.updateGuarded.mockResolvedValue(null); // lost the race
  await expect(service.resume("r1", "u")).rejects.toThrow();
  expect(runner.deleteRun).not.toHaveBeenCalled();
});
```
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 实现**
  - controller(mirror cancel):
    ```ts
    @Post(":id/resume")
    resume(@CurrentUser() user: JwtPayload, @Param("id") id: string): Promise<Benchmark> {
      return this.service.resume(id, user.roles.includes("admin") ? undefined : user.sub);
    }
    ```
  - service:
    ```ts
    async resume(benchmarkId: string, ownerId?: string): Promise<Benchmark> {
      const row = await this.repo.findById(benchmarkId);
      if (ownerId && row.userId !== ownerId) throw new NotFoundException(...); // mirror cancel ownership
      if (row.status !== "interrupted" || !isResumable(row.tool))
        throw new BadRequestException({ code: "BENCHMARK_NOT_RESUMABLE", message: "该评测不可续跑(需 interrupted 且工具支持)" });
      const claimed = await this.repo.updateGuarded(row.id, ["interrupted"], { status: "pending", statusMessage: null, completedAt: null });
      if (!claimed) throw new BadRequestException({ code: "BENCHMARK_RESUME_CONFLICT", message: "已在续跑中" });
      await this.runner.deleteRun(row.id); // remove the dead Job so start() won't 409
      return this.start(row.id, { resume: true });
    }
    ```
  - `start(benchmarkId: string, opts?: { resume?: boolean })`:`runner.start({ ..., resume: opts?.resume })`。
- [ ] **Step 4: Run** service spec → PASS;`pnpm -F @modeldoctor/api build` → clean。
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/benchmark/benchmark.controller.ts apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "feat(api): POST /benchmarks/:id/resume — delete dead Job then start(resume)"
```

---

## Task 8: web —「继续」按钮 + interrupted 状态显示

**Files:**
- Modify: `apps/web/src/features/benchmarks/api.ts`（L30-41 `benchmarkApi`)
- Modify: `apps/web/src/features/benchmarks/queries.ts`（`isTerminalStatus` L20、新 `useResumeBenchmark` mirror `useCancelBenchmark` L65)
- Modify: `apps/web/src/features/benchmarks/status-display.tsx`（`STATUS_DISPLAY` exhaustive record L27-58)
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`（rightSlot L421-472)
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`（`status.interrupted` + 按钮文案）
- Test: `apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx`（追加)

**Interfaces:**
- Consumes: `POST /api/benchmarks/:id/resume`(Task 7)。
- Produces: interrupted run 显示「继续」按钮,点击调 resume 并 invalidate detail+lists;`isTerminalStatus("interrupted")===true`;`STATUS_DISPLAY.interrupted` 有条目(琥珀色)。

- [ ] **Step 1: 失败测试** — render detail page,`benchmark.status==="interrupted"` → 有「继续」按钮且点击调 `benchmarkApi.resume`;`status==="completed"` → 无该按钮。(mirror 现有 rerun/cancel 测试的 mock 方式。)
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/web exec vitest run src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx` → FAIL。
- [ ] **Step 3: 实现**
  - `api.ts`:`resume: (id: string) => api.post<Benchmark>(\`/api/benchmarks/${id}/resume\`, {}),`。
  - `queries.ts`:`isTerminalStatus` 加 `|| status === "interrupted"`;`useResumeBenchmark`(mirror cancel,invalidate detail+lists,停留同 id)。
  - `status-display.tsx`:`STATUS_DISPLAY` 加 `interrupted: { icon: <琥珀 icon>, className: "...amber..." }`(参考 canceled 的 muted 变体,换琥珀/warning 色)。
  - `BenchmarkDetailPage.tsx` rightSlot:加
    ```tsx
    {benchmark.status === "interrupted" && (
      <Button onClick={() => resumeBenchmark.mutate(benchmark.id)} disabled={resumeBenchmark.isPending}>
        {t("detail.resume.button")}
      </Button>
    )}
    ```
  - i18n:`status.interrupted`="已中断"/"Interrupted";`detail.resume.button`="继续"/"Resume"。
- [ ] **Step 4: Run** test → PASS;`pnpm -F @modeldoctor/web exec tsc --noEmit` → 0 errors(STATUS_DISPLAY exhaustive 会强制 interrupted 有条目);`pnpm -F @modeldoctor/web build` → clean。
- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/benchmarks/api.ts apps/web/src/features/benchmarks/queries.ts apps/web/src/features/benchmarks/status-display.tsx apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json apps/web/src/features/benchmarks/__tests__/BenchmarkDetailPage.test.tsx
git commit -m "feat(web): interrupted status + 继续/resume button"
```

---

## Task 9: 手动端到端冒烟(验证)

**Files:** none(verification;用 verify skill)。

**Precondition:** 集群 + tau3 镜像(`RUNNER_IMAGE_TAU3`)+ 支持 tool-calling 的 Connection + 默认 judge provider(同 τ³ Task 15 runbook)。

- [ ] **Step 1:** 从 UI 建一个 Agent 冒烟(或稍大)run,跑起来。
- [ ] **Step 2:** 跑到中途(已有 ≥1 个 domain 写了 results.json),`kubectl delete pod <run pod>` 模拟 eviction。
- [ ] **Step 3:** 确认 run 变 `interrupted`(不是 failed);MinIO `<runId>/checkpoint/` 下有已完成 domain 的 results.json。
- [ ] **Step 4:** UI 点「继续」→ 确认旧 Job 被删、新 Job 起、pod 日志显示 "restored N checkpoint file(s)" + tau3 `--auto-resume` 跳过已完成 episodes。
- [ ] **Step 5:** 跑完 → `completed`,报告的 tasks 数 = 全量(无重复、无丢失)。对比:直接一次跑完的同档 summary,overall.tasks 一致。
- [ ] **Step 6:** 回归:一个 guidellm run 杀 pod → 仍 `failed`(非 interrupted),证明 gating 生效。

记录结果;不 commit。

---

## Self-Review

**1. Spec coverage:** §4.1 checkpointDir → T4;§4.2 manifest → T5;§4.3 s3_writer 下载 → T2;§4.4 runner 线程/restore → T3(+T1 key);§4.5 interrupted → T6;§4.6 resume → T7 + web T8;§4.7 报告零改动 → 无任务(正确,summarizer 不变)。§5 失败边界:幂等 resume(T7 CAS)、checkpoint 上传失败重试(T3 try/except)、非可续零变更(T5/T6 回归断言)。§7 测试 → 各任务 TDD + T9 e2e。§8 落地顺序 = T1..T9。**无缺口。**

**2. Placeholder scan:** 无 TBD/TODO。两处"实现时核对"(T5 deleteNamespacedJob 实参顺序、T3 log 变量)是对具名 API 的核对指令,非占位。

**3. Type consistency:** `checkpointDir`(T4)↔ `byTool(tool).checkpointDir`(T5 runner、T6 isResumable)一致;`MD_CHECKPOINT_DIR`/`MD_CHECKPOINT_INTERVAL_SEC`/`MD_RESUME` env 名在 T5(manifest 写)↔ T3(runner 读)一致;`checkpoint_prefix`=`<runId>/checkpoint/`(T1)↔ T3 上传 key ↔ T3 restore download_prefix 一致;`"interrupted"` 状态值在 T6(enum/constants/reconciler)↔ T7(guard)↔ T8(web)一致;`BenchmarkRunInput.resume`(T5)↔ `ctx.resume`(manifest)↔ `start(id,{resume})`(T7)一致;`isResumable`(T6)↔ T7 复用一致。

**Gaps closed:** interrupted-vs-failed 只在 reconciler(S3-aware)独断,informer defer(T6)—— 避免 informer 无 result.json 信息时误判。resume 先 `deleteRun`(T5/T7)—— 解决 Job 名固定 + 幂等吞 409 导致重提交不生效的坑。
