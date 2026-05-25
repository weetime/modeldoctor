# Report shared storage + watcher primary mode — Phase 0+2 合并：彻底重写 runner→API 通道

**Status:** draft · 2026-05-25
**Scope:** `apps/api` benchmark module + `apps/benchmark-runner`
**Tracks:** [#237](https://github.com/weetime/modeldoctor/issues/237) Phase 0 + Phase 2（合并实施）
**Builds on:** [Phase 1 watcher backstop](./2026-05-25-watch-based-runner-status-design.md)（已落地，[PR #238](https://github.com/weetime/modeldoctor/pull/238)）
**Out of scope:** `/log` 通道、`PodLogStreamerPool`、删 `HmacCallbackGuard` —— 留 Phase 3

## Goal

把 runner→API 的 **状态翻转**（`running` / `completed` / `failed`）和 **终态报告**（`summaryMetrics` / `rawOutput` / `toolVersion`）从 push (HTTP callback) 改成 pull (K8s informer + S3 共享存储)：

- 状态：API informer 看到 `pod.phase=Succeeded` 直接触发 `ReportLoader`；看到 `Failed` 直接写 `failed`
- 报告 + toolVersion：runner 把 `meta.json` / `result.json` / `stdout.log` / `stderr.log` / `files/*` 写到 S3，API 在终态时读
- runner 从此对 state/finish 这两条 callback **零依赖** —— 也不再装 deprecated no-op 兜底；`/log` 通道暂留给 Phase 3 处理

口径：**彻底重写**，不留 deprecated endpoint，不双写，不带技术债。

## Why this shape

Phase 1 已把 watcher backstop 装好（`K8sJobWatcherService` + `PodStateReducer` + `StartupReconciler` + `BenchmarkRepository.updateGuarded()`），底座齐了。Phase 2 = 在底座上加：

1. `S3ReportStorage` —— 唯一的报告/输出文件载体
2. `ReportLoader` —— 把 storage 数据翻译成 benchmark 行更新
3. `PodStateReducer` 扩 primary 模式 —— `running` / `load-report` 两条新 transition
4. runner 改 —— `boto3` 直写 S3，删 `post_state_running` / `post_finish`

`/log` 暂留是 Phase 3 决定：log streaming 用 `Log.log(follow:true)` 是另一摊事，跟 status flip 解耦能简化本 PR 范围。

Phase 1 spec 的 "Phase 0 储存层 独立 spec" 决议在本 spec 合并 —— 因为 `ReportStorage` 接口和 `ReportLoader` 紧耦合，独立 PR 反而要先 freeze 接口再回头改，多走一步没意义。

## Non-goals

- **不动 `/log` 通道**：`benchmarkLogCallbackSchema`、`HmacCallbackGuard`、`BenchmarkCallbackController.handleLog` 全部保留；runner 仍然 POST `/log`。
- **不引入 `'loading-report'` 中间状态**：保 status 枚举稳定（schema、前端、contracts 不动）。靠 reducer 的 currentStatus 守卫 + `try/finally` 防泄漏。
- **不做 TTL janitor**：MinIO bucket lifecycle 一次性配（`mc ilm rule add --expire-days 30 myminio/<bucket>`），不进代码。
- **不做 per-runId IAM scoping / presigned URL / STS**：单 K8s Secret + bucket-policy-pseudo 隔离即可，V1 不为这投资。
- **不做 multi-replica API**：informer 仍单进程；HA 留 ESM Phase 2 + 1.x + leader election。
- **不动 SSE 协议**：前端零改动。
- **不动 cancel API**：`BenchmarkService.cancel()` 路径不变。

## Architecture

### 通道形态对比

| 信号 | Phase 1 之后 (callback primary + watcher backstop) | 本 spec 之后 (watcher primary + S3) |
|---|---|---|
| 状态 `running` | runner POST `/state` | informer: `pod.phase=Running` + container ready |
| 状态 `completed` | runner POST `/finish state=completed` | informer: `pod.phase=Succeeded` → `ReportLoader.tryLoad()` → parse OK |
| 状态 `failed`（工具非零退出） | runner POST `/finish state=failed` | informer: `pod.phase=Failed` |
| 状态 `failed`（pre-start） | watcher backstop（grace 60s） | watcher（grace 不变） |
| 状态 `failed`（runner 静默挂） | watcher backstop（grace 60s） | watcher（grace 不变） |
| `statusMessage` | runner 自填 / watcher backstop 拼 | watcher 拼 `terminated.{exitCode,reason,message}`；ReportLoader 拼 storage 异常 |
| `startedAt` / `completedAt` | runner POST 时刻 | informer 事件时刻（pod condition transition time） |
| `toolVersion` | runner POST `/state` | runner 写 `meta.json` → ReportLoader 读 |
| live SSE log + `progress%` | runner POST `/log` 批量 | **不变**（Phase 3 才改） |
| `summaryMetrics` + `rawOutput` | runner POST `/finish` | runner 写 `result.json` + `files/*` → ReportLoader 读 |

### 组件图

```
              ┌─────────────────────────────────────────┐
              │            apps/api (single)            │
              │                                         │
              │  K8sJobWatcherService (singleton)       │
              │   mode = primary                        │
              │    │                                    │
              │    ▼                                    │
              │  PodStateReducer (pure)                 │
              │    primary transitions:                 │
              │      running | load-report |            │
              │      failed-pre-start | failed-terminal │
              │    │                                    │
              │    ▼                                    │
              │  ┌──────────────┐ ┌──────────────────┐  │
              │  │ updateGuarded│ │ ReportLoader     │  │
              │  │ (running /   │ │  tryLoad(runId)  │  │
              │  │  failed)     │ │   → S3ReportStor.│  │
              │  └──────────────┘ │   → byTool.parse │  │
              │                   │   → updateGuarded│  │
              │  StartupReconciler│   (completed |   │  │
              │   storage > pod   │    failed)       │  │
              │   > fail          └──────────────────┘  │
              └─────────────────────────────┬───────────┘
                                            │
                                            ▼
                                ┌───────────────────────┐
                                │ S3-compat (MinIO/AWS) │
                                │  <bucket>/<runId>/...  │
                                └───────────────────────┘
                                            ▲
                                            │  boto3
                  ┌─────────────────────────┴───────────┐
                  │  benchmark-runner pod (per Job)     │
                  │   1. detect_tool_version → meta.json│
                  │   2. spawn tool subprocess          │
                  │   3. drain stdout/stderr            │
                  │      → POST /log (Phase 3 改)       │
                  │      → append local files           │
                  │   4. on exit: write result.json +   │
                  │      files/<alias> +                │
                  │      stdout.log / stderr.log        │
                  │   5. exit 0 if all writes OK        │
                  │      else raise → exit non-zero     │
                  └─────────────────────────────────────┘
```

### State machine（写权重新定义）

**核心规则不变**：`benchmark.status` 只能 forward；所有写者走 `BenchmarkRepository.updateGuarded()`。

| 写者 | 触发 | 目标 status | 附带写 |
|---|---|---|---|
| `BenchmarkService.submit()` | 用户创建 | `submitted` | — |
| `K8sBenchmarkRunner.start()` | 投递 Job | (仍 `submitted`) | `runHandle` |
| **Informer** (primary) | `pod.phase=Running` && container ready | `running` | `startedAt` |
| **Informer** (primary) | `pod.phase=Failed` | `failed` | `statusMessage`, `completedAt` |
| **Informer → ReportLoader** | `pod.phase=Succeeded` | (触发 ReportLoader) | — |
| **ReportLoader** | parse OK | `completed` | `summaryMetrics`, `rawOutput`, `toolVersion`, `completedAt` |
| **ReportLoader** | storage / parse 异常 | `failed` | `statusMessage="report load: ..."`, `completedAt` |
| **Informer** (FATAL waiting) | `waiting.reason ∈ FATAL_WAITING_REASONS` 过 60s grace | `failed` | `statusMessage`, `completedAt` |
| `BenchmarkService.cancel()` | 用户取消 | `cancelled` | `completedAt` |
| **StartupReconciler** | storage 有 `<id>/result.json` | 走 ReportLoader 同路径 | 同上 |
| **StartupReconciler** | storage 无 + pod 存在 | 不动（等 informer） | — |
| **StartupReconciler** | storage 无 + pod 不在 | `failed` | `statusMessage="pod gone before reconcile"` |

`/log` 通道**不写 status**（它今天也不写 status，纯流日志 + progress%）。

`FATAL_WAITING_REASONS` 与 Phase 1 一致。`WAITING_FATAL_GRACE_SEC=60` 与 Phase 1 一致。

`TERMINAL_RECONCILE_GRACE_SEC`（Phase 1 backstop 用）在 primary 模式下**不参与判定** —— terminal phase 直接动作，不等 grace。backstop 模式保留 grace 作 ops 降级用。

## Storage 层设计

### Key 约定（contracts 共享）

```ts
// packages/contracts/src/benchmark/storage-keys.ts
export const reportStorageKeys = (runId: string) => ({
  meta: `${runId}/meta.json`,
  result: `${runId}/result.json`,
  stdout: `${runId}/stdout.log`,
  stderr: `${runId}/stderr.log`,
  file: (alias: string) => `${runId}/files/${alias}`,
});
```

runner 和 API 都从这个模块导入（runner Python 端复制一份常量到 `runner/storage_keys.py`，CI 加一行测试断言两边 prefix 一致）。

### `meta.json` schema

```json
{
  "toolVersion": "guidellm 0.2.1",
  "startTimeIso": "2026-05-25T01:23:45.678Z"
}
```

runner 在 `detect_tool_version()` 完成后**立即**写。

### `result.json` schema

```json
{
  "exitCode": 0,
  "finishTimeIso": "2026-05-25T01:33:21.456Z",
  "files": {
    "report-json": "files/report.json",
    "report-html": "files/report.html"
  }
}
```

`files` 是 alias → relative-path 的映射（相对于 `<runId>/`）。具体 alias 由各 tool adapter 在 runner 端约定（沿用现有 `outputFiles` 接口，但路径从 inline base64 改成 storage relative path）。

### `ReportStorage` 接口（API 侧）

```ts
// apps/api/src/modules/benchmark/storage/report-storage.ts
export interface ReportStorage {
  exists(key: string): Promise<boolean>;
  readJson<T>(key: string): Promise<T>;
  readText(key: string): Promise<string>;
  readBytes(key: string): Promise<Buffer>;
}
```

API 侧只读，不暴露 write —— runner 不通过 API 写 S3。

### `S3ReportStorage` 实现要点

```ts
// apps/api/src/modules/benchmark/storage/s3-report-storage.ts
@Injectable()
export class S3ReportStorage implements ReportStorage {
  private readonly client: S3Client;
  constructor(@Inject(ENV) env: Env) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? "us-east-1",
      forcePathStyle: true,           // MinIO 必需
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
      maxAttempts: 2,                 // 1 retry (默认 3 太多)
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5_000,
        socketTimeout: 30_000,
      }),
    });
    this.bucket = env.S3_BUCKET;
  }
  // exists: HeadObjectCommand → NotFound 返 false, 其他抛
  // readJson/Text/Bytes: GetObjectCommand → 流转 buffer → 解析
}
```

### Env schema 新增

```ts
// apps/api/src/config/env.schema.ts
S3_ENDPOINT: z.string().url(),
S3_ACCESS_KEY: z.string().min(1),
S3_SECRET_KEY: z.string().min(1),
S3_BUCKET: z.string().min(1),
S3_REGION: z.string().default("us-east-1"),
K8S_WATCHER_MODE: z.enum(["off", "backstop", "primary"]).default("primary"),
// 测试 fixtures 显式覆盖成 "off" / "backstop"
```

### MinIO Secret（运维一次性创建）

```bash
kubectl -n modeldoctor-benchmarks create secret generic md-benchmark-storage \
  --from-literal=S3_ENDPOINT=http://10.100.121.67:31871 \
  --from-literal=S3_ACCESS_KEY=<key> \
  --from-literal=S3_SECRET_KEY=<secret> \
  --from-literal=S3_BUCKET=weetime \
  --from-literal=S3_REGION=us-east-1
# 同一份在 API 所在 namespace 也复制一份（如果不同 ns）
```

Bucket lifecycle（一次性，运维侧）：

```bash
mc ilm rule add --expire-days 30 myminio/weetime
```

## PodStateReducer 改造

```ts
// apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts (扩展)
export type DesiredTransition =
  | { kind: "running"; startedAt: Date }
  | { kind: "load-report" }
  | { kind: "failed-pre-start"; reason: string; message: string }
  | { kind: "failed-terminal"; exitCode: number; reason: string; message: string }
  | { kind: "noop" };

export interface ReducerInput {
  pod: V1Pod;
  currentStatus: string;
  firstFatalWaitingAt: Date | null;
  firstTerminalAt: Date | null;
  now: Date;
  config: ReducerConfig;
  mode: WatcherMode;     // 新增
}
```

primary 分支判定优先级（reducer 内部）：
1. `currentStatus` 不是 IN_PROGRESS → `noop`
2. `phase=Succeeded` → `load-report`
3. `phase=Failed` → `failed-terminal`（statusMessage 从 `terminated.{reason,message}` 拼）
4. `phase=Pending` 且 FATAL waiting 过 grace → `failed-pre-start`
5. `phase=Running` && `containerStatuses[0].ready` && `currentStatus='submitted'` → `running`（startedAt = `now`，或更准是 `containerStatuses[0].state.running.startedAt`）
6. otherwise → `noop`

backstop 分支保留 Phase 1 现状不动 —— ops 降级用。

`mode` 参数让一份纯函数承载两种行为，单测两条独立 case 矩阵。

## Watcher service 改造

`K8sJobWatcherService.onModuleInit()` 把 "`primary` throws not yet implemented" 那行去掉。其他主路径基本不变 —— event handler 拿到 reducer 输出后 switch on `kind`：

```ts
// 注意 updateGuarded(id, allowedStatuses, input) 的参数顺序
switch (transition.kind) {
  case "running":
    await this.repo.updateGuarded(runId, ["submitted"], { status: "running", startedAt: transition.startedAt });
    break;
  case "load-report":
    void this.reportLoader.tryLoad(runId);  // fire-and-forget；内部自带错误处理
    break;
  case "failed-pre-start":
  case "failed-terminal":
    await this.repo.updateGuarded(runId, IN_PROGRESS_STATES, { status: "failed", statusMessage: ..., completedAt: now });
    break;
  case "noop":
    break;
}
```

`load-report` 用 `void` 是因为 informer event handler 是同步收事件队列，ReportLoader 内部可能 30s S3 timeout，不能阻住 handler。`tryLoad` 内部一定要 `try/catch finally` 兜底，**不能向外抛**。

## ReportLoader 行为

```ts
// apps/api/src/modules/benchmark/storage/report-loader.ts
@Injectable()
export class ReportLoader {
  async tryLoad(runId: string): Promise<void> {
    const bench = await this.repo.findById(runId);
    if (!bench || !IN_PROGRESS_STATES.includes(bench.status)) return;
    try {
      const keys = reportStorageKeys(runId);
      const [meta, result, stdout, stderr] = await Promise.all([
        this.storage.readJson<{ toolVersion: string; startTimeIso: string }>(keys.meta),
        this.storage.readJson<{ exitCode: number; finishTimeIso: string; files: Record<string, string> }>(keys.result),
        this.storage.readText(keys.stdout),
        this.storage.readText(keys.stderr),
      ]);
      const files = await this.loadOutputFiles(runId, result.files);
      const summary = byTool(bench.tool).parseFinalReport(stdout, files);
      // updateGuarded signature is (id, allowedStatuses, input) → row | null
      const updated = await this.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "completed",
        toolVersion: meta.toolVersion,
        summaryMetrics: summary,
        rawOutput: { stdout: stdout.slice(-LOG_TAIL_MAX), stderr: stderr.slice(-LOG_TAIL_MAX), files: result.files },
        completedAt: new Date(result.finishTimeIso),
      });
      if (updated) await this.notify.emit({ eventType: "benchmark.completed", ... });
    } catch (e) {
      const updated = await this.repo.updateGuarded(runId, IN_PROGRESS_STATES, {
        status: "failed",
        statusMessage: `report load: ${truncate((e as Error).message, 2048)}`,
        completedAt: new Date(),
      });
      if (updated) await this.notify.emit({ eventType: "benchmark.failed", ... });
    } finally {
      this.sse.close(runId);
    }
  }
}
```

`rawOutput.stdout/stderr` 仍然按现有约定截尾（64KB），跟 callback 时代一致。

`rawOutput.files` shape 改成 `{ alias: relativePath }`（不再 base64 inline）。前端 BenchmarkDetailPage 下载文件的路径 —— 走新 API `GET /benchmarks/:id/files/:alias` 由 ReportStorage 代理拉 S3 GetObject 返回；本 spec 包含这个 API 的 contract，不包含前端改动（前端已用代理路径而非 base64 即可，改动小，PR 内一起做）。

### `loadOutputFiles` 行为

把 `result.files = { alias: relativePath }` 转成 `{ alias: bytes }`，交给 `byTool(tool).parseFinalReport(stdout, files)` 解析。各 tool adapter 不动（它们已经预期 `Record<string, Buffer>`）。

文件总大小硬上限：500MB。超过 → ReportLoader 抛 → 走 failed 路径，statusMessage="report files exceed 500MB"。

## StartupReconciler 改造

Phase 1 已有 cache.list + label 过滤 + pod exists 分支。Phase 2 把 "storage 优先" 加进来：

```ts
async run(): Promise<void> {
  const inProgress = await this.repo.listByStatus(IN_PROGRESS_STATES);
  for (const b of inProgress) {
    if (await this.storage.exists(reportStorageKeys(b.id).result)) {
      await this.reportLoader.tryLoad(b.id);
      continue;
    }
    const pod = this.informer.cache.list().find(p => p.metadata?.labels?.["modeldoctor.ai/run-id"] === b.id);
    if (pod) continue;  // pod 还在，informer 会处理
    await this.repo.updateGuarded(b.id, IN_PROGRESS_STATES, {
      status: "failed",
      statusMessage: "pod gone before reconcile",
      completedAt: new Date(),
    });
  }
}
```

理由（沿用 Phase 1 spec D3 决策）：API 停机 > 1h（pod TTL）时 pod 已删；但 runner 在 pod 删除前完成了 storage 写。storage 是 ground truth。

## Runner 改造

### `runner/main.py` 主路径

```python
# 旧：
from runner.callback import post_finish, post_log_batch, post_state_running
# 新：
from runner.callback import post_log_batch  # 只留 /log
from runner.s3_writer import S3Writer
from runner.storage_keys import keys_for

def main():
    args = parse_env()
    s3 = S3Writer.from_env()
    keys = keys_for(args.run_id)

    tool_version = detect_tool_version(args.tool)
    s3.put_json(keys.meta, {
        "toolVersion": tool_version or "",
        "startTimeIso": iso_now(),
    })

    proc = subprocess.Popen([...], ...)
    pumps = [StreamPump(proc.stdout, "stdout", ...), StreamPump(proc.stderr, "stderr", ...)]
    for p in pumps: p.start()
    proc.wait()
    for p in pumps: p.join()

    finish_time = iso_now()
    # 写 output files
    files_map = {}
    for alias, local_path in pumps_collect_output_files(args).items():
        rel = f"files/{alias}"
        s3.put_file(f"{args.run_id}/{rel}", local_path)
        files_map[alias] = rel
    # 写 stdout/stderr 全文
    s3.put_text(keys.stdout, pumps[0].full_buffer())
    s3.put_text(keys.stderr, pumps[1].full_buffer())
    # 最后写 result.json（API 用 result.json 存在做 trigger）
    s3.put_json(keys.result, {
        "exitCode": proc.returncode,
        "finishTimeIso": finish_time,
        "files": files_map,
    })

    sys.exit(proc.returncode)
```

**关键不变量**：`result.json` 是最后写的 sentinel。API 看到 `result.json` 就认为 storage 已完整。**任何 S3 写失败 raise → 进程 exit 非 0 → pod.Failed → watcher 走 `failed-terminal` 路径**（不会走 load-report，因为 phase 不是 Succeeded）。

StreamPump 行为本 spec 不动：它今天既写本地 buffer 又 POST `/log`，Phase 2 保持现状。Phase 3 时再把 POST 部分剔掉。

### `runner/s3_writer.py`（新增）

```python
import boto3
from botocore.config import Config

class S3Writer:
    @classmethod
    def from_env(cls):
        return cls(
            endpoint=os.environ["S3_ENDPOINT"],
            access_key=os.environ["S3_ACCESS_KEY"],
            secret_key=os.environ["S3_SECRET_KEY"],
            bucket=os.environ["S3_BUCKET"],
            region=os.environ.get("S3_REGION", "us-east-1"),
        )

    def __init__(self, endpoint, access_key, secret_key, bucket, region):
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

    def put_json(self, key, obj): ...
    def put_text(self, key, text): ...
    def put_file(self, key, local_path): ...  # use upload_file (auto-multipart)
```

`upload_file` 处理 multipart，>5MB 自动分块，runner 不需要管。

### `runner/storage_keys.py`（新增）

```python
def keys_for(run_id: str):
    return SimpleNamespace(
        meta=f"{run_id}/meta.json",
        result=f"{run_id}/result.json",
        stdout=f"{run_id}/stdout.log",
        stderr=f"{run_id}/stderr.log",
    )
def file_key(run_id: str, alias: str) -> str:
    return f"{run_id}/files/{alias}"
```

### `runner/callback.py` 改

```python
# 删：post_state_running, post_finish, 以及它们的所有 import/帮助函数
# 留：post_log_batch（Phase 3 才会删）
```

### `requirements.txt` 改

```
+ boto3>=1.34,<2
```

体积影响：boto3 + botocore 解压后 ~12MB。可接受。

## Job manifest 改造

`apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`：

```ts
// container.envFrom 加入第二个 secretRef
{
  envFrom: [
    { secretRef: { name: perRunSecretName } },     // 已有，含 OPENAI_API_KEY 等 + 旧 MD_CALLBACK_TOKEN（Phase 3 删）
    { secretRef: { name: "md-benchmark-storage" } } // 新增，含 S3_*
  ]
}
// container.env 删除 MD_CALLBACK_TOKEN 的注入（callback secret 不再含它）
// container.env 保留 MD_CALLBACK_URL（/log 还用）—— Phase 3 删
```

`buildSecretManifest` 改：从 per-run Secret 里删 `MD_CALLBACK_TOKEN` —— 因为 token 给 `/state` `/finish` 用的，`/log` 用的另有处理。

> ⚠️ 等等 —— 现状 `/log` HMAC guard 用的也是 `MD_CALLBACK_TOKEN`。从 callback secret 里删 token 会让 `/log` 鉴权失败。
>
> **修正**：`MD_CALLBACK_TOKEN` 暂留在 per-run Secret 里（Phase 3 删整套 callback 时再清）。本 PR 仅删 runner 代码里 `post_state_running` / `post_finish` 的调用 + 删 API 端 `/state` `/finish` controller handler。token env 还在但只服务 `/log`。

修订后的删除清单见 §"代码面变更" 部分。

## 代码面变更（精确清单）

### 删

| 文件 / 符号 | 备注 |
|---|---|
| `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts` 中 `handleState`、`handleFinish` 方法 + 路由 | controller 文件本身保留（handleLog 还在） |
| `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` 中 `/state` `/finish` 的 case | 仅删 case，文件保留 |
| `apps/api/test/e2e/benchmark-state-callback.e2e-spec.ts` | 如果存在；只针对 /state 的 e2e |
| `apps/api/test/e2e/benchmark-finish-callback.e2e-spec.ts` | 如果存在；只针对 /finish 的 e2e |
| `packages/contracts/src/benchmark.ts` 中 `benchmarkStateCallbackSchema`、`BenchmarkStateCallback`、`benchmarkFinishCallbackSchema`、`BenchmarkFinishCallback` 四个导出 | 文件保留（benchmarkLogCallbackSchema 还在） |
| `apps/benchmark-runner/runner/callback.py` 中 `post_state_running` + `post_finish` + 它们的辅助 | 文件保留（post_log_batch 还在） |
| `apps/benchmark-runner/tests/test_main.py` 中针对 /state /finish 的 case | 仅删 case，文件保留 |

### 改

| 文件 | 改动概述 |
|---|---|
| `apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts` | + primary 分支（5 条优先级）+ `mode` 入参 |
| `apps/api/src/modules/benchmark/k8s/pod-state-reducer.spec.ts` | 加 primary case 矩阵 |
| `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts` | 去掉 `primary throws`；event handler switch on 新 transition kinds；注入 ReportLoader |
| `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts` | 加 primary mode 流转测试 |
| `apps/api/src/modules/benchmark/k8s/startup-reconciler.ts` | storage > pod > fail 三分支 |
| `apps/api/src/modules/benchmark/k8s/startup-reconciler.spec.ts` | 加 storage 路径 case |
| `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts` | envFrom 加第二个 secretRef |
| `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts` | 验 envFrom |
| `apps/api/src/modules/benchmark/benchmark.module.ts` | wire S3ReportStorage + ReportLoader |
| `apps/api/src/config/env.schema.ts` | S3_* 必填、K8S_WATCHER_MODE 默认改为 `primary`（现状是 `off`） |
| `apps/benchmark-runner/runner/main.py` | 删 post_state_running / post_finish 调用；走 S3 写主路径 |
| `apps/benchmark-runner/requirements.txt` | + boto3 |
| `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx`（如有 base64 inline 假设） | 改走文件下载 API |

### 新增

| 文件 | 概述 |
|---|---|
| `packages/contracts/src/benchmark/storage-keys.ts` | `reportStorageKeys(runId)` 工厂 |
| `apps/api/src/modules/benchmark/storage/report-storage.ts` | interface |
| `apps/api/src/modules/benchmark/storage/s3-report-storage.ts` | `@aws-sdk/client-s3` 实现 |
| `apps/api/src/modules/benchmark/storage/s3-report-storage.spec.ts` | `aws-sdk-client-mock` 单测 |
| `apps/api/src/modules/benchmark/storage/report-loader.ts` | tryLoad 主路径 |
| `apps/api/src/modules/benchmark/storage/report-loader.spec.ts` | 成功 / file missing / parse fail / s3 timeout / guard race 五条路径 |
| `apps/api/src/modules/benchmark/benchmark-files.controller.ts` | `GET /benchmarks/:id/files/:alias` 代理 |
| `apps/api/src/modules/benchmark/benchmark-files.controller.spec.ts` | — |
| `apps/api/test/e2e/benchmark-watcher-primary.e2e-spec.ts` | informer fixture 发 Succeeded + S3 mock 返 fixture → 验 row=completed |
| `apps/benchmark-runner/runner/s3_writer.py` | boto3 wrapper |
| `apps/benchmark-runner/runner/storage_keys.py` | key 工厂 |
| `apps/benchmark-runner/tests/test_s3_writer.py` | moto mock |
| `apps/benchmark-runner/tests/test_main_phase2.py` | runner 主路径写 S3 顺序 + 异常退出非 0 |

## 关键设计决策

### D1 — `/state` `/finish` 彻底删，不留 deprecated no-op

**决策**：API controller 删 handler，runner 代码删 POST 调用。无 deprecated endpoint。

**为什么**：deprecated no-op 是技术债务的种子 —— 三个月后没人记得它是死的；而且不删 controller 就要继续验 HMAC、继续写 zod schema，跟"重写"口径冲突。用户明确选择了 clean slate。

**代价**：旧 runner 镜像如果在 deploy 当时正在跑，POST 会撞 404。现有 `runner/callback.py` 内部对 HTTP 错误是 swallow 的（不向 main 路径 raise），所以 benchmark 不会因此挂；pod 完成后 watcher 走 `Succeeded` → ReportLoader 找不到 `result.json` → 走 storage exists=false → backstop grace 60s 后标 `failed`。可接受，运维 deploy 前建议 drain（参 §Migration）。

### D2 — `K8S_WATCHER_MODE` 默认 `primary`

**决策**：env.schema default 改成 `primary`。

**为什么**：本 PR 的目标就是激活 primary；如果默认还是 `off` 或 `backstop`，等于"代码进了但不生效"，第二个 PR 改 default 的话又要做 ramp 通知，不如一次到位。测试 fixtures 显式覆盖成 `off`。

**代价**：单元/集成测试如果没显式覆盖会 informer 启动。`env.schema.ts` 的测试 default 已有 fixture 机制（参考 `pickTestDatabaseUrl` 同套），加一个 `K8S_WATCHER_MODE=off` 到 `E2E_ENV_DEFAULTS` 即可。

### D3 — 不引入 `'loading-report'` 中间状态

**决策**：status 枚举不变。reducer 看 `IN_PROGRESS_STATES`（含 submitted, running）门控；ReportLoader 自己用 `try/finally` 保证不卡。

**为什么**：引入新状态要动 prisma schema、benchmark contracts、前端列表筛选；收益小。

**代价**：ReportLoader 跑期间如果 cancel 并发进来，cancel 先把 status 翻到 `cancelled`，ReportLoader 写 completed 时 affected=0 → 静默丢弃。这是 D5 守卫的"先到的胜"语义，已知且符合预期。

### D4 — `result.json` 是 sentinel；S3 写顺序固定

**决策**：runner 必须**最后**写 `result.json`，前面写 meta + files + stdout + stderr。ReportLoader 也好、StartupReconciler 也好，都用 `result.json` 存在做"storage 完整"判定。

**为什么**：S3 单 object PUT 是原子的；多 object 没有事务。靠 sentinel 保证"半写"对 reader 不可见。

**代价**：runner 必须保证写 result.json 之前其他文件已成功 —— 任何前置写失败必须 raise（exit 非 0），且不能往下走到写 result.json。

### D5 — `MD_CALLBACK_TOKEN` 暂留在 per-run Secret

**决策**：本 PR 不删 `MD_CALLBACK_TOKEN` 的注入。

**为什么**：`/log` 通道还在用 HmacCallbackGuard。Phase 3 才能彻底删 token。本 spec 的"重写"口径限于 state+finish 通道，log 通道明确出 scope。

### D6 — 单 K8s Secret + bucket prefix 隔离；不做 per-runId IAM

**决策**：一个 `md-benchmark-storage` Secret 服务所有 Job。objects 用 `<runId>/...` 做逻辑隔离，不靠 IAM 强隔离。

**为什么**：用户明确选择 simplest；per-runId STS / `mc admin user svcacct add` 给每个 Job 一份临时凭据是 V2 hardening 范畴。V1 信任 runner 不会故意去 GET 别人的 runId。

### D7 — 文件下载走 API 代理，不直发 presigned URL

**决策**：前端 `GET /benchmarks/:id/files/:alias` 命中 API → service 用 owner-id 校验 → `S3ReportStorage.readBytes` → 返二进制。

**为什么**：用户已经登录的 API 是天然鉴权点；走 presigned URL 要在 API 临时签名 + 前端 fetch + CORS。代理虽然 API 多担一份带宽，但开发量小很多。鉴权沿用既有 `JwtAuthGuard`（class-level）+ service 内 `userId` 校验，与 `BenchmarkController` 一致。

## 测试策略

### 单测 (vitest)

- `pod-state-reducer.spec.ts` —— primary mode 完整矩阵：
  - phase × waiting.reason × currentStatus × ready × mode
  - 至少覆盖：Succeeded/IN_PROGRESS → load-report；Failed/IN_PROGRESS → failed-terminal；Running/ready/submitted → running；Running/ready/running → noop；Pending/ImagePull → noop（不过 grace）；Pending/ImagePull + grace 过 → failed-pre-start；Pending/no-fatal → noop；任何 phase/非 IN_PROGRESS → noop
- `s3-report-storage.spec.ts` —— `aws-sdk-client-mock`：
  - exists 命中 / NotFound / NetworkError → 抛
  - readJson 解析 OK / parse fail / NotFound
  - timeout 行为（mock socket timeout）
- `report-loader.spec.ts` —— 五条路径全覆盖：成功 / file missing → failed / parse fail → failed / s3 timeout → failed / 并发 cancel → noop（affected=0）
- `startup-reconciler.spec.ts` —— 三分支：storage 有 result.json / pod 在 informer cache / pod 不在 → failed
- `k8s-job-watcher.service.spec.ts` —— primary mode 下 reducer 各 transition 调对应 dependency（reportLoader.tryLoad / updateGuarded）

### e2e API (vitest + supertest + nock)

- 新增 `benchmark-watcher-primary.e2e-spec.ts`：
  1. 启动测试 API（K8S_WATCHER_MODE=primary 显式）
  2. nock 拦截 K8s apiserver 的 list+watch；先返一个 submitted benchmark 的 Running pod，再返 Succeeded pod
  3. `aws-sdk-client-mock` mock S3 客户端返 fixture `meta.json` / `result.json` / stdout/stderr/files
  4. 等 row.status 翻 `completed`，验 summaryMetrics + toolVersion + completedAt
- 同样的骨架再写一份 failed 路径（Failed pod → row.failed）
- 同样的骨架再写一份 storage missing（Succeeded pod 但 S3 返 NotFound → row.failed + statusMessage="report load: ..."）
- 删 callback `/state` `/finish` 相关 e2e

### Runner pytest (moto)

- `test_s3_writer.py`：moto S3 mock，验 put_json/put_text/put_file 上传到正确 key，verifying re-read 得到一致内容
- `test_main_phase2.py`：full e2e 模拟，验：写 meta → 跑 tool → 写 files → 写 result（顺序正确）；S3 写失败 → exit 非 0

### Browser e2e (playwright)

- 现有 `e2e/benchmark.spec.ts` 应该零修改通过 —— 通道层变了但 UI 行为对外一致（progress 仍走 SSE，detail 仍渲染 summaryMetrics）
- 加：deploy 后用 dev MinIO 跑一遍真实 benchmark e2e（不在 CI，docs 描述 ops manual smoke）

## Risks

| Risk | 等级 | 缓解 |
|---|---|---|
| MinIO 不可达 → 所有 benchmark 终态都 failed | H | env.schema 校验 S3_* 非空；onModuleInit 时 HeadBucket 一次做 health check（失败立 boot fail，K8s 自动重启给运维诊断窗）；prometheus alert 加 `benchmark_status_message_like_report_load` 计数 |
| runner 写 S3 部分成功后被 OOMKilled → 残留半写 objects | M | sentinel D4 保护读者；30 天 lifecycle 自动清理残留 |
| reducer 漏掉 pod.status 边角组合（Evicted via `pod.status.reason`） | M | Phase 1 单测已覆盖 backstop；primary 加同样矩阵；CI 跑 K8s pod fixture 库回归 |
| `K8S_WATCHER_MODE` 默认 primary 让旧测试意外启动 informer | L | `E2E_ENV_DEFAULTS` 加 `K8S_WATCHER_MODE=off`；单元测试 mock module 不构造 watcher |
| Deploy 时 in-flight benchmarks 用旧 runner，没写 S3 | L | Phase 1 backstop 行为兜底（Succeeded 但找不到 callback → 60s 后 failed）；运维建议 deploy 前 cancel 长跑 |
| boto3 import 失败 / 镜像构建失败 | L | requirements.txt 钉版本范围；CI build runner image |
| 大文件 (>500MB) 把 API 撑爆 | M | ReportLoader `loadOutputFiles` 总大小校验 500MB；超 → failed + statusMessage |
| 前端文件下载走代理后大文件下载体验差 | L | content-disposition stream；不在内存中缓存；V1 可接受 |

## Migration / Rollout

**Pre-deploy（运维侧）：**
1. 在 MinIO 上确认 bucket `weetime` 存在；配 lifecycle rule（30 天过期）
2. 在 K8s `modeldoctor-benchmarks` namespace 创建 `md-benchmark-storage` Secret
3. 同 Secret 也在 API 所在 namespace 创建
4. （建议）`kubectl -n modeldoctor-benchmarks get pods` 看在跑的 benchmark，等完或 cancel

**Deploy：**
1. 推新 runner image 到 registry
2. 部署新 API（K8S_WATCHER_MODE 自动 default 成 primary）

**Post-deploy 健康观察（第一周）：**
- `benchmark_status_message LIKE 'report load:%'` 频率（应 ≈ 0）
- watcher informer error 事件频率
- S3 GetObject 延迟（API 侧 metrics）
- 长 benchmark 完成时间分布对比

**回滚：** 无降级路径 —— 本 PR 是 atomic 重写。如出严重 bug 走 git revert + 重新部署旧 image。

## Accepted trade-offs

| Trade-off | 理由 |
|---|---|
| toolVersion 运行中不可见，只在终态写入 | 跟 Phase 1 spec D2 一致；UI 显示 "loading..." |
| Deploy 时 in-flight 旧 runner benchmark 会被标 failed | clean slate 口径的代价；运维侧 drain 解决 |
| runner image +12MB (boto3) | 换 SDK 处理 multipart/sign/retry；纯 HTTP 走不通（multipart 太复杂） |
| 文件下载走 API 代理（额外带宽） | 鉴权简单；V1 文件量级（<100MB / runId）API 撑得住 |
| `'loading-report'` 不引中间状态 | 保 schema 稳定；try/finally + updateGuarded 保正确性 |
| `MD_CALLBACK_TOKEN` 暂留在 Secret | `/log` 还在用；Phase 3 整体清 |
| 单 K8s Secret 跨 Job 共享 | 拒绝 per-runId IAM；V2 hardening 范畴 |

## Phase 3 / Phase 4 留下的明确路标

便于后续 PR 准确收口：

- Phase 3 = `PodLogStreamerPool` 替代 `/log` callback
  - 加 `pods/log:get` 到 `deploy/k8s/rbac.yaml`
  - 删 `BenchmarkCallbackController.handleLog`、`benchmarkLogCallbackSchema`、`HmacCallbackGuard`
  - 删 `runner/callback.py` 整文件、删 `runner/main.py` 里 StreamPump 的 POST 部分
  - 删 Job manifest 里 `MD_CALLBACK_URL` env 和 per-run Secret 里 `MD_CALLBACK_TOKEN`
  - 删剩余 callback 相关 e2e
- Phase 4 = runner 镜像净化（如还有残留）+ docs 同步

## Open questions（spec 实施前确认）

已答（self-review verified against current code）：
- ✓ `updateGuarded(id, allowedStatuses, input) → row | null` —— signature 已统一到 spec
- ✓ `MD_CALLBACK_TOKEN` 在 per-run Secret，Job manifest L36 写入；保留不动
- ✓ `parseFinalReport(stdout, files: Record<string, Buffer>)` —— `Buffer` 入参与 spec 一致
- ✓ Callback schemas 在 `packages/contracts/src/benchmark.ts` 同一个文件里（不是三个独立文件）
- ✓ 现状 `K8S_WATCHER_MODE` default `off`，本 spec 改 `primary`
- ✓ `BenchmarkController` 用 `JwtAuthGuard` class-level + service 内 ownership 校验；新 files controller 同套

仍待 verify / 决策：
1. `aws-sdk-client-mock` vs `vitest-mock-extended` —— 现有 e2e mock 库偏好；倾向前者（专为 SDK v3 设计）
2. `moto` vs `boto3` stubber —— runner pytest 现有 mock 偏好；倾向 `moto`（语法更接近真实 S3）
3. `LOG_TAIL_MAX` 当前 const 在哪？复用还是新建？（grep `LOG_TAIL_MAX_BYTES` runner 端有 `64 * 1024`；API 侧目前 callback `/finish` 的 rawOutput 切尾逻辑由 runner 完成；现在 API 端 ReportLoader 接管切尾，需要一个 const 落地点）
4. 大文件下载流式响应实现 —— NestJS `StreamableFile`（`@nestjs/common`）vs 手动写 stream；倾向 `StreamableFile`，标准做法

## References

- Phase 1 spec：`docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`
- Phase 1 PR：[#238](https://github.com/weetime/modeldoctor/pull/238)
- Tracking issue：[#237](https://github.com/weetime/modeldoctor/issues/237)
- Roadmap umbrella：[#189](https://github.com/weetime/modeldoctor/issues/189)
- `@kubernetes/client-node@0.21` informer：`dist/informer.d.ts`
- `@aws-sdk/client-s3`：https://www.npmjs.com/package/@aws-sdk/client-s3
- `aws-sdk-client-mock`：https://www.npmjs.com/package/aws-sdk-client-mock
- `boto3` S3：https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html
- `moto` S3 mock：https://docs.getmoto.org/en/latest/docs/services/s3.html
- MinIO lifecycle：https://min.io/docs/minio/linux/administration/object-management/object-lifecycle-management.html
