# Watch-based runner status — 用 K8s informer + pod logs 替代 runner→API callback

**Status:** draft · 2026-05-25
**Scope:** apps/api benchmark module + apps/benchmark-runner
**Tracks:** Roadmap #189 P1 "K8s 回调通道架构重做"（重写并升级原 #177 提案）
**Depends on:** report 走共享存储（独立 spec，**本 spec 不实施**）
**Does NOT depend on:** `@kubernetes/client-node` 升 1.x — 0.21 完全够用（[ESM 迁移 Phase 2](./2026-05-22-esm-migration-design.md) 跟本 spec 解耦）

## Goal

把 runner→API 的所有元数据通道（状态、日志、终态、toolVersion）从 **push (HTTP callback)** 改成 **pull (K8s API)**：

- 状态生命周期：由 API 内 Informer 监听 `pod.status` 推导
- 实时日志 + progress%：由 API 内 per-pod log streamer 通过 `pods/log?follow=true` 拉取
- 终态报告 + toolVersion：runner 写入共享存储，API 在 pod 终态后读

runner 镜像从此**只跑工具 + 写文件**，不再持有 API URL/token，不再发出 HTTP。

## Why now

1. **#189 P1 路线优先级提升**：自动运维闭环（PromRule baseline + alert webhook + AI explainer）已落地 P0；下一站就是 callback 通道重做。
2. **当前 callback 三个真实痛点**（来自 #109/#175/#176 沉淀）：
   - **pre-start failure 隐身**：`ImagePullBackOff` / `CrashLoopBackOff` 发生在 runner 启动前，永远不会触发 callback，benchmark 永远卡 `submitted`。今天只能 `kubectl get pods` 排查。
   - **runner 静默挂**：`/finish` POST 失败 / runner OOM / pod 被 evicted → benchmark 永远卡 `running`，K8s Job 状态正常，API 不知情。
   - **/finish 载荷膨胀**：`max-requests=500+` 的 report 已超 16 MB，PR #174 把上限抬到 64 MB 是 band-aid；2000+ requests 会再撞。
3. **runner 复杂度膨胀**：runner 今天要管 callback URL、HMAC token、重试、batching、tail-buffer cap、JSON 编码——这些都是 push 模型的伴生复杂度，跟"跑一个工具"的本职无关。
4. **0.21 完全够**：informer + ListWatch + Log.log(follow) 在 0.21 都有（已核 `dist/informer.d.ts` / `dist/log.d.ts`），不需要等 ESM Phase 2。

## Non-goals

- **不做共享存储层本身**。本 spec 假设它存在并定义接口（`reportPath`、`metaPath`），实施时**先于本 spec** 完成一份独立的 "report shared storage" spec/PR。
- **不做 leader election / 多副本 API**。API 仍是单副本，informer 进程内单例。多副本未来要做时单独走 ESM Phase 2 + client-node 1.x + `@codedependant/kubernetes-leader-election`。
- **不动 SSE 协议本身**。`SseHub` 仍按 benchmarkId 推 `ProgressEvent`，前端零改动。
- **不改 cancel API**。用户取消仍走 `BenchmarkService.cancel()` → `K8sBenchmarkRunner.cancel()` → `deleteNamespacedJob(propagationPolicy="Background")`，cascade 删 pod，Informer 收到 DELETE 事件自然 cleanup。
- **不动 Job manifest 的 owner references / TTL**。`ttlSecondsAfterFinished: 3600` 保留，Secret cascade 保留。

## Architecture

### 通道形态对比

| 信号 | 今天 (callback) | 改后 (watch + 存储) |
|---|---|---|
| 状态 `running` | runner POST `/state` | informer: `pod.phase=Running` + container ready |
| 状态 `completed` | runner POST `/finish state=completed` | informer: `pod.phase=Succeeded` → 触发 report 读取 → 解析成功 |
| 状态 `failed`（工具非零退出） | runner POST `/finish state=failed` | informer: `pod.phase=Failed` + `terminated.exitCode != 0` |
| 状态 `failed`（pre-start） | ❌ 永远拿不到 | informer: `waiting.reason ∈ {ImagePullBackOff, CrashLoopBackOff, ErrImagePull}` 持续 > 60s |
| 状态 `failed`（runner 静默挂） | ❌ 永远拿不到 | informer: `pod.phase=Failed` 或 `Succeeded` 但 report 不存在 |
| `statusMessage` | runner 自填 | informer: `terminated.exitCode/reason/message` 拼成 |
| `startedAt` / `completedAt` | runner POST 时刻（带漂移） | informer: pod conditions 里的 transition time |
| `toolVersion` | runner POST `/state` | runner 写 `meta.json` → API 读 |
| live SSE log + `progress%` | runner POST `/log` 批量 | per-pod log streamer: `Log.log(..., {follow:true})` 边拉边 `adapter.parseProgress` |
| `summaryMetrics` + `rawOutput` | runner POST `/finish` | runner 写 report 文件 → API 读 → `adapter.parseFinalReport` |

### 组件图

```
                  ┌────────────────────────────────────┐
                  │         apps/api (single)          │
                  │                                    │
                  │  K8sJobWatcherService (singleton)  │
                  │    ┌─────────────────────────────┐ │
                  │    │ Informer<V1Pod>             │ │
                  │    │   path=/api/v1/namespaces/  │ │
                  │    │        <ns>/pods            │ │
                  │    │   labelSelector=            │ │
                  │    │     app.kubernetes.io/      │ │
                  │    │       name=modeldoctor-run  │ │
                  │    │   handlers: ADD/UPDATE/     │ │
                  │    │     DELETE/CONNECT/ERROR    │ │
                  │    └─────────────────────────────┘ │
                  │                  │                 │
                  │                  ▼ pod event       │
                  │    ┌─────────────────────────────┐ │
                  │    │ PodStateReducer             │ │
                  │    │   pod → desired benchmark   │ │
                  │    │     status transition       │ │
                  │    │   (pure fn, easy to test)   │ │
                  │    └─────────────────────────────┘ │
                  │                  │                 │
                  │     ┌────────────┼─────────────┐   │
                  │     ▼            ▼             ▼   │
                  │  start log    update         load  │
                  │  streamer     benchmark      report│
                  │     │         status        (term) │
                  │     │                              │
                  │     ▼                              │
                  │  ┌──────────────────────────────┐  │
                  │  │ PodLogStreamerPool           │  │
                  │  │   per-runId Log.log stream   │  │
                  │  │   → adapter.parseProgress    │  │
                  │  │   → SseHub.publish           │  │
                  │  │   → update progress%         │  │
                  │  └──────────────────────────────┘  │
                  │                                    │
                  │  StartupReconciler                 │
                  │   on OnModuleInit:                 │
                  │     list IN_PROGRESS benchmarks    │
                  │     for each: 优先看存储, 其次 pod │
                  └────────────────────────────────────┘
                                  │  watch / list / logs
                                  ▼
                         ┌────────────────┐
                         │ K8s apiserver  │
                         └────────────────┘
```

## State machine（写权重新定义）

**核心规则**：benchmark.status 只能 **forward**（非终态 → 终态），永不被覆盖。所有写者都用 `UPDATE … WHERE status IN ('submitted','running')` 做并发守卫。

| 写者 | 触发 | 目标 status | 附带写 |
|---|---|---|---|
| `BenchmarkService.submit()` | 用户创建 | `submitted` | — |
| `K8sBenchmarkRunner.start()` | 投递 Job | （仍 `submitted`） | `runHandle` |
| **Informer** | `pod.phase=Running` && container ready | `running` | `startedAt` |
| **Informer** | `waiting.reason ∈ FATAL_WAITING_REASONS` 持续 > `WAITING_FATAL_GRACE_SEC` | `failed` | `statusMessage` |
| **Informer** | `pod.phase=Failed`（且 benchmark 仍 IN_PROGRESS） | `failed` | `statusMessage`, `completedAt` |
| **Informer → ReportLoader** | `pod.phase=Succeeded` | （触发 ReportLoader） | — |
| **ReportLoader** | report 解析成功 | `completed` | `summaryMetrics`, `rawOutput`, `toolVersion`, `completedAt` |
| **ReportLoader** | report 解析失败 / 文件不存在 | `failed` | `statusMessage="report parse: …"`, `completedAt` |
| `BenchmarkService.cancel()` | 用户取消 | `cancelled` | `completedAt` |
| **StartupReconciler** | IN_PROGRESS + 存储有 report | 走 ReportLoader 同路径 | 同上 |
| **StartupReconciler** | IN_PROGRESS + pod 存在 | 不动，等 Informer | — |
| **StartupReconciler** | IN_PROGRESS + pod 不存在 + 存储无 report | `failed` | `statusMessage="pod gone before reconcile"` |

**`FATAL_WAITING_REASONS`** = `["ImagePullBackOff", "CrashLoopBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"]`

**`WAITING_FATAL_GRACE_SEC`** = 60（默认；env-tunable）。理由：`ImagePullBackOff` 短暂出现是正常的（registry 限速、网络抖动），60s 是 K8s 社区惯例阈值。

**ReportLoader 路径**：

```
informer: pod.phase=Succeeded
  → ReportLoader.tryLoad(runId)
      → 从 storage 读 report.json + meta.json
      → byTool(tool).parseFinalReport(stdout, files)
      → 写 summaryMetrics + rawOutput + toolVersion + status=completed
  → notify.emit('benchmark.completed')

异常路径：
  storage 读失败 / parse 失败
    → status=failed
    → statusMessage=<原因>
    → notify.emit('benchmark.failed')
```

## 代码面变更

### 删

- `apps/api/src/modules/benchmark/callbacks/` 整目录（controller + spec）
- `apps/api/src/common/hmac/hmac-callback.guard.ts`（确认无其他用户后删；本 spec 实施前 `grep -rn HmacCallbackGuard` 验）
- `apps/benchmark-runner/runner/callback.py` 整文件
- `runner/main.py` 里 `post_state_running` / `post_log_batch` / `post_finish` 全部调用 + import
- `runner/main.py` 里 `StreamPump` 的 HTTP 部分（流读还要保留，但只写本地文件 + 标准输出）
- `packages/contracts/src/.../benchmark*Callback*.ts`（三个 schema + 类型）
- `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts` 里给 runner 注入 `MD_CALLBACK_URL` / `MD_CALLBACK_TOKEN` 的 env（callback secret 也不再需要进 Secret）

### 改

**`apps/api/src/modules/benchmark/benchmark.module.ts`**：
- `useFactory` 已加载 `@kubernetes/client-node` + 构造 KubeConfig，再额外暴露 `KubeConfig` 实例供新 `K8sJobWatcherService` 注入。
- providers 加 `K8sJobWatcherService`、`PodLogStreamerPool`、`PodStateReducer`、`ReportLoader`、`StartupReconciler`。

**`apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`**：
- 删除注入 `MD_CALLBACK_URL` / `MD_CALLBACK_TOKEN` 的 env。
- 添加注入 `MD_REPORT_PATH`（共享存储里的写入目录）env。具体路径由 storage spec 给出，比如 `pvc://benchmark-runs/<runId>/`。
- buildSecretManifest：`MD_CALLBACK_TOKEN` 不再写入 Secret（callback token 整体废弃）。`secretEnv`（含 OPENAI_API_KEY 等）保留——这些是给被跑的工具的，不是给 callback 的。

**`runner/main.py`**：
- 删 `post_state_running` / `post_finish` 调用
- `StreamPump` 改成：每行写到 `MD_REPORT_PATH/stdout.log` / `stderr.log`（line-buffered append），不再 POST `/log`
- 启动后写 `MD_REPORT_PATH/meta.json`：`{toolVersion, startTimeIso}`
- 结束后写 `MD_REPORT_PATH/result.json`：`{exitCode, finishTimeIso, files: {alias→rel_path}}`（files 是文件名引用，不再 base64 嵌入）
- 真实的 output 文件继续按 alias 名写到 `MD_REPORT_PATH/files/<alias>`

### 新增

#### `apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts`

```ts
// 纯函数 + 单测密集覆盖。pod metadata → desired transition。
// 不带任何 IO；输出给 watcher service 拿去执行。
export type DesiredTransition =
  | { kind: "running"; startedAt: Date }
  | { kind: "failed"; statusMessage: string; completedAt: Date }
  | { kind: "load-report"; podName: string; runId: string }
  | { kind: "noop" };

export function reduce(
  pod: V1Pod,
  currentBenchmark: { status: BenchmarkStatus; startedAt: Date | null },
  now: Date,
  config: { fatalWaitingReasons: string[]; waitingFatalGraceSec: number },
): DesiredTransition;
```

判定优先级（reducer 内部）：
1. `pod.phase=Succeeded` && IN_PROGRESS → `load-report`
2. `pod.phase=Failed` && IN_PROGRESS → `failed`（statusMessage 从 `containerStatuses[0].state.terminated.{reason,message,exitCode}` 拼）
3. `pod.phase=Pending` + `waiting.reason ∈ FATAL_WAITING_REASONS` 且首次出现时间距今 > grace → `failed`
4. `pod.phase=Running` && container ready && currentStatus=`submitted` → `running`
5. 其他 → `noop`

#### `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts`

```ts
@Injectable()
export class K8sJobWatcherService implements OnModuleInit, OnModuleDestroy {
  private informer: Informer<V1Pod> & ObjectCache<V1Pod>;
  private waitingSince = new Map<string, Date>(); // runId → first FATAL waiting seen

  async onModuleInit() {
    // ...构造 Informer，labelSelector 锁定 app.kubernetes.io/name=modeldoctor-run
    this.informer.on("ADD", (p) => this.onPodEvent(p));
    this.informer.on("UPDATE", (p) => this.onPodEvent(p));
    this.informer.on("DELETE", (p) => this.onPodDelete(p));
    this.informer.on("ERROR", (e) => this.log.error("informer error", e));
    this.informer.on("CONNECT", () => this.log.log("informer connected"));
    await this.informer.start();
    await this.reconciler.run(); // 启动时对账
  }

  async onModuleDestroy() {
    await this.informer.stop();
    await this.logStreamerPool.stopAll();
  }
  // ...
}
```

实施注意点：
- 用 `makeInformer(kc, "/api/v1/namespaces/<ns>/pods", listFn, labelSelector)` —— **不要**直接用 `Watch.watch`，informer 自带 ResourceVersion 续传 + apiserver 强断的重连。
- `listFn` 调用 `coreV1Api.listNamespacedPod(ns, ..., labelSelector)`，返回 `{response, body}`（0.21 shape，1.x 才去 body 包裹）。
- runId 从 pod label `modeldoctor.ai/run-id` 提取。
- `onPodEvent` 内：先看 `waiting.reason`，是 FATAL 就记录 `waitingSince`；过 grace 还在 → 触发 `failed`。其他时间清空 entry。
- ERROR 事件 informer 内部会自动重连，但要监控连续 5 次 ERROR → emit alert（接 NotifyService 走 ops 告警渠道，复用 P0 通知体系）。

#### `apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts`

```ts
@Injectable()
export class PodLogStreamerPool {
  private streams = new Map<string, AbortController>();

  start(runId: string, ns: string, podName: string): void {
    if (this.streams.has(runId)) return;
    const writable = this.makeWritable(runId); // 行解析 → adapter.parseProgress → SseHub.publish
    const ctl = new AbortController();
    this.streams.set(runId, ctl);
    this.logApi.log(ns, podName, "runner", writable, { follow: true }).then((req) => {
      ctl.signal.addEventListener("abort", () => req.abort());
    }).catch((e) => this.log.warn(`log stream ${runId}: ${e.message}`));
  }

  stop(runId: string): void {
    this.streams.get(runId)?.abort();
    this.streams.delete(runId);
  }

  stopAll(): void { /* ... */ }
}
```

实施注意点：
- `Log.log(ns, pod, container, stream, {follow:true})` 返回 `Promise<request.Request>`，停止靠 `req.abort()`。0.21 用 `request` 库，1.x 才换 fetch + AbortController；本 spec 用 0.21 的接口。
- 触发：watcher 看到 pod 第一次进 Running → `start(runId)`。pod 进终态 (Succeeded/Failed/Unknown) → `stop(runId)`。
- 流解析：复用今天 `BenchmarkCallbackController.handleLog` 里的 line splitter + `adapter.parseProgress` 逻辑（提取到 `pod-log-streamer.ts` 的 writable 里）。
- progress% 更新策略：跟今天一致 —— `update(benchmarkId, { progress: lastPct })`，throttle 不变。

#### `apps/api/src/modules/benchmark/k8s/report-loader.ts`

```ts
@Injectable()
export class ReportLoader {
  async tryLoad(runId: string): Promise<void> {
    const bench = await this.repo.findById(runId);
    if (!bench || !IN_PROGRESS_STATES.includes(bench.status)) return;
    try {
      const meta = await this.storage.readJson(`${runId}/meta.json`);
      const result = await this.storage.readJson(`${runId}/result.json`);
      const stdout = await this.storage.readText(`${runId}/stdout.log`);
      const stderr = await this.storage.readText(`${runId}/stderr.log`);
      const files = await this.loadOutputFiles(runId, result.files);
      const summary = byTool(bench.tool).parseFinalReport(stdout, files);
      await this.repo.update(runId, {
        status: "completed",
        toolVersion: meta.toolVersion,
        summaryMetrics: summary,
        rawOutput: { stdout, stderr, files: result.files }, // files 改成路径引用
        completedAt: new Date(result.finishTimeIso),
      });
      await this.notify.emit({ eventType: "benchmark.completed", ... });
    } catch (e) {
      await this.repo.update(runId, {
        status: "failed",
        statusMessage: `report load/parse: ${(e as Error).message}`.slice(0, 2048),
        completedAt: new Date(),
      });
      await this.notify.emit({ eventType: "benchmark.failed", ... });
    } finally {
      this.sse.close(runId);
    }
  }
}
```

注意 `rawOutput.files` 的 shape 改了：今天是 `{alias: base64}`，改后是 `{alias: storagePath}`。前端 `BenchmarkDetailPage` 下载文件的路径需要相应调整 —— 这块属于 report storage spec 范畴，本 spec 只定义"API 持久化的是 path 引用"。

#### `apps/api/src/modules/benchmark/k8s/startup-reconciler.ts`

```ts
@Injectable()
export class StartupReconciler {
  async run(): Promise<void> {
    const inProgress = await this.repo.listByStatus(["submitted", "running"]);
    for (const b of inProgress) {
      // 1. 优先看存储：report 文件存在 → 走 ReportLoader（pod 可能已被 TTL 删）
      if (await this.storage.exists(`${b.id}/result.json`)) {
        await this.reportLoader.tryLoad(b.id);
        continue;
      }
      // 2. 看 pod
      const pod = this.informer.cache.get(`run-${b.id}`, this.namespace);
      if (pod) {
        // pod 还在，Informer 会处理后续事件，这里不动
        // 但要立刻给 Running 中的 pod 启动 log streamer（API 重启场景）
        if (pod.status?.phase === "Running") {
          this.logStreamerPool.start(b.id, this.namespace, pod.metadata!.name!);
        }
        continue;
      }
      // 3. pod 没了 + 存储也没 report → 失败
      await this.repo.update(b.id, {
        status: "failed",
        statusMessage: "pod gone before reconcile",
        completedAt: new Date(),
      });
    }
  }
}
```

## 关键设计决策（每条都标了为什么是这个选择）

### D1 — API 重启期间的 log gap：接受，前端打"中断"分隔

**决策**：API 重启后 log streamer reconnect，**不补偿** 中间错过的日志，但在 SSE 流里 emit 一条 `{kind: "log", level: "warn", line: "[API 重启，日志中断]"}` 让前端用户能看出。

**为什么不补**：
- K8s pod stdout buffer 大小取决于 container runtime，通常远小于一次 benchmark 的日志量
- 用 `sinceTime=<断开时刻>` 拉历史在 stdout 没持久化时仍然拿不到旧 log
- 真正的补偿（runner 双写到存储）属于 storage spec 范畴；live log 是 nice-to-have，不该跨 spec
- API 重启是低频事件（重启间隔通常远大于单次 benchmark 时长）

### D2 — toolVersion 走存储不走 annotation

**决策**：runner detect 完后写 `meta.json` 到存储；ReportLoader 在终态时一并读。

**为什么不走 pod annotation**：
- annotation 需要 runner 在 pod 内执行 `kubectl patch`，要给 runner 注入 ServiceAccount + RBAC
- annotation 大小有 256KB 限制；虽然 toolVersion 远低于这个，但开启 in-pod kube client 是一笔大的 attack surface 投资
- 既然 report 本来就要走存储，多写一个小 JSON 是零边际成本

**代价**：toolVersion 只在终态可见，运行中 benchmark 详情页的 "toolVersion" 字段在 watch 模式下会比今天晚出现（今天是 `/state` 时就有，现在要等 `Succeeded` 才能读 meta）。可接受。

### D3 — StartupReconciler 优先看存储

**决策**：reconcile 时 storage > pod > fail。

**为什么**：API 停机 > 1h（pod TTL）时，pod 已被 K8s 删除。但 runner 可能在 pod 删除前已完成写 storage。这种 case 下 storage 才是 ground truth。pod 存在仅意味着 informer 会接管后续事件。

### D4 — Informer 出错重连策略：靠库 + 监控

**决策**：用 `makeInformer` 自带的 ResourceVersion 续传 + 自动重连；连续 5 次 ERROR 事件触发 ops 告警（接 NotifyService）。不在 ERROR 上做指数退避（informer 内部已经做了）。

**为什么不 crash-on-error**：informer 临时网络问题就 crash 整个 API 进程对生产体验差；让它持续重试 + 告警即可。

### D5 — 写权守卫用 SQL 条件 UPDATE

**决策**：所有改 `benchmark.status` 的写者都用 `UPDATE benchmarks SET ... WHERE id = ? AND status IN ('submitted', 'running')`。返回 affected rows = 0 时静默丢弃（已被别的写者占据）。

**为什么**：单进程 informer + 单进程 BenchmarkService 理论上不会冲突，但 reconciler 跟 informer 启动有 race window（reconciler 还在跑时 informer 已经收到事件）。SQL 守卫是无成本的并发保险。

## Phasing

Phase 切分按"每个 phase 都可独立合并 + 不破坏现状"原则。

### Phase 0 — 前置（**独立 spec/PR**，不在本 spec）

- Report shared storage：定义 `ReportStorage` 接口 + PVC 实现 + apps/api 注入 + lifecycle TTL 清理
- 不动 runner 也不动 watcher，只是把"读 report"的入口准备好

### Phase 1 — Watcher backstop（本 spec 第一段）

- 加 `K8sJobWatcherService` + `PodStateReducer` + `StartupReconciler`
- watcher 只在两种条件下 update：
  1. FATAL waiting 持续 > 60s → `failed`
  2. pod 终态 (Succeeded/Failed) 持续 > 60s 但 benchmark 仍 IN_PROGRESS → `failed`
- callback 三个 endpoint **全部保留**，watch 只做兜底
- 0 runner 改动
- 不引入 `PodLogStreamerPool`、`ReportLoader`
- Roll-out 风险最低，先解决 pre-start + 静默挂两大痛点

**验收**：
1. 创建 image typo 的 benchmark，30s 内进 `failed` 状态，`statusMessage` 描述 reason
2. 已 running 的 benchmark，手动 `kubectl delete pod` 模拟 OOM，60s 内进 `failed`
3. API 重启后启动 reconcile 跑通，IN_PROGRESS 但 pod 不在的 benchmark 进 `failed`
4. 正常完成的 benchmark 行为零回归（callback 仍然 primary）

### Phase 2 — Watch 替代 `/state` 和 `/finish` 状态翻转

**依赖** Phase 0 完成（ReportLoader 要读 storage）。

- 加 `ReportLoader`
- watcher 进 `Succeeded` 时不再等 60s，直接触发 `ReportLoader.tryLoad`
- watcher 进 `Failed` 时直接写 `failed`（不再让 callback 抢）
- runner 删 `post_state_running` 和 `post_finish` 调用，改为写 `meta.json` + `result.json`
- API 删 `/state` 和 `/finish` 两个 endpoint
- `/log` 暂留

**验收**：
1. 全套现有 benchmark e2e 跑通（completed / failed / cancelled）
2. report 解析失败时 status=failed（验证 ReportLoader 异常路径）
3. cancel 仍然正常工作

### Phase 3 — Pod log streamer 接管 `/log`

- 加 `PodLogStreamerPool`
- watcher 进 Running → start streamer；进终态 → stop streamer
- StartupReconciler 给已 Running 但无 streamer 的 benchmark 启动 streamer
- runner 删 `StreamPump` 的 POST 部分，改为只写 `stdout.log` / `stderr.log`
- API 删 `/log` endpoint
- 删 `HmacCallbackGuard`、`benchmarkLogCallbackSchema` 等遗留

**验收**：
1. 前端 benchmark 详情页 live tail 行为基本一致（接受首次 chunk 到达延迟可能略大）
2. API 重启场景：SSE 流出现"日志中断"标记后继续推送
3. 长 benchmark（>10min）log 不丢

### Phase 4 — runner 镜像净化

- 删 `runner/callback.py`
- 删 `runner/main.py` 里所有 callback import + token/URL env 处理
- 删 `K8sBenchmarkRunner` 里 `MD_CALLBACK_URL` / `MD_CALLBACK_TOKEN` 注入
- 删 contracts 里三个 callback schema
- 删 HmacCallbackGuard

## 测试策略

### 单测（vitest）

- `PodStateReducer`：枚举所有 pod.phase × waiting.reason × currentStatus 组合，每个组合一个 case。**这是本 spec 最该被密集覆盖的地方** —— reducer 是纯函数，覆盖率应近 100%。
- `K8sJobWatcherService`：mock Informer + repo + reportLoader + logStreamerPool，验事件 → 动作映射。
- `ReportLoader`：mock storage + adapter，验成功路径 + 解析失败路径 + 文件缺失路径。
- `StartupReconciler`：mock cache + storage + repo，验三种 reconcile 分支。
- `PodLogStreamerPool`：mock Log.log，验 start/stop 幂等 + adapter 解析 + SSE publish 调用。

### e2e (vitest + supertest)

- 删 `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` 整文件
- 删 `apps/api/test/e2e/benchmark-callback.e2e-spec.ts`（如果存在）
- 新增 watcher 风格的 e2e：mock K8s apiserver（用 `nock` 或 fixture HTTP server）发送 watch 事件，验 benchmark 状态翻转

### Browser e2e (playwright)

- 现有 `e2e/benchmark.spec.ts` 应该零修改通过 —— 协议层换了但 SSE 行为对外一致

## Risks

| Risk | 等级 | 缓解 |
|---|---|---|
| API 重启期间多个 benchmark 的 log 同时中断，用户体验差 | M | D1 决策接受；前端用警告样式渲染"中断"行；监控统计 streamer reconnect 频率 |
| Informer 启动失败（kube apiserver unreachable / RBAC 配错） | M | OnModuleInit 失败让 NestJS 拉起失败，K8s 自动重启 pod；3 次连续失败前不 crash，给手动诊断窗口 |
| reducer 漏掉某个 pod.status 边角组合（比如 Evicted 写在 `pod.status.reason` 不在 phase） | H | 单测覆盖 K8s pod lifecycle 全谱；CI 引入一份"K8s pod fixture 库" 作为回归测试基线 |
| `ttlSecondsAfterFinished: 3600` 删 pod 太快导致 informer 错过 Succeeded 事件 | L | informer 主动 list 会拿到所有未删 pod；TTL 是 1h，远长于一次状态推导窗口；StartupReconciler 兜底 |
| log streamer reconnect 风暴（一次 API 重启 + 50 个并发 benchmark） | M | reconnect 加 jitter；监控并发 stream 数；超过阈值告警 |
| Phase 3 上线时 runner 还在发 `/log` (旧 runner 镜像漂在 cluster 里)，API 已删 endpoint → 404 | L | runner 单 deploy 是新版即可；Phase 3 PR 必须验：旧 runner 镜像跑出来的 benchmark 进度条不更新但不崩溃 |
| 共享存储慢/挂导致 ReportLoader 超时 → benchmark 卡 `running` | M | ReportLoader 加超时 (30s 默认)；超时归类为 `failed` 而非永远 `running` |
| Informer 内部 ListWatch 在 0.21 有 bug 导致 ResourceVersion gap → 漏事件 | L | 实施前跑一次长测验证；遇到时 fallback 到周期 list reconcile（每 30s 全量 list 一次作为辅助） |

## Accepted trade-offs

| Trade-off | 理由 |
|---|---|
| API 重启期间 live log 中断 | D1：避免引入双写复杂度；重启低频，且 progress% 仍能从 reconnect 后继续 |
| toolVersion 在 running 阶段不可见，只在终态写入 | D2：换取 runner 不需要 ServiceAccount + RBAC；UI 上加 "loading" 占位即可 |
| API 仍是单副本，未来要 HA 需要先做 ESM Phase 2 + 1.x + leader election | 现状本来就是单副本，没增加新约束；ESM Phase 2 完成后再开 HA 子任务 |
| 报告文件下载路径从 base64 嵌入改为 storage 引用 | 跟 storage spec 一致；前端要适配，但解决了 64MB 上限问题 |
| Phase 1 期间 watcher 跟 callback 双写 status 有理论 race | 守卫 D5 的 SQL 条件 UPDATE 保证终态不被覆盖；race window 实测会有 informer 发现 pod 终态 → 写 failed，与 /finish 抵达写 completed 同时；callback 永远赢（callback 写 IN_PROGRESS→COMPLETED，watcher 写 IN_PROGRESS→FAILED；先到的写权生效，后到的因为 status 已不在 IN_PROGRESS 直接 0 rows affected） |

## Rollout / Rollback

每个 Phase 都可独立 revert：

- **Phase 1 revert**：删 watcher service 即可，callback 路径不动。
- **Phase 2 revert**：恢复 `/state` `/finish` controller + runner 的 callback 调用；watcher 退回 backstop 模式。
- **Phase 3 revert**：恢复 `/log` controller + runner 的 StreamPump POST 部分。
- **Phase 4 revert**：保留即可（清理性改动，不影响功能）。

每个 Phase 上线时通过单一 feature flag `K8S_WATCHER_MODE = off | backstop | primary` 控制 watcher 行为：
- Phase 1 ramp：`off` → `backstop`
- Phase 2 ramp：`backstop` → `primary`
- Phase 3/4：删 flag

## Open questions（spec → implementation 前必须答）

1. **共享存储 spec 的接口**长什么样？`ReportStorage.readJson` / `readText` / `exists` 这三个最小接口能否在 storage spec 里确认？
2. **`pods/log` RBAC**：现有 API ServiceAccount 是否已经有 `pods/log:get`？没有的话补 ClusterRole 改动。
3. **删除 HmacCallbackGuard 影响面**：grep 确认它只被 `BenchmarkCallbackController` 用，没别的 controller 复用？（本 spec 实施前 grep）
4. **e2e 测试 K8s 模拟方式**：用 `nock` 拦截 axios HTTP 调用，还是用 `kubernetes-mock-server` 之类的 fixture？倾向 nock —— 跟 0.21 的 `request` 库不冲突。
5. **`progress%` 阻塞写优化**：今天 `/log` 每个 batch 都 `update(progress)` 一次，watcher 模式下 streamer 拉得更密集，是否需要 throttle 到 1Hz？（建议加）

## References

- 当前 callback 控制器：`apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`
- 当前 runner：`apps/benchmark-runner/runner/main.py` + `runner/callback.py`
- 当前 Job manifest：`apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`
- 当前 K8s runner：`apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts`
- 0.21 informer 签名：`@kubernetes/client-node/dist/informer.d.ts`
- 0.21 Log.log 签名：`@kubernetes/client-node/dist/log.d.ts`
- 历史 issue：[#109](https://github.com/weetime/modeldoctor/issues/109) [#175](https://github.com/weetime/modeldoctor/issues/175) [#176](https://github.com/weetime/modeldoctor/issues/176) [#177](https://github.com/weetime/modeldoctor/issues/177)
- 当前 roadmap 定位：[#189](https://github.com/weetime/modeldoctor/issues/189) "P1 · K8s 回调通道架构重做"
- ESM 解耦说明：[2026-05-22 ESM 迁移设计](./2026-05-22-esm-migration-design.md)
- K8s pod lifecycle 官方文档：https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- K8s 容器状态 reason 列表：https://kubernetes.io/docs/reference/node/node-status/
