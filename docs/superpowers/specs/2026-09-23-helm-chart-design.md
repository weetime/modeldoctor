# ModelDoctor Helm Chart 与发行工程 — 设计文档

- 日期：2026-09-23
- 范围：新增 `deploy/charts/modeldoctor` Helm chart、离线交付包、应用镜像的多架构构建与 release 流水线，以及三处让部署成立的必要代码改动。目标是客户现场私有化交付：拿到包就能在一个 K8s 集群里装起来。
- 镜像仓库：华为云 SWR `swr.cn-north-4.myhuaweicloud.com`，组织 `modeldoctor`。**凭据只进 GitHub Secrets 和本地 `docker login`，不进仓库任何文件。**

---

## 1. 现状核实（全部读源码确认，非推测）

| 事实 | 出处 | 对 chart 的影响 |
|---|---|---|
| api 与 web 是**同一个镜像、同一个进程**：Nest 用 `ServeStaticModule` 托管 `apps/web/dist` | `apps/api/src/app.module.ts:62-78`；根 `Dockerfile` 单镜像三阶段 | 只有一个 Deployment；没有 nginx、没有独立 web 镜像 |
| 该静态托管**只在 `NODE_ENV=production` 时注册**，且 `rootPath` 基于 `process.cwd()` | 同上 | `NODE_ENV=production` 是硬要求；不得覆盖 Pod 的 `workingDir`（镜像 `WORKDIR /app`） |
| 前端全部走**同源相对路径**，无任何 `VITE_API_*` | `apps/web/src/lib/api-client.ts` | 镜像与环境无关；但 UI 和 API 必须同一个 origin，Ingress 不能拆 host |
| 监听端口 3001，全局前缀 `api` | `apps/api/src/main.ts:16,58-59`；`Dockerfile` `EXPOSE 3001` | Service 目标端口 3001 |
| 健康检查只有 `GET /api/health`，`@Public()`，只探 Postgres，超时 500ms | `apps/api/src/modules/health/health.controller.ts` | 适合做 readiness；**不适合做 liveness**（DB 抖动会导致重启） |
| 应用镜像 CMD 是 `prisma migrate deploy && node apps/api/dist/main.js` | 根 `Dockerfile:74` | 迁移要从 CMD 移到 Helm hook Job |
| `prisma db seed` = `tsx prisma/seed.ts`，而 **`tsx` 是 devDependency**，运行时镜像只装 `--prod` | `apps/api/package.json`；`Dockerfile` runtime 阶段 | 生产镜像跑不了 seed → 必须改代码（见 §7） |
| seed 内容是内置 `evaluation_profiles` 与官方 `benchmark_templates`，全部 upsert | `apps/api/prisma/seed.ts`；`CLAUDE.md` | 幂等，可每次升级都跑 |
| 环境变量**一律必填校验**，布尔只认字面量 `true`/`false` | `apps/api/src/config/env.schema.ts` | ConfigMap 里布尔值必须小写加引号 |
| 六个 `RUNNER_IMAGE_*` 全部必填 | 同上；`benchmark/k8s/runner-images.ts` | 未启用的工具也要注入占位值 |
| S3/MinIO 四个变量必填，**缺了进程直接不启动** | 同上；`benchmark/storage/s3-report-storage.ts` | 对象存储是硬依赖，不是可选增强 |
| 压测 Job 从 `envFrom` 读取**预先存在的** Secret `md-benchmark-storage` | `benchmark/k8s/k8s-job-manifest.ts:19,116-177` | chart 必须在 benchmarks 命名空间创建这个 Secret |
| Job 的资源、调度全部**硬编码**：`requests 500m/512Mi`、`limits 2/8Gi`，无 nodeSelector/tolerations/GPU/imagePullSecrets/serviceAccountName | 同上 | 不能做成 values；只能在文档里说明，后续要改代码 |
| K8s 访问走 `loadFromDefault()`（集群内 SA） | `benchmark/benchmark.module.ts:38-45` | 不设 `KUBECONFIG`，不能关 `automountServiceAccountToken` |
| 现有 `deploy/k8s/rbac.yaml` 的 Role **缺 `pods: watch`**，而默认 `K8S_WATCHER_MODE=primary` 的 Informer 需要它 | `deploy/k8s/rbac.yaml` 对比 `docs/operations/k8s-rbac.md` | chart 的 Role 必须补上，否则 watcher 崩溃重启 |
| 四个 `@Cron` + K8s Informer + 内存 SSE Hub，**无任何选主或分布式锁**；通知派发器会重复投递 | `platform-source/automation/platform-source.cron.ts`、`notifications/dispatcher.service.ts:25`、`benchmark/sse/sse-hub.service.ts` | 单副本，`Recreate` 策略 |
| 自动化流水线自身有 DB 租约（`lockedUntil`），是多副本安全的少数部分 | `platform-source/automation/automation-runner.service.ts` | 未来做 HA 时这部分不用改 |
| CI 的 docker 步骤是 `push: false`，无 release workflow、无 git tag、无已发布的应用镜像 | `.github/workflows/ci.yml:94-107` | 必须新建发布流水线 |
| runner 镜像已有构建脚本，tag = benchmark-runner 子树最后一次提交的短 SHA | `tools/build-runner-images.sh` | 复用，仅把 registry 前缀参数化 |
| SWR 拒收 buildx 的 OCI index（400 fail to parse） | 历史经验，`scratchpad/swr-multiarch.sh` | 多架构必须 per-arch tag + `docker manifest` 拼 v2 list |

## 2. 已定决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 交付形态 | 单 chart + 离线包 + release 流水线 | 客户现场私有化 |
| 内置依赖 | **自写最小 Postgres / MinIO StatefulSet**（官方镜像） | 不受 Bitnami 2025 转付费目录影响；离线镜像清单短、可控 |
| runner 镜像分层 | core（guidellm + vegeta）必带，full 额外含 evalscope/aiperf/tau3/omni | evalscope base 烘了 ~866MB 数据集、aiperf ~672MB，全带十几 GB |
| 副本数 | 锁死 1，`Recreate` | 无选主；通知会重复发、watcher 会重复处理、SSE 会连错副本 |
| 迁移与 seed | 从镜像 CMD 移到 Helm hook Job | 升级失败可见；多副本时不再抢锁 |
| 版本号 | git tag 驱动，chart `version`/`appVersion` 与镜像 tag 一致 | 装的时候不填 tag 也能跑 |
| chart 分发 | 同时推成 OCI artifact 到 SWR | 现场 `helm install oci://...` |
| PrometheusRule | 继续走 `deploy/k8s/prometheus-rules` 的 kustomize，不进 chart | 归属集群监控栈，与应用生命周期不同 |

## 3. 仓库结构

```
deploy/charts/modeldoctor/
  Chart.yaml                     # version/appVersion 由 release 流水线写入
  values.yaml                    # 完整默认：内置依赖全开，开箱即用
  values-external.yaml           # 示例：外接 Postgres + 对象存储
  values-4pd.yaml                # 示例：本团队 4pd 集群
  README.md                      # 参数表 + 三种场景的完整命令 + 升级/备份/排障
  templates/
    _helpers.tpl                 # 名称、标签、密钥 lookup 复用、镜像引用拼装
    api/{deployment,service,configmap,secret,ingress,serviceaccount}.yaml
    rbac/{role-benchmarks,rolebinding-benchmarks}.yaml
    benchmarks/{namespace,storage-secret}.yaml
    jobs/{migrate-seed,bucket-init}.yaml
    deps/postgres/{statefulset,service,secret}.yaml
    deps/minio/{statefulset,service,secret}.yaml
    tests/test-health.yaml       # helm test：curl /api/health
    NOTES.txt
deploy/offline/
  images.txt                     # core / full 分层清单
  pull-and-save.sh               # 有网侧：拉取 + 打 tar
  load-and-push.sh               # 现场：导入 + 重推客户仓库 + 输出 values 片段
  README.md
tools/build-app-image.sh         # 应用镜像多架构构建 + SWR manifest 拼装
.github/workflows/release.yml    # tag 触发：镜像 + chart 发布
```

## 4. values 结构（关键项）

```yaml
image:
  registry: swr.cn-north-4.myhuaweicloud.com
  repository: modeldoctor/modeldoctor
  tag: ""                 # 空 = .Chart.AppVersion
  pullPolicy: IfNotPresent
imagePullSecrets: []

replicaCount: 1           # 只接受 1；>1 时 fail（见 §5）

app:
  logLevel: info
  disableFirstUserAdmin: false
  baseUrl: ""             # 空则从 ingress.host 推导，用于通知深链
  corsOrigins: ""         # 空则从 ingress.host 推导

ingress:
  enabled: true
  className: nginx
  host: modeldoctor.local
  tls: { enabled: false, secretName: "" }
  annotations: {}         # 默认合并大超时 + 大 body 注解

auth:
  existingSecret: ""      # 提供则不自动生成
  # jwtAccessSecret / connectionApiKeyEncryptionKey / alertmanagerWebhookSecret
  # 首次安装自动生成，升级用 lookup 保持不变

database:
  bundled: true
  external: { url: "", existingSecret: "", existingSecretKey: "url" }
  postgres:                # bundled=true 时生效
    image: postgres:16-alpine
    persistence: { size: 20Gi, storageClass: "" }
    resources: {...}

storage:
  bundled: true            # 内置 MinIO
  bucket: modeldoctor
  region: us-east-1
  forcePathStyle: true     # 阿里云 OSS / AWS S3 必须 false
  retentionDays: 30
  external: { endpoint: "", accessKey: "", secretKey: "", existingSecret: "" }
  minio:
    image: minio/minio:...
    mcImage: minio/mc:...
    persistence: { size: 100Gi, storageClass: "" }

benchmarks:
  namespace: modeldoctor-benchmarks
  createNamespace: true
  watcherMode: primary     # off | primary | poll
  reconcileIntervalSec: 30
  defaultMaxDurationSeconds: 1800
  defaultMaxConcurrency: 100
  enabledTools: [guidellm, vegeta]   # 本次部署要启用的工具，未列入的注入占位镜像
  runnerImages:            # enabledTools 里的工具必须有镜像，否则渲染期 fail
    guidellm: swr.../modeldoctor/md-runner-guidellm:<tag>
    vegeta:   swr.../modeldoctor/md-runner-vegeta:<tag>
    evalscope: ""
    aiperf: ""
    tau3: ""
    vllmOmniBench: ""
  hf: { endpoint: "", token: "", offline: false }

prometheus:
  fetchAllowHosts: ""
  fetchBlockPrivate: false
  fetchMaxBodyBytes: 5242880

mcp: { enabled: false, bearerToken: "", userId: "", allowExecute: true }

resources: { requests: {cpu: 250m, memory: 512Mi}, limits: {cpu: "2", memory: 2Gi} }
nodeSelector: {} / tolerations: [] / affinity: {}
podSecurityContext / securityContext   # 非 root（镜像内用户 app）
```

## 5. 模板层的硬约束（渲染期就拦住）

- `replicaCount != 1` → `fail`，提示"当前版本不支持多副本：通知派发、K8s watcher、SSE 均无选主"。
- 某个 runner 工具被列入 `benchmarks.enabledTools` 却没有镜像 → `fail`。
- `database.bundled=false` 且 `external.url` 与 `existingSecret` 都为空 → `fail`。
- `storage.bundled=false` 且外接四要素不全 → `fail`。
- `ingress.enabled=false` 且 `app.baseUrl` 为空 → 渲染通过但 NOTES 里警告通知深链不可用。
- 所有布尔值渲染成小写带引号字符串。

## 6. 初始化与生命周期

**hook 顺序**
1. `pre-install,pre-upgrade` weight `-10`：等待 Postgres 就绪的 initContainer + `prisma migrate deploy` + `prisma db seed`（同一个 Job 串行，用应用镜像）。失败则 Helm 安装/升级失败，信息在 Job 日志里。
2. `post-install,post-upgrade` weight `0`：`mc` 建桶 + 设置 `--expire-days <retentionDays>`（仅 `storage.bundled=true`）。
3. hook 删除策略 `before-hook-creation,hook-succeeded`，失败的 Job 保留以便排障。

**升级**：`Recreate` 策略下先停后起，有短暂不可用（可接受，单副本本来就不是 HA）。加密密钥通过 `lookup` 保持不变。

**备份**（写进 README，不做自动化）：Postgres `pg_dump`、MinIO 桶同步；强调 `CONNECTION_API_KEY_ENCRYPTION_KEY` 必须与数据库一起备份，否则恢复后所有已存的第三方密钥解不开。

## 7. 必要的代码/配置改动（chart 之外）

1. **`tsx` 从 devDependencies 移到 `@modeldoctor/api` 的 dependencies**，使生产镜像能执行 `prisma db seed`。镜像体积增加约 10MB。（替代方案：预编译 seed 为 js——改动更大，放弃。）
2. **根 `Dockerfile` 的 CMD 去掉 `prisma migrate deploy`**，只保留 `node apps/api/dist/main.js`；迁移交给 chart 的 hook Job。README 里同步说明"非 Helm 部署时需自行先跑迁移"。
3. **`deploy/k8s/rbac.yaml` 的 Role 补 `pods: ["get","list","watch"]`**，并在文件头注明它已被 chart 取代、仅作手工部署参考。
4. `tools/build-runner-images.sh` 的 `REGISTRY` 参数化，默认改为 SWR 的 modeldoctor 组织。

## 8. 发行工程

**`tools/build-app-image.sh`**：分别构建 `linux/amd64`、`linux/arm64` 并各自推送为 `<tag>-amd64` / `<tag>-arm64`，再用 `docker manifest create/annotate/push` 拼成 v2 manifest list（**不能用 buildx 直接推 OCI index，SWR 会 400**）。

**`.github/workflows/release.yml`**（`v*` tag 触发）：
1. 校验 tag 与 `package.json` 版本一致；
2. 构建并推送多架构应用镜像到 SWR；
3. `helm package` 并 `helm push` 到 SWR 的 OCI 仓库，`Chart.yaml` 的 version/appVersion 由 tag 注入；
4. 生成离线清单 `images.txt`（把 values 默认值里的镜像解析出来），作为 release 附件；
5. 凭据全部来自 `secrets.SWR_USERNAME` / `secrets.SWR_PASSWORD`。

**离线包**：`pull-and-save.sh --tier core|full` 拉取清单里的镜像存成单个 tar（按 tier 分），连同 chart tgz 和 values 示例打包；`load-and-push.sh --registry <客户仓库> --project <组织>` 在现场导入、重打标签、推送，并输出一段可直接 `-f` 使用的 values 覆盖片段。

## 9. 验证

- `helm lint` + 若干 values 组合的 `helm template` 快照（内置全开 / 全外接 / 关 ingress / 单命名空间）。
- **k3d 真装**（CI 作业）：内置依赖全开安装 → 等 Deployment ready → `helm test`（curl `/api/health`）→ 断言 seed 生效（官方模板行数 > 0）→ 断言 benchmarks 命名空间里的 Role 含 `pods: watch`、`md-benchmark-storage` Secret 存在 → `helm upgrade` 一次确认密钥未变、迁移 Job 可重入。
- 手工：在 4pd 集群用 `values-4pd.yaml` 装一次，跑通一次真实压测（验证 Job 能创建、报告能落 MinIO、UI 能看到结果）。

## 10. 不在本期

多副本/HA 与选主；把 runner Job 的资源与 GPU 调度做成 values（需改代码）；chart 内置 PrometheusRule；自动备份与灾备；Operator；ARM 侧 runner 镜像的完整验证（应用镜像做多架构，runner 沿用现状）。
