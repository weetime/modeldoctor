# Agent 评测断点续跑(MinIO checkpoint + 手动 resume)— 设计文档

- 日期:2026-07-07
- 分支:`feat/agent-eval-resume`
- Issue:[#350](https://github.com/weetime/modeldoctor/issues/350)
- 范围:让 **tau3(τ³-bench)Agent 评测**的长跑 Job 在 pod 死亡(eviction / OOM / 节点丢失)后**不丢已完成的 episodes**——runner 定期把 tau3 的增量结果目录 checkpoint 到 MinIO,pod 死后 run 标为 `interrupted`,用户手动「继续」→ 同 runId 重提交 Job → restore checkpoint + `--auto-resume` 接着跑。**不动** guidellm/aiperf/evalscope/vegeta(它们是分钟级压测,业内本就不做续跑,验证见 §2)。

---

## 1. 问题

Agent 评测的 **Full 档**是 3 domain 全任务集(50/114/114)× 4 trials ≈ **1000+ episodes、小时级**。今天的执行模型(PR #349 已落):

- K8s Job `backoffLimit: 0` + `restartPolicy: Never` → **一个 pod、永不重试**;pod 死了直接标 `failed`。
- 所有输出**只在子进程退出后**写(`result.json` 是完成 sentinel);pod 中途死 → MinIO 里只剩一个早期的 `meta.json`,**已完成的几百个 episodes 全部丢失**。
- 唯一的「re-run」是新建一行(新 runId + 新 S3 前缀),**从零重跑**。

对小时级 + 大量 token 的 Full 跑,半夜节点重启一次就白烧几小时。

## 2. 为什么只做 tau3(YAGNI)

断点续跑只对「工具自己能从磁盘增量状态续跑」有意义。**已验证其余工具都不满足**(研究见 issue #350 讨论):

| 工具 | 性质 | 增量落盘 | resume flag | 结论 |
|---|---|---|---|---|
| **tau3** | 小时级、离散 per-episode agent eval | 是(`data/simulations/<runId>_<domain>/`) | `--auto-resume`(已传,`packages/tool-adapters/src/tau3/build-command.ts`) | **可续** |
| guidellm | 分钟级 load/perf | 否(仅末尾 report.json) | 无 | 不可续 |
| aiperf | 分钟级 load/perf | 否 | 无 | 不可续 |
| evalscope | 我们用的是 `evalscope perf`(压测),非 `eval` | 缓 SQLite 无 reload | 无(`--use-cache` 只属 `eval`,未用) | 不可续 |
| vegeta | 分钟级 HTTP 压测 | 流式 attack.bin,不可 seed | 无 | 不可续 |

业内共识:**性能/负载测试不做续跑**(挂了重跑,分钟级成本极低);**eval/agent 评测的续跑智能在工具里**(lm-eval `--use_cache`、τ³ `--auto-resume`),编排层只需保证工具的缓存目录别丢。tau3 已有「聪明的那一半」,我们只补「让目录在 pod 死后还在」。

**不做通用 opt-in 框架**——今天只有一个受益者;用一个极小的通用接缝(`ToolAdapter.checkpointDir`),以后真出现第二个可续工具再抽象。

## 3. 已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 存储 | **MinIO checkpoint/restore**,非 PVC | 抗节点丢失/抗抢占的云原生标准做法;贴合项目「持久态全进 MinIO」范式;跨集群(k3d/ascend/OSS)。RWO PVC 节点一死卷 stranded(k3d 默认 `local-path` 就是 RWO 节点本地),恰恰在目标场景失效;RWX 需集群没有的 StorageClass。 |
| 触发 | **手动 resume**(用户点「继续」),非 K8s 全自动重试 | 贴业内 eval-harness re-run 路子;避免在编排层重造工具本该负责的事。全自动(backoffLimit>0 + signal 退出语义 + Job-aware reducer)复杂度大一个数量级,YAGNI。 |
| resume 身份 | **同 runId 重提交 Job**(非新建行) | tau3 `--save-to <runId>_<domain>` 按 runId 命名;同 runId 才能让 restore 的目录被 `--auto-resume` 认出;省掉 resumeKey 传播。row 生命周期允许 `interrupted → running`。 |
| 范围边界 | tau3-scoped,靠 `checkpointDir` gating,非 tau3 零变更 | blast radius = 0。 |

## 4. 设计

### 4.1 Adapter 接缝 — 唯一 source of truth

`ToolAdapter` 接口(`packages/tool-adapters/src/core/interface.ts`)加静态可选字段:

```ts
/**
 * cwd-relative 目录,工具往里写「可续跑」的增量状态。存在即声明该工具支持
 * 断点续跑:runner 会定期 checkpoint 该目录到 MinIO,并在 MD_RESUME 时先 restore。
 * 目录名必须相对 runId 稳定(见 tau3 的 --save-to <runId>_<domain>,restore 后
 * --auto-resume 靠同 runId 匹配)。null/缺省 = 工具不可续,行为完全不变。
 */
readonly checkpointDir?: string;
```

tau3 adapter(`runtime.ts`)设 `checkpointDir = "data/simulations"`(CWD=/opt/tau2 → 解析到 `TAU2_DATA_DIR/simulations`,覆盖所有 domain 的 `<runId>_<domain>/`)。其余四个适配器不设。

### 4.2 Job manifest

`apps/api/src/modules/benchmark/k8s/k8s-job-manifest.ts`——当 `byTool(tool).checkpointDir` 有值时,额外注入 env:
- `MD_CHECKPOINT_DIR` = `checkpointDir`(runner 靠它是否存在决定是否激活);
- `MD_CHECKPOINT_INTERVAL_SEC`(默认 60,可由 env 覆盖);
- `MD_RESUME` = `"1"` **仅当**本次是 resume 启动(见 §4.6)。

`backoffLimit: 0` 与 `restartPolicy: Never` **不变**(无 K8s 自动重试)。非可续工具:不注入这些 env,manifest 与今天逐字相同。

### 4.3 runner S3 下载能力

`apps/benchmark-runner/runner/s3_writer.py` 今天**只写**(`put_json`/`put_text`/`put_file`)。新增(同一个已认证 boto3 client,零新凭证):
- `list_keys(prefix) -> list[str]` — 分页 `list_objects_v2`;
- `download_prefix(prefix, local_dir) -> int` — 列 + 逐个 `download_file` 到 `local_dir`(按 key 相对 prefix 的路径重建子目录);返回下载文件数。

读侧今天在 API 的 TS 层(`storage/s3-report-storage.ts`);这里给 **runner** 加读能力用于 restore。

### 4.4 runner checkpoint/restore 线程

`apps/benchmark-runner/runner/main.py`,全部 gated on `MD_CHECKPOINT_DIR` 非空:

1. **Restore(起子进程前)**:若 `MD_RESUME == "1"`,`s3.download_prefix(f"{runId}/checkpoint/", <MD_CHECKPOINT_DIR 解析成的绝对路径>)`。首个 attempt(非 resume)不下载。日志记录恢复了几个文件。
2. **Checkpoint 线程(起子进程后)**:一个 daemon 线程,每 `MD_CHECKPOINT_INTERVAL_SEC` 秒把 `MD_CHECKPOINT_DIR` 目录树上传到 `f"{runId}/checkpoint/"`(遍历文件,`put_file` 已支持 multipart)。用 `threading.Event` 控制停止。
3. **收尾**:子进程退出后,先停线程,再做**一次最终 checkpoint 上传**(补齐最后一个 interval 的 episodes),然后照今天的流程写 outputFiles / stdout / stderr / result.json。
4. **退出语义不改**:仍以子进程退出码退出(手动 resume 无 K8s 重试,不需要区分 infra-death vs 真失败)。

轻量优化(非必须,可 V1 就做):checkpoint 时只上传 mtime 晚于上次 checkpoint 的文件,避免每轮重传未变的 domain。首版可先全量上传,数据量小(每 domain 一个 results.json)。

### 4.5 `interrupted` 状态

`benchmarkStatusSchema`(`packages/contracts/src/benchmark.ts`)加值 `"interrupted"`。`Benchmark.status` 是 **String 列**(schema.prisma:139)→ **无 Prisma migration**。

判定(`apps/api/src/modules/benchmark/k8s/pod-state-reducer.ts` + `benchmark-reconciler.ts`):当一个 run **可续跑**(`byTool(bench.tool).checkpointDir` 有值)且 pod 到达 `Failed`/无 pod **且无 `result.json`** → 标 `interrupted`(而非今天的 `failed`)。非可续跑 run → 仍 `failed`(逐字不变)。`result.json` 存在仍一律走 `load-report`(completed/gate,不变)——续跑完成的 run 正常出报告。

> reducer 拿 `checkpointDir` 判定:通过 `byTool(bench.tool)` 静态查(adapter registry),不需要 benchmark 行上加列。

### 4.6 resume 触发

- **API**:`POST /benchmarks/:id/resume`(`benchmark.controller.ts` + service)。校验:目标 run `status === "interrupted"` 且 `byTool(tool).checkpointDir` 有值,否则 400。动作:给**同一行、同 runId** 重提交 Job(复用 `K8sBenchmarkRunner.start()`,manifest 带 `MD_RESUME=1`),`status` 置回 `pending`(与首次启动同路径,由 watcher 驱动到 `running`),`driverHandle` 更新为新 Job handle。旧 Job 已死(pod gone),新 Job 名带新随机后缀不撞名;`ttlSecondsAfterFinished` 会 GC 旧 Job/Secret。
- **service 允许 re-start**:今天 `start()` 假设一行一 Job;这里允许 `interrupted` 行再次 `start()`。用 `updateGuarded(runId, ["interrupted"], {...})` 守住并发(只有 interrupted 能被 resume)。
- **Web**:`interrupted` 的 agent run 在详情页/列表页显示「继续」按钮(复用现有 action 列约定 + AlertDialog 二次确认可选),调 resume endpoint。状态 badge 加 `interrupted` 配色(琥珀/中性,区别于 failed 的红)。

### 4.7 报告 — 零改动

续跑完成后,`data/simulations` 里是(restore 的旧 episodes + 本次新完成的)完整集合;`md_tau3_summarize.py` 读全量目录产出 `summary.json`,与一次跑完的完全一致。summarizer / report-loader / AgentReport **不需要改**。

## 5. 失败边界

- **续跑又挂** → 再 `interrupted` → 再点「继续」(幂等;checkpoint 在同 `<runId>/checkpoint/` 累积)。无自动重试,故无无限循环,由用户决定放弃。
- **checkpoint 上传失败**(S3 抖动)→ 下个 interval 重试;最坏丢一个 interval(≤60s)的 episodes,续跑时由 `--auto-resume` 重跑。
- **死在头 60s 内**(还没 checkpoint)→ restore 空/少 → tau3 ≈ 从头。可接受(损失有界)。
- **restore 的 results.json 被截断**(上传中途 pod 死):`put_file` 是单文件原子 upload,不会写半个 object;最坏是「上个完整 checkpoint」缺最后一轮,tau3 `--auto-resume` 读的是完整 JSON。若极端下某文件损坏,tau3 自身 loader 报错 → run `failed`(非无限)。
- **非可续工具**:全程不注入 checkpoint env,`interrupted` 判定不触发,行为逐字不变。

## 6. 本期范围 / YAGNI

**做**:tau3 checkpoint/restore + `interrupted` 状态 + 手动 resume(同 runId)+ web 按钮。

**不做(往后)**:
- 全自动 K8s 重试(backoffLimit>0 + signal 退出语义 + Job-aware reducer)——除非明确要无人值守。
- 通用 opt-in checkpoint 框架——等第二个可续工具出现。
- checkpoint 增量 diff 优化的复杂版(mtime 全量足够)。
- resume 次数上限 / 自动放弃策略(手动触发,用户自控)。
- 跑到一半的可视化进度条(现有 progress 机制不变)。

## 7. 测试

- **s3_writer**(pytest):`list_keys` 分页;`download_prefix` 重建子目录 + 返回计数(mock boto3 / 或 minio fixture)。
- **runner**(pytest):`MD_RESUME=1` 时起子进程前调 download_prefix;checkpoint 线程按 interval 调 put_file(用短 interval + fake clock/event);收尾做最终上传;**`MD_CHECKPOINT_DIR` 未设时完全不激活**(非 tau3 零变更断言)。
- **adapter**(vitest):tau3 `checkpointDir === "data/simulations"`;其余四个 `checkpointDir` 为 undefined。
- **manifest**(vitest):可续 run 注入 `MD_CHECKPOINT_DIR`/`MD_CHECKPOINT_INTERVAL_SEC`;resume 加 `MD_RESUME=1`;非可续 run manifest 不含这些 env(快照/断言)。
- **reducer/reconciler**(vitest):可续 run pod-Failed-无result → `interrupted`;非可续 → `failed`(回归);有 result → `load-report`(回归)。
- **resume endpoint**(vitest):interrupted+可续 → 重提交同 runId + MD_RESUME;非 interrupted 或不可续 → 400;并发二次 resume 被 `updateGuarded` 挡。
- **web**(vitest):interrupted 显示「继续」按钮并调 endpoint;其它状态不显示。
- **手动 e2e**:tau3 Smoke 跑到一半 `kubectl delete pod` → run 变 `interrupted` → 点「继续」→ restore + `--auto-resume` → 完成且 episodes 无重复丢失(比对 summary 的 tasks 数)。

## 8. 落地顺序(供 writing-plans)

1. `s3_writer.py` 下载能力 + 测试(纯底座,无依赖)。
2. Adapter `checkpointDir` 字段 + tau3 设值 + registry/接口 + 测试。
3. runner checkpoint/restore 线程 + 收尾 + gating + 测试。
4. Job manifest 注入 checkpoint env(+ resume 的 MD_RESUME)+ 测试。
5. `interrupted` 状态 + reducer/reconciler 判定 + 测试。
6. resume endpoint(service 允许 re-start 同 runId)+ 测试。
7. web「继续」按钮 + interrupted badge + 测试。
8. 手动 e2e 冒烟(需真实集群 + tau3 镜像)。
