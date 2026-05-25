# Pod log stream replacing /log callback — Phase 3：彻底删 runner→API callback 通道

**Status:** draft · 2026-05-25
**Scope:** `apps/api` benchmark module + `apps/benchmark-runner` + `deploy/k8s/rbac.yaml`
**Tracks:** [#237](https://github.com/weetime/modeldoctor/issues/237) Phase 3
**Builds on:** [Phase 1 watcher backstop](./2026-05-25-watch-based-runner-status-design.md)（[PR #238](https://github.com/weetime/modeldoctor/pull/238)）、[Phase 2 报告共享存储 + watcher primary](./2026-05-25-report-storage-and-watcher-primary-design.md)（[PR #239](https://github.com/weetime/modeldoctor/pull/239)）
**Out of scope:** runner 镜像净化 + docs 同步（留 Phase 4，详见 §尾部路标）

## Goal

把 runner→API 的 **live log + progress%** 通道从 push（HTTP `POST /internal/benchmarks/:id/log`）改成 pull（API 直接对 pod 走 `Log.log(follow:true)`）。同时彻底清掉整个 HMAC callback 框架：

- API 端：删 `BenchmarkCallbackController`、`HmacCallbackGuard`、`hmac-token.*`、`BENCHMARK_CALLBACK_SECRET` env
- contracts：删 `benchmarkLogCallbackSchema` + `BenchmarkLogCallback`（Phase 2 已删 state/finish schema）
- runner：删 `runner/callback.py` 整文件 + `StreamPump` 的 POST 路径 + `MD_CALLBACK_URL`/`MD_CALLBACK_TOKEN` env 读取
- Job manifest：删 `MD_CALLBACK_URL` env 注入 + per-run Secret 的 `MD_CALLBACK_TOKEN` 字段
- 新增：API 端 `PodLogStreamerPool` + `PodLogStreamer`，watcher 在 Running pod 事件上 idempotent 启 streamer，在 terminal 事件上 `await drainAndStop` 然后再 `void tryLoad`

口径：**彻底重写**，不留 deprecated endpoint，不双写，不带技术债。

## Why this shape

Phase 1 装好 watcher backstop；Phase 2 把状态翻转 + 终态报告改 pull（K8s informer + S3）；callback 通道里只剩 `/log` —— 它仍然是 runner 主动 POST。Phase 3 把这条也拉成 pull：API 用 `@kubernetes/client-node` 的 `Log.log(ns, pod, container, writable, {follow:true})` 直接订阅 pod stdout/stderr，做和今天 controller 里一样的 line → `adapter.parseProgress` → `SseHub.publish` + DB progress 更新。

收益是清掉整条 callback 通道（一致性：所有 runner→API 信号都是 watcher pull），代价是 API 多打 N 条长 HTTP 连接到 apiserver（kubectl logs -f 同样形态，apiserver 设计支持）。

## Non-goals

- **不引入新的中间状态**：status 枚举不变；live log 是纯 SSE/progress 现象，不进 DB
- **不动 SSE 协议 / 前端**：前端零改动
- **不做 stream-level 去重**：断流重连用 `sinceSeconds=10` 重叠，接受 SSE 上偶发 dup line（详见 D1）
- **不做 per-pod IAM scope**：复用 modeldoctor-api SA + namespace-bound Role
- **不做 multi-replica streamer 协调**：单 API 进程持有所有 streamer；HA 留 ESM Phase 2 + leader election
- **不动 cancel API / Job 删除路径**：`BenchmarkService.cancel()` 走 `K8sBenchmarkRunner.cancel()` 删 Job，watcher 收 delete 事件后 `pool.stop(runId)` 即可

## Architecture

### 通道形态对比

| 信号 | Phase 2 之后 | 本 spec 之后 |
|---|---|---|
| 状态 `running` / `completed` / `failed` | informer + ReportLoader（不变） | 同 |
| `summaryMetrics` / `rawOutput` / `toolVersion` | runner 写 S3 → ReportLoader 读（不变） | 同 |
| **live log（SSE）** | runner POST `/log`（HmacCallbackGuard 鉴权） | **API `Log.log(follow:true)` 直读 pod stdout/stderr** |
| **progress%（DB + SSE）** | 同上 | 同上；DB 写经 1Hz trailing throttle |

### 组件图

```
              ┌─────────────────────────────────────────┐
              │            apps/api (single)            │
              │                                         │
              │  K8sJobWatcherService (singleton)       │
              │    handlePodEvent(pod):                 │
              │      reducer.reduce(...) → transition   │
              │      execute(transition):               │
              │        running         → repo.update    │
              │        load-report     → await pool.drainAndStop(5s)
              │                          → void tryLoad │
              │        failed-pre-start / -terminal     │
              │                        → await pool.drainAndStop(0)
              │                          → repo.update  │
              │      [tail]: if phase=Running &&        │
              │              container.ready &&         │
              │              status ∈ {submitted,running}
              │              → pool.start(runId, podName) // idempotent
              │                                         │
              │    handlePodDelete(pod):                │
              │      pool.stop(runId)                   │
              │                                         │
              │  ┌─────────────────────────────────┐    │
              │  │ PodLogStreamerPool (singleton)  │    │
              │  │  Map<runId, PodLogStreamer>     │    │
              │  │  Map<runId, ProgressThrottle>   │    │
              │  │  start / stop / drainAndStop    │    │
              │  │  has / onModuleDestroy(stopAll) │    │
              │  └──┬──────────────────────────────┘    │
              │     │ owns                              │
              │  ┌──▼──────────────────────────────┐    │
              │  │ PodLogStreamer (one per runId)  │    │
              │  │  state: IDLE | STREAMING |      │    │
              │  │         RECONNECTING | STOPPED  │    │
              │  │  k8sLog.log(ns,pod,container,   │    │
              │  │   passthrough, {follow:true,    │    │
              │  │     sinceSeconds:10? on retry}) │    │
              │  │  passthrough → readline → line  │    │
              │  │   → handleLine(line):           │    │
              │  │      adapter.parseProgress(line)│    │
              │  │      → SseHub.publish(runId)    │    │
              │  │      → throttle.tick(pct)       │    │
              │  │  reconnect: backoff [1s,2s,4s]  │    │
              │  │   3 失败 give-up → STOPPED      │    │
              │  └─────────────────────────────────┘    │
              └─────────────────────────────────────────┘
                            │
                            │ HTTP GET (long)
                            ▼
              ┌─────────────────────────────────────────┐
              │  K8s apiserver                          │
              │  /api/v1/namespaces/<ns>/pods/<n>/log   │
              │   ?container=runner&follow=true         │
              └─────────────────────────────────────────┘
```

### 关键不变量

1. **Pool 操作 idempotent**：`start(runId,...)` 已存在 → no-op；`stop(runId)` 不存在 → no-op
2. **watcher 编排顺序**：terminal pod 事件 → `await pool.drainAndStop` → `void reportLoader.tryLoad`。drain 等的是 streamer 自然 EOF（container exit 会让 K8s 关 stream）或最多 5s timeout 强 abort；保证 final log 行在 SSE close 之前被 publish
3. **streamer 不主动跨边界**：parseProgress 异常 try/catch 兜底；reconnect 内部状态机；3 次 give-up 后只 log 不抛
4. **SSE close 仍由 `ReportLoader.tryLoad` 的 `finally` 调**（不变）；drainAndStop 保证此前最后一波 log 已 publish

## 组件细节

### `PodLogStreamerPool`

```ts
// apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts
@Injectable()
export class PodLogStreamerPool implements OnModuleInit, OnModuleDestroy {
  private readonly streamers = new Map<string, PodLogStreamer>();
  private readonly throttles = new Map<string, ProgressThrottle>();

  constructor(
    private readonly factory: PodLogStreamerFactory,
    @Inject(K8S_LOG_CLIENT) private readonly k8sLog: k8s.Log,
    @Inject(K8S_NAMESPACE) private readonly namespace: string,
  ) {}

  async onModuleInit(): Promise<void> {
    // RBAC self-check — see D8
    await this.factory.probeRbac();
  }

  /** Synchronous + idempotent. Caller passes `tool` so factory is sync (no bench lookup race). */
  start(runId: string, podName: string, tool: ToolName): void {
    if (this.streamers.has(runId)) return;
    const throttle = new ProgressThrottle(runId, this.factory.repo, 1000);
    this.throttles.set(runId, throttle);
    const s = this.factory.create(runId, podName, tool, throttle);
    this.streamers.set(runId, s);
    s.run().catch(() => { /* swallowed; streamer logs internally */ });
  }

  stop(runId: string): void {
    const s = this.streamers.get(runId);
    if (!s) return;
    s.abort();
    this.streamers.delete(runId);
    this.throttles.get(runId)?.flushNow();
    this.throttles.delete(runId);
  }

  async drainAndStop(runId: string, timeoutMs: number): Promise<void> {
    const s = this.streamers.get(runId);
    if (!s) return;
    await s.drainOrTimeout(timeoutMs);
    this.streamers.delete(runId);
    await this.throttles.get(runId)?.flushNow();
    this.throttles.delete(runId);
  }

  has(runId: string): boolean { return this.streamers.has(runId); }

  async onModuleDestroy(): Promise<void> {
    for (const [, s] of this.streamers) s.abort();
    this.streamers.clear();
    for (const [, t] of this.throttles) await t.flushNow();
    this.throttles.clear();
  }
}
```

### `PodLogStreamer`

```ts
// apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts
type StreamerState = "IDLE" | "STREAMING" | "RECONNECTING" | "STOPPED";

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
    private readonly k8sLog: k8s.Log,
    private readonly handleLine: (line: string) => void,
    private readonly log: Logger,
  ) {}

  async run(): Promise<void> {
    while (this.state !== "STOPPED" && this.consecutiveFailures < 3) {
      this.state = "STREAMING";
      const passthrough = new PassThrough();
      const rl = readline.createInterface({ input: passthrough, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try { this.handleLine(line); }
        catch (e) { this.log.warn(`handleLine threw for ${this.runId}: ${(e as Error).message}`); }
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
        break;  // clean EOF, done
      } catch (e) {
        this.consecutiveFailures += 1;
        if (this.state === "STOPPED") break;
        this.log.warn(`stream broke for ${this.runId} (attempt ${this.consecutiveFailures}): ${(e as Error).message}`);
        this.state = "RECONNECTING";
        const backoff = [1000, 2000, 4000][this.consecutiveFailures - 1] ?? 4000;
        await sleep(backoff);
      } finally {
        rl.close();
      }
    }
    this.state = "STOPPED";
    this.eof.resolve();
  }

  abort(): void {
    if (this.state === "STOPPED") return;
    this.state = "STOPPED";
    try { this.currentReq?.abort(); } catch { /* request may already be closed */ }
    this.eof.resolve();
  }

  async drainOrTimeout(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) { this.abort(); return; }
    const drained = this.eof.promise.then(() => "drained" as const);
    const timeout = sleep(timeoutMs).then(() => "timeout" as const);
    const r = await Promise.race([drained, timeout]);
    if (r === "timeout") this.abort();
  }
}
```

要点：

- `handleLine` 由 factory 注入；streamer 不知道 tool / SSE / DB，纯 line 转发 + 重连状态机
- `eof` deferred 是 drainOrTimeout 的核心 —— 自然 EOF 或 give-up 都 resolve
- `consecutiveFailures < 3` 上限；`state === STOPPED` 短路 reconnect loop，防止 abort 后又试一次
- `drainOrTimeout(0)` 立即 abort（failed 路径用，因为 stderr.log 已经在 S3 里）

### `PodLogStreamerFactory`

```ts
// apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts
@Injectable()
export class PodLogStreamerFactory {
  constructor(
    readonly repo: BenchmarkRepository,  // exposed for ProgressThrottle ctor
    private readonly sse: SseHub,
    @Inject(K8S_LOG_CLIENT) private readonly k8sLog: k8s.Log,
    @Inject(K8S_NAMESPACE) private readonly namespace: string,
  ) {}

  /** Synchronous — `tool` is passed in (watcher already has bench loaded). */
  create(runId: string, podName: string, tool: ToolName, throttle: ProgressThrottle): PodLogStreamer {
    const adapter = byTool(tool);

    const handleLine = (line: string) => {
      let evt: ProgressEvent | null;
      try { evt = adapter.parseProgress(line); }
      catch { evt = { kind: "log", level: "warn", line }; }
      if (!evt) return;
      this.sse.publish(runId, evt);
      if (evt.kind === "progress") throttle.tick(evt.pct);
    };

    return new PodLogStreamer(
      runId, podName, RUNNER_CONTAINER_NAME, this.namespace,
      this.k8sLog, handleLine, new Logger(`PodLogStreamer:${runId}`),
    );
  }

  /** Boot-time RBAC probe — see D8. Resolves on 404 (RBAC OK), rejects on 403. */
  async probeRbac(): Promise<void> {
    const sink = new Writable({ write(_c, _e, cb) { cb(); } });
    try {
      await this.k8sLog.log(this.namespace, "__rbac-probe__", RUNNER_CONTAINER_NAME, sink, { follow: false });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/403|forbidden/i.test(msg)) {
        throw new Error(`PodLogStreamerPool: RBAC missing pods/log:get in ns=${this.namespace}: ${msg}`);
      }
      // 404 or transient apiserver error → log but continue
    }
  }
}
```

### `ProgressThrottle`

```ts
// apps/api/src/modules/benchmark/k8s/progress-throttle.ts
export class ProgressThrottle {
  private pendingPct: number | null = null;
  private lastWriteAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runId: string,
    private readonly repo: BenchmarkRepository,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tick(pct: number): void {
    this.pendingPct = pct;
    const elapsed = this.clock() - this.lastWriteAt;
    if (elapsed >= this.windowMs) {
      void this.flushNow();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flushNow(), this.windowMs - elapsed);
    }
  }

  async flushNow(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pendingPct === null) return;
    const pct = this.pendingPct;
    this.pendingPct = null;
    this.lastWriteAt = this.clock();
    try { await this.repo.update(this.runId, { progress: pct }); }
    catch (e) { /* log only; progress is best-effort */ }
  }
}
```

### `K8sJobWatcherService.execute()` 改造

```ts
// 当前 (Phase 2)：
case "load-report":
  void this.deps.reportLoader.tryLoad(runId);
  return;

case "failed-pre-start":
case "failed-terminal":
  await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {...});
  return;

// Phase 3：
case "load-report":
  await this.deps.pool.drainAndStop(runId, 5000);  // 等 streamer 自然 EOF up to 5s
  void this.deps.reportLoader.tryLoad(runId);
  return;

case "failed-pre-start":
case "failed-terminal":
  await this.deps.pool.drainAndStop(runId, 0);     // 立即 abort
  await this.deps.repo.updateGuarded(runId, IN_PROGRESS_STATES, {...});
  return;
```

`handlePodEvent()` 末尾追加 attach-streamer 守卫：

```ts
private async handlePodEvent(pod: V1Pod): Promise<void> {
  // ... (existing reduce + execute logic) ...
  await this.execute(runId, transition, now);

  // Phase 3: idempotent attach. Informer replay on startup gives us free bootstrap.
  if (this.deps.mode === "primary"
      && pod.status?.phase === "Running"
      && getRunnerStatus(pod)?.ready === true
      && (bench.status === "submitted" || bench.status === "running")) {
    this.deps.pool.start(runId, pod.metadata!.name!, bench.tool as ToolName);
  }
}

private handlePodDelete(pod: V1Pod): void {
  const runId = this.extractRunId(pod);
  if (!runId) return;
  this.firstFatalWaitingAt.delete(runId);
  this.firstTerminalAt.delete(runId);
  this.deps.pool.stop(runId);  // Phase 3
}
```

### RBAC 启动 self-check

`PodLogStreamerPool.onModuleInit()`（**新加** hook）：boot 时调一次 `k8sLog.log(ns, '__rbac-probe__', RUNNER_CONTAINER_NAME, /*discard*/)`。预期返 403/404：

- **404**（pod 不存在）→ RBAC OK，启动继续
- **403** → boot fail，log 明确 RBAC 缺 `pods/log:get`
- 其他错误 → log 警告但启动继续（apiserver 短暂不可用）

避免运行时第一个真实 streamer 才发现 RBAC 漏配。

## 代码面变更（精确清单）

### 删

| 文件 / 符号 | 备注 |
|---|---|
| `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts` | 整文件 |
| `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.spec.ts` | 整文件 |
| `apps/api/src/modules/benchmark/callbacks/` | 空目录 |
| `apps/api/src/common/hmac/hmac-callback.guard.ts` | 整文件 |
| `apps/api/src/common/hmac/hmac-callback.guard.spec.ts` | 整文件 |
| `apps/api/src/common/hmac/hmac-token.ts` | 整文件（grep 复核仅 guard 用） |
| `apps/api/src/common/hmac/hmac-token.spec.ts` | 整文件 |
| `apps/api/src/common/hmac/` | 空目录 |
| `packages/contracts/src/benchmark.ts` 中 `benchmarkLogCallbackSchema` + `BenchmarkLogCallback` 类型 | 文件保留 |
| `apps/api/src/config/env.schema.ts` 中 `BENCHMARK_CALLBACK_SECRET` | 字段删 + 不再 require |
| `apps/benchmark-runner/runner/callback.py` | 整文件 |
| `apps/benchmark-runner/tests/test_callback.py` | 整文件 |
| Job manifest `MD_CALLBACK_URL` env / per-run Secret `MD_CALLBACK_TOKEN` | 见 §改 |

### 改

| 文件 | 改动 |
|---|---|
| `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts` | 删 `MD_CALLBACK_URL` env（L65）；`buildSecretManifest` 删 `MD_CALLBACK_TOKEN: ctx.callback.token`（L40） |
| `apps/api/src/modules/benchmark/k8s/k8s-job-manifest.spec.ts` | 同步删 envs / secretEntries 断言 |
| `apps/api/src/modules/benchmark/k8s/k8s-benchmark-runner.ts` | `BenchmarkRunInput` 删 `callback` 字段；不再生成 token |
| `apps/api/src/modules/benchmark/benchmark.service.ts` | grep 删 `signCallbackToken(...)` 调用与传参（若有） |
| `apps/api/src/modules/benchmark/benchmark.module.ts` | controllers 数组删 `BenchmarkCallbackController`；providers 加 `PodLogStreamerPool` + `PodLogStreamerFactory` + `K8S_LOG_CLIENT` / `K8S_NAMESPACE` token；useFactory `K8sJobWatcherService` 多注入 `PodLogStreamerPool`；`mode=off` 分支构造一个 no-op pool stub（`start/stop/drainAndStop` 全 no-op） |
| `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.ts` | `WatcherDeps` 加 `pool: PodLogStreamerPool`；`execute()`：terminal 两种 case 改成 `await pool.drainAndStop(runId, 5000 or 0)` 后再走原逻辑；`handlePodEvent` 末尾追加 idempotent `pool.start(runId, podName)`；`handlePodDelete` 加 `pool.stop(runId)` |
| `apps/api/src/modules/benchmark/k8s/k8s-job-watcher.service.spec.ts` | 加 attach-streamer 调用断言；改 terminal 序列断言；加 pod-delete → stop 断言 |
| `apps/benchmark-runner/runner/main.py` | 删 `callback_url` / `token` 读取（L205-206）；`StreamPump` 构造去掉 `callback_url` / `token` / `benchmark_id`；删 `LOG_BATCH_INTERVAL_SEC` 节流变量；`StreamPump._flush()` 删；`StreamPump.run` 简化为纯 buffer append（不再 batch 触发 POST） |
| `apps/benchmark-runner/tests/test_main.py` | 删 callback-related 断言；StreamPump 测试改成只验本地 buffer + 截尾 |
| `deploy/k8s/rbac.yaml` | pods Role rule 拆成两条：`pods: get,list` + `pods/log: get` |

### 新增

| 文件 | 概述 |
|---|---|
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer.ts` | 状态机 + 重连 |
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer.spec.ts` | EOF / reconnect / give-up / abort / drainOrTimeout 五条路径 |
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.ts` | pool + onModuleInit self-check + onModuleDestroy |
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer-pool.spec.ts` | idempotent start / drainAndStop 顺序 / RBAC probe |
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.ts` | resolve bench → tool → handleLine 闭包 |
| `apps/api/src/modules/benchmark/k8s/pod-log-streamer-factory.spec.ts` | parseProgress throw 兜底 / progress vs log event 分流 |
| `apps/api/src/modules/benchmark/k8s/progress-throttle.ts` | 1Hz trailing throttle |
| `apps/api/src/modules/benchmark/k8s/progress-throttle.spec.ts` | 连续 tick 合并 / timer flush / flushNow |
| `apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts` | fixture：mock `k8s.Log` 返 PassThrough → SSE 收 + DB progress 1Hz |

## 关键设计决策

### D1 — 断流重连：`sinceSeconds=10` 重叠，**不去重**，3 次 give-up

**决策**：streamer error → 指数退避 [1s, 2s, 4s] → reconnect 时传 `sinceSeconds=10` → SSE 偶发 dup line 接受。3 次连续失败 → STOPPED。

**为什么**：
- `Log.log` 没自带 reconnect，必须手写
- 不开 `timestamps:true` 让 adapter `parseProgress` 保持纯函数（开了的话每行多 30 字符 RFC3339 前缀要剥）
- dup line 落到 SSE 的最坏情况：同一条 progress 报两次 → 前端进度条 monotonic 无感
- 3 次 give-up 防止 zombie streamer 一直试

**代价**：apiserver 长时间不可用时本次 run 的剩余时间没 live log；终态正确性由 Phase 2 storage 路径兜底（status 翻 `completed` 后 UI 据此判定 100%，progress 字段最后值即 throttle 在 drainAndStop 前 flush 的值）。

### D2 — Progress DB 写 1Hz trailing throttle

**决策**：`ProgressThrottle.tick(pct)` 收每行 progress，trailing 1Hz 写 DB；终态前 `flushNow()` 强写。

**为什么**：
- 今天 callback batch ~250ms 写一次；换 Log.log 后逐行可能 20+/s，必须节流
- 1s window 让 bootstrap 路径（用户刷新页面读 DB row）最差 stale 1s，肉眼无感
- DB 写降到 ≤ 1/s/run

**代价**：进度条更新最差延迟 1s（SSE 仍逐行实时，只是 DB 慢一拍）。

### D3 — 终态串行：`await pool.drainAndStop` → `void tryLoad`

**决策**：watcher 在 terminal pod 事件上**显式串行**两步：先等 streamer drain（terminal up to 5s / failed 立即 abort），再触发 ReportLoader。

**为什么**：
- streamer 喂 SSE / ReportLoader.tryLoad 的 `finally` 关 SSE → race：tryLoad 可能在 streamer drain 完最后几行之前关 SSE
- 让 watcher 显式编排比把 ReportLoader 触发塞进 streamer 内部回调更可读，依赖图单向（watcher → pool / watcher → reportLoader）
- 5s 上限：containers exit 后 K8s Log stream 在 ~ms 内 EOF；5s 是给 apiserver 抖留的兜底
- failed 给 0s：失败状态下 stderr 已经在 S3 stderr.log 里，没必要等

**代价**：terminal status flip 比今天晚 0-5s。可接受。

### D4 — line-split：主线程 `readline.createInterface` + `PassThrough`

**决策**：`k8sLog.log(...)` 写 PassThrough，PassThrough 喂 readline，readline emit 'line' 同步调 handleLine。

**为什么**：
- 每行处理 µs 级（regex match + JSON.parse 最多 1 次）；100 concurrent run × 20 行/s = 2000 行/s，主线程 < 1% CPU
- worker_threads 每个 worker ~1MB heap × 100 = 100MB，反而费
- readline 是 stdlib，buffer 切分 bug 不用自己写

**代价**：parseProgress 抛异常需 try/catch 兜底（factory `handleLine` 闭包已做）。

### D5 — Pool 独立，watcher 调；attach 靠 informer replay 不靠 reconciler

**决策**：
- `PodLogStreamerPool` 独立 service，watcher 在 execute()/handlePodEvent 末尾调
- API 启动后，informer 启动会 replay snapshot → 每个已 Running pod 走 handlePodEvent → 守卫满足时 idempotent `pool.start` → bootstrap 自动完成
- `StartupReconciler` 不动

**为什么**：
- watcher 已负责"状态翻转 + ReportLoader 触发"，再背 streamer 池会变大杂烩
- 独立 pool 便于单测：mock pool 验 watcher 调对了，再独立测 pool 的 reconnect / drain 行为
- informer 启动天然 replay snapshot，免写 reconciler 并行逻辑

**代价**：API 重启 → informer replay → handlePodEvent → attach 之间有 ~秒级 gap，这段时间产生的 log 行丢（不进 SSE，但 stdout.log 终态在 S3 里）。

### D6 — `BENCHMARK_CALLBACK_SECRET` 整套删

**决策**：env.schema.ts 删字段；所有 fixture / docker-compose / k8s example 同步删。

**为什么**：HmacCallbackGuard 整删后这个 env 再无消费者；留着 forward-compat 是技术债。

**代价**：旧 deploy 的 K8s Secret 里这个 key 留着无害（API 不读了），下次 secret 更新清掉即可。

### D7 — RBAC：pods 和 pods/log 拆两条 rule

**决策**：

```yaml
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
```

**为什么**：K8s 风格里 `pods` 和 `pods/log` verb 集合不同（log 只支持 get），拆两条更符合社区惯例 + 更易审计。

### D8 — Pool RBAC self-check on boot

**决策**：`PodLogStreamerPool.onModuleInit()` 调一次 `k8sLog.log(ns, '__rbac-probe__', RUNNER_CONTAINER_NAME, discardWritable)`；404 OK / 403 boot fail。

**为什么**：避免运行时第一个真实 streamer 才暴露 RBAC 漏配；K8s 客户端的 403 错误信息明确，boot fail 比"全部 run 没 live log"易诊断。

**代价**：boot 时多一次 apiserver round-trip（< 50ms）。

## 测试策略

### 单测（vitest）

- **`pod-log-streamer.spec.ts`** —— 五条路径：
  1. 正常 EOF：mock `k8sLog.log` resolve PassThrough，写 3 行 + `passthrough.end()` → handleLine 收 3 次 + eof resolve
  2. 1 次 error 后 reconnect 成功：先 `passthrough.emit('error')` → 等 1s → 第二次 `k8sLog.log` resolve 干净 EOF → 验 `sinceSeconds:10` 传入 + 1 次 reconnect
  3. 连续 3 次 error give-up：验 k8sLog.log 被调 3 次后 eof resolve + state=STOPPED
  4. abort 切断：streaming 中调 abort → 验 `currentReq.abort()` 调用 + 不再 reconnect
  5. drainOrTimeout：流不闭合 → 验 timeout 后强 abort + resolve
- **`pod-log-streamer-pool.spec.ts`** ——
  - `start` 重复调 idempotent
  - `drainAndStop` 顺序：先 eof / timeout → 再删 Map → `has` 返 false → throttle.flushNow 调
  - `stop` 不等 drain，立刻 abort + throttle flush
  - `onModuleInit` RBAC probe：mock 404 → 启动 OK；mock 403 → 抛
  - `onModuleDestroy` 清所有
- **`progress-throttle.spec.ts`** ——
  - 连续 10 次 tick 同一秒内 → repo.update 只 1 次
  - timer 到点 flush
  - `flushNow()` 强写并清 timer
- **`pod-log-streamer-factory.spec.ts`** ——
  - resolve bench → tool → adapter
  - handleLine：parseProgress → progress → sse + throttle；log event → sse only；parseProgress throw → fallback `{kind:"log", level:"warn", line}`
- **`k8s-job-watcher.service.spec.ts`** —— Phase 3 增量：
  - Running pod（container ready，bench=submitted） → 验 `pool.start` 调用
  - Running pod（已 attached）→ `pool.start` 仍调（idempotent，pool 内部去重）
  - Succeeded pod → 序列：`pool.drainAndStop(5000)` → `void tryLoad`
  - Failed pod → 序列：`pool.drainAndStop(0)` → `repo.updateGuarded`
  - Pod delete event → `pool.stop` 调

### e2e API（vitest + supertest）

- **`apps/api/test/e2e/benchmark-pod-log-stream.e2e-spec.ts`**：
  1. 启 test API（`K8S_WATCHER_MODE=primary` 显式）
  2. nock 拦截 K8s apiserver list+watch（复用 Phase 1/2 fixture 工具）
  3. mock `k8s.Log` 实例：`.log()` 返我们控制的 PassThrough
  4. fixture：写 `submitted` benchmark；K8s watch 返 Running pod（container ready）
  5. 验：`pool.start` 触发 → `Log.log` 调；推几行 progress 文本进 PassThrough（按某 adapter format）
  6. 订阅 `GET /benchmarks/:id/sse`，验：收到 progress event；DB row `progress` 在 1Hz 节流后到达期望值
  7. 推 `passthrough.end()` 模拟 container exit → K8s watch 切到 Succeeded → S3 mock 返 result fixture → 验最终 `status=completed` + `progress=1`
- 删 `benchmark-callback.controller.spec.ts` 整文件
- 删任何指 `/internal/benchmarks/:id/log` 的 e2e

### Runner pytest

- 删 `tests/test_callback.py`
- `tests/test_main.py` 改：删 mock POST 断言；StreamPump 测试改成只验本地 buffer + 截尾

### Browser e2e（playwright）

- 现有 `e2e/benchmark.spec.ts` 应该零修改通过 —— SSE 协议 + UI 行为对外一致
- 加：deploy 后 dev MinIO + dev K8s 跑一遍真实 benchmark e2e（不在 CI；docs 描述 ops manual smoke）

## Risks

| Risk | 等级 | 缓解 |
|---|---|---|
| K8s apiserver 抖致 stream 大量断 → reconnect 风暴 | M | 指数退避 [1,2,4]s + 3 次 give-up；按 runId 限频日志；prom counter `benchmark_log_stream_giveup_total` |
| `Log.log` 内部 request 库挂起不 close → drainOrTimeout 必触 5s | M | 5s 上限本身即兜底；超时强 abort；counter `benchmark_log_drain_timeout_total` |
| 100 个 concurrent run → 100 个 long-lived HTTP conn 打 apiserver | M | apiserver 默认支持千级 watch；V1 不加 `MAX_CONCURRENT_STREAMERS` cap，未来按需引入 |
| RBAC 没及时加 pods/log → 所有 streamer 起步即 403 | H | onModuleInit self-check 探一次；403 → boot fail；alert：`benchmark_log_stream_unauthorized_total` |
| 旧 runner 镜像 deploy 期间还在跑 → POST /log 撞 404 | L | callback.py 现状 swallow HTTP 错误；runner 仍正常完 + 写 S3；只是 SSE 端没数据；可接受 |
| ProgressThrottle 在 streamer 异常 abort 时漏 flush 最终 pending pct | L | abort / drainAndStop 两路径都调 `throttle.flushNow()`；onModuleDestroy 同样 |
| readline buffer 累积超大单行（无 \n） → 内存涨 | L | adapter 输出均为有界单行；如担心可加 max-line-len，但 V1 不做 |
| `BENCHMARK_CALLBACK_SECRET` 删后某 e2e fixture 还引用 → boot fail | L | grep + 删后 `pnpm test:e2e:api` 跑一遍验 |

## Migration / Rollout

**Pre-deploy（运维侧）**：
1. 在 `modeldoctor-benchmarks` namespace 上 apply 修订后的 `rbac.yaml`（pods/log 加 get）—— **必须先做**，新 API 起来即 boot fail（D8 self-check）
2. 等当前 in-flight benchmark 完成 / cancel
3. （可选）确认 K8s Secret 里 `BENCHMARK_CALLBACK_SECRET` 留着无害；下次 secret 更新清掉

**Deploy**：
1. 推新 runner image 到 registry
2. 部署新 API

**Post-deploy 监控（第一周）**：
- `benchmark_log_stream_giveup_total`（应 ≈ 0）
- `benchmark_log_drain_timeout_total`（应 ≈ 0）
- `benchmark_log_stream_unauthorized_total`（必 0，非 0 即 RBAC 漏 apply）
- apiserver watch + log conn 数 vs concurrent benchmarks 数（应基本 1:1 + 1）

**回滚**：无降级路径 —— atomic 重写。出严重 bug → git revert + 重部署旧 image。RBAC 多给的 pods/log 权限留着无害不用回滚。

## Accepted trade-offs

| Trade-off | 理由 |
|---|---|
| 断流时 SSE 偶发 dup line | UI 进度条 monotonic 无感（D1） |
| Progress DB 最坏 stale 1s | bootstrap 路径肉眼无感（D2） |
| Terminal flip 比今天晚 0-5s（等 drainAndStop） | 换日志 → final report 顺序正确（D3） |
| 每 run 一个长 HTTP conn 打 apiserver | 标准 kubectl logs -f 形态，设计支持 |
| 删 `BENCHMARK_CALLBACK_SECRET` + HmacCallback 整套 | 彻底重写口径，无 deprecated；旧 runner POST /log 撞 404 swallowed 无副作用 |
| API 重启 → informer replay → attach 之间秒级 gap | 这段时间 log 行丢 SSE，stdout.log 终态在 S3 |

## Phase 4 路标

- runner 镜像净化：`requirements.txt` 把 `requests` 依赖删（callback.py 删后是否还有其他 import 复核）
- docs 同步：`docs/api-runner-contract.md`（如有）/ K8s deploy README / runtime env 表
- umbrella issue #237 把 Phase 3 / Phase 4 checkbox 标完，关 issue

## References

- Phase 1 spec：`docs/superpowers/specs/2026-05-25-watch-based-runner-status-design.md`
- Phase 1 PR：[#238](https://github.com/weetime/modeldoctor/pull/238)
- Phase 2 spec：`docs/superpowers/specs/2026-05-25-report-storage-and-watcher-primary-design.md`
- Phase 2 PR：[#239](https://github.com/weetime/modeldoctor/pull/239)
- Tracking issue：[#237](https://github.com/weetime/modeldoctor/issues/237)
- Roadmap umbrella：[#189](https://github.com/weetime/modeldoctor/issues/189)
- `@kubernetes/client-node@0.21` Log API：`dist/log.d.ts`（`Log.log(ns, pod, container, Writable, opts)`）
- K8s RBAC `pods/log`：https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- Node `readline.createInterface`：https://nodejs.org/api/readline.html
