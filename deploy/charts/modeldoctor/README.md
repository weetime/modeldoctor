# ModelDoctor Helm Chart

私有化部署 ModelDoctor(推理服务评测与可观测平台)到 Kubernetes。本文档假设你没有读过
ModelDoctor 的源码——只需要这份 chart 加上一个 Kubernetes 集群就能把它跑起来、升级、备份
和排障。

## 架构一览

ModelDoctor 是**一个 Node 进程**:NestJS API 与内置的 React 单页应用跑在同一个容器、同一个
端口(3001)上,API 路由都在 `/api` 前缀下,SPA 走其余路径——Ingress 只需要把整个 host 转发
给同一个 Service,**不要**把 `/api` 拆到另一个后端。这个进程需要一个 Postgres 数据库存放
用户/连接/压测记录等结构化数据,以及一个 S3 兼容对象存储存放压测报告、日志等大对象;两者
既可以用 chart 内置的 Postgres/MinIO(单副本 StatefulSet + PVC),也可以指向你已有的外部
实例。压测本身以 Kubernetes Job 的形式运行在一个独立的命名空间(`benchmarks.namespace`,
默认与应用不同名,便于隔离资源与 RBAC 影响面),API 进程持有一个 ServiceAccount,通过
`Role`/`RoleBinding` 被授权在该命名空间创建 Job、读日志、并用 Kubernetes Informer(`watch`)
实时感知 Job/Pod 状态变化。数据库迁移与内置数据的初始化(evaluation profiles、官方压测
模板)跑在 api Deployment 的两个 initContainer 里(`wait-for-db` + `migrate-seed`),不是
一个独立的 hook Job——Helm hook 运行在 release 的常规资源图之外,而迁移偏偏需要 chart 自己
的 Secret 和内置 Postgres 都已存在,`pre-install` 时两者都还没创建,`post-install` 又会跟
`helm install --wait` 互相死锁(Deployment 在迁移完成前永远不 Ready,`--wait` 却要等它
Ready 才会去跑 post-install hook);initContainer 跑在 Pod 自己内部,依赖已经就绪,且
`prisma migrate deploy` 与 seed 都是幂等操作,每次 Pod 启动重跑一遍没有副作用。失败的迁移
因此表现为 Pod 卡在 `Init:Error`/`Init:CrashLoopBackOff`,而不是一个独立失败的 Job——见下方
「排障」一节。内置 MinIO 的建桶与生命周期规则仍由一个 `post-install,post-upgrade` hook Job
执行(它不依赖应用 Deployment 是否 Ready,不受同样的死锁影响)。

## 前置条件

- Kubernetes ≥ 1.24(chart 在 `Chart.yaml` 里用 `kubeVersion` 声明了这个下限)。
- 一个可用的默认 `StorageClass`(除非你把 `database.postgres.persistence.enabled` /
  `storage.minio.persistence.enabled` 都设为 `false`,或者两个依赖都走外接模式——见下方
  「当前限制」对 `emptyDir` 降级的说明)。
- 一个 Ingress Controller(默认按 `ingress.className: nginx` 生成注解;不启用 Ingress 也可以
  部署,见下面场景 3 及 `ingress.enabled=false` 的说明)。
- 能访问 `image.registry`(默认 `swr.cn-north-4.myhuaweicloud.com`)拉取应用镜像;若走私有
  仓库,准备好 `imagePullSecrets` 引用的 Secret 名字(chart 不生成这个 Secret,只引用)。
- `helm` ≥ 3.8(chart 用到的 `lookup` / OCI registry 推送等特性需要较新版本)。

## 快速开始

下面三个场景的命令都可以直接复制执行(把尖括号里的占位符换成真实值)。**所有涉及凭据的
参数一律通过 `--set` 传入,不要写进任何提交到版本库的 values 文件**;`--set` 里的值同样会
留在 shell 历史里,更看重凭据卫生的场景请改用 `auth.existingSecret` /
`database.external.existingSecret` / `storage.external.existingSecret` 三个 existingSecret
入口(值都留空表示由 chart 生成/直接读连接串)。

### 场景 1:全内置(默认)—— chart 自带 Postgres + MinIO,适合评估/单机 PoC

```bash
helm install md deploy/charts/modeldoctor \
  --namespace modeldoctor --create-namespace \
  --set ingress.host=modeldoctor.example.com \
  --set auth.jwtAccessSecret=<your-secret> \
  --set auth.connectionApiKeyEncryptionKey=<your-base64-32byte-key>
```

`auth.jwtAccessSecret` / `auth.connectionApiKeyEncryptionKey` 留空时 chart 会自动生成并在
后续 `helm upgrade` 时保持不变;上面显式传入是更稳妥的做法(尤其是准备好之后要跨集群/跨
release 迁移数据库时——见下方「备份」一节,自动生成的值只在**同一个** release 内保证跨
upgrade 不变)。`auth.connectionApiKeyEncryptionKey` 必须是 base64 字符串且解码后正好 32
字节,例如用 `openssl rand -base64 32` 生成。

### 场景 2:外接数据库 + 外接 S3 兼容对象存储(阿里云 OSS / AWS S3 等)

```bash
helm install md deploy/charts/modeldoctor \
  -f deploy/charts/modeldoctor/values-external.yaml \
  --namespace modeldoctor --create-namespace \
  --set database.external.url='postgresql://<user>:<password>@<host>:5432/<db>?schema=public' \
  --set storage.external.endpoint=https://oss-cn-hangzhou.aliyuncs.com \
  --set storage.external.accessKey=<your-access-key> \
  --set storage.external.secretKey=<your-secret-key> \
  --set ingress.host=modeldoctor.example.com \
  --set auth.jwtAccessSecret=<your-secret> \
  --set auth.connectionApiKeyEncryptionKey=<your-base64-32byte-key>
```

`values-external.yaml` 已经把 `database.bundled` / `storage.bundled` 设为 `false`、把
`storage.forcePathStyle` 设为 `false`(阿里云 OSS / AWS S3 用虚拟主机风格域名,继续用
MinIO 默认的 `true` 会导致签名或域名解析错误)。生产环境更推荐用 `existingSecret` 而不是
`--set` 传凭据——把上面两条 `--set ... url/accessKey/secretKey` 换成:

```bash
  --set database.external.existingSecret=<你的-Secret-名字> \
  --set storage.external.existingSecret=<你的-Secret-名字> \
```

并**提前**在同一个命名空间创建好这两个 Secret(数据库那个需要 key `url`,对象存储那个需要
`accessKey` / `secretKey` 两个 key)。使用 `storage.external.existingSecret` 时还有一个容易
漏掉的前提,见下方「排障」一节。

### 场景 3:单命名空间(压测 Job 与应用同命名空间,不额外建 `benchmarks.namespace`)

```bash
helm install md deploy/charts/modeldoctor \
  --namespace modeldoctor --create-namespace \
  --set benchmarks.namespace=modeldoctor \
  --set benchmarks.createNamespace=false \
  --set ingress.host=modeldoctor.example.com \
  --set auth.jwtAccessSecret=<your-secret> \
  --set auth.connectionApiKeyEncryptionKey=<your-base64-32byte-key>
```

`benchmarks.namespace` 与 `.Release.Namespace`(这里是 `modeldoctor`)相同时,chart 不会再
渲染一个 `Namespace` 对象(`benchmarks.createNamespace` 此时被忽略),压测 Job 的
Role/RoleBinding/`md-benchmark-storage` Secret 都落在应用自己的命名空间里。适合命名空间
数量受限、或者不需要把压测资源与应用资源隔离开的小规模部署。

### 部署后自检

```bash
helm test md --namespace modeldoctor
```

会起一个一次性 Pod,通过 Service 访问 `/api/health` 并断言 HTTP 200 且响应体包含
`"status":"ok"`;任何一条不满足就判定失败,是比"Pod 变成 Running"更强的信号(数据库探针
失败时进程仍在跑,但这个测试会失败)。

### 部署完成后看什么

`helm install`/`helm upgrade` 结束时打印的 NOTES 会告诉你:实际访问地址、首次登录是否自动
成为管理员、当前数据库/对象存储走的是内置还是外接模式、已启用/未启用的压测工具,以及
(如果命中了已知的几种风险配置)醒目的警告。**优先看这段输出**——本文档下面的内容是它的
详细展开,不是替代品。

## 参数表

以下参数按 `values.yaml` 的分组列出;默认值与 `values.yaml` 完全一致,改值前建议先读一遍
`values.yaml` 里对应字段的注释(尤其是标了"必须与 XX 一起理解"的那些)。

### 全局 / 镜像

| Key | 说明 | 默认值 |
|---|---|---|
| `nameOverride` | 覆盖 chart 名(影响 `modeldoctor.name` 派生的资源名片段) | `""` |
| `fullnameOverride` | 覆盖资源名前缀(优先级高于 `nameOverride` + release 名的组合) | `""` |
| `image.registry` | 应用镜像仓库地址 | `swr.cn-north-4.myhuaweicloud.com` |
| `image.repository` | 应用镜像仓库路径 | `modeldoctor/modeldoctor` |
| `image.tag` | 应用镜像 tag;留空则用 `Chart.appVersion`。发布出来的 chart 里 `appVersion` 就是 git tag 原样(带 `v`,如 `v1.2.3`),与推送到仓库的应用镜像 tag 逐字符相同——所以**留空即可正常安装**,不需要手工对齐版本号。注意 chart 自己的 `version` 是去掉 `v` 的 SemVer(`1.2.3`,Helm 强制要求),`helm install --version` 用的是这一个 | `""` |
| `image.pullPolicy` | 镜像拉取策略 | `IfNotPresent` |
| `imagePullSecrets` | 私有仓库拉取凭据引用列表(引用集群里已存在的 Secret,不在这里写凭据) | `[]` |
| `replicaCount` | API 副本数;**只能是 `1`**,填其它值会在渲染期直接失败 | `1` |

### 应用行为(`app`)

| Key | 说明 | 默认值 |
|---|---|---|
| `app.logLevel` | 日志级别:`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent` | `info` |
| `app.disableFirstUserAdmin` | `true` 则首个注册用户不再自动成为管理员 | `false` |
| `app.baseUrl` | 通知/邮件里绝对链接用的 base URL;留空则由 `ingress.host` + `ingress.tls.enabled` 推导 | `""` |
| `app.corsOrigins` | 允许的 CORS 来源(逗号分隔);留空同样由 `ingress.host` 推导 | `""` |
| `app.jwt.accessExpiresIn` | access token 有效期 | `15m` |
| `app.jwt.refreshExpiresDays` | refresh token 有效天数 | `7` |

### Service / Ingress

| Key | 说明 | 默认值 |
|---|---|---|
| `service.type` | Service 类型 | `ClusterIP` |
| `service.port` | Service 对外端口(容器内固定监听 3001,不可改) | `80` |
| `ingress.enabled` | 是否创建 Ingress | `true` |
| `ingress.className` | IngressClass 名 | `nginx` |
| `ingress.host` | 对外域名 | `modeldoctor.local` |
| `ingress.path` | 路由路径 | `/` |
| `ingress.pathType` | 路径匹配类型 | `Prefix` |
| `ingress.tls.enabled` | 是否启用 TLS | `false` |
| `ingress.tls.secretName` | TLS 证书 Secret 名 | `""` |
| `ingress.annotations` | Ingress 注解(默认已放宽 nginx 的超时/body 上限,见 `values.yaml` 注释) | `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"`, `proxy-send-timeout: "300"`, `proxy-body-size: "16m"` |

### 认证密钥(`auth`)

| Key | 说明 | 默认值 |
|---|---|---|
| `auth.existingSecret` | 提供则完全用该 Secret 提供三个密钥(key 名需与环境变量名一致:`JWT_ACCESS_SECRET`/`CONNECTION_API_KEY_ENCRYPTION_KEY`/`ALERTMANAGER_WEBHOOK_SECRET`),chart 不再生成/管理 | `""` |
| `auth.jwtAccessSecret` | JWT 签名密钥;留空自动生成并跨 upgrade 保持 | `""` |
| `auth.connectionApiKeyEncryptionKey` | 第三方连接 API Key 的加密密钥;**必须**是 base64 字符串且解码后正好 32 字节;留空自动生成并跨 upgrade 保持 | `""` |
| `auth.alertmanagerWebhookSecret` | Alertmanager webhook 校验密钥;留空自动生成并跨 upgrade 保持 | `""` |

### 数据库(`database`)

| Key | 说明 | 默认值 |
|---|---|---|
| `database.bundled` | `true` = 使用 chart 内置 Postgres;`false` = 外接 | `true` |
| `database.external.url` | 外接时的连接串(与 `existingSecret` 二选一) | `""` |
| `database.external.existingSecret` | 外接时的既有 Secret 名(与 `url` 二选一) | `""` |
| `database.external.existingSecretKey` | 该 Secret 里连接串所在的 key 名 | `url` |
| `database.postgres.image` | 内置 Postgres 镜像 | `postgres:16-alpine` |
| `database.postgres.database` | 内置 Postgres 库名 | `modeldoctor` |
| `database.postgres.username` | 内置 Postgres 用户名 | `modeldoctor` |
| `database.postgres.password` | 内置 Postgres 密码;留空自动生成并跨 upgrade 保持 | `""` |
| `database.postgres.persistence.enabled` | `false` 时退化为 `emptyDir`——Pod 重建数据即丢失,仅用于临时验证 | `true` |
| `database.postgres.persistence.size` | PVC 容量 | `20Gi` |
| `database.postgres.persistence.storageClass` | 存储类;留空用集群默认 | `""` |
| `database.postgres.resources` | 内置 Postgres 容器资源请求/限制 | `requests: 250m/512Mi, limits: 2/2Gi` |

### 对象存储(`storage`)

| Key | 说明 | 默认值 |
|---|---|---|
| `storage.bundled` | `true` = 使用 chart 内置 MinIO;`false` = 外接 S3 兼容存储 | `true` |
| `storage.bucket` | 桶名 | `modeldoctor` |
| `storage.region` | Region | `us-east-1` |
| `storage.forcePathStyle` | MinIO 必须 `true`;阿里云 OSS / AWS S3 等主流后端必须 `false` | `true` |
| `storage.retentionDays` | 建桶 Job 用它设置生命周期规则(过期对象自动清理) | `30` |
| `storage.external.endpoint` | 外接时的 S3 endpoint | `""` |
| `storage.external.accessKey` | 外接时的 access key(与 `existingSecret` 二选一) | `""` |
| `storage.external.secretKey` | 外接时的 secret key(与 `existingSecret` 二选一) | `""` |
| `storage.external.existingSecret` | 外接时的既有 Secret 名(需同时含 `accessKey`/`secretKey` 两个 key);**使用此项时见下方「排障」的额外前提** | `""` |
| `storage.minio.image` | 内置 MinIO 镜像(来自 quay.io,见下方说明) | `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` |
| `storage.minio.mcImage` | 内置 MinIO 的 `mc` 客户端镜像(建桶/生命周期规则用) | `quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z` |
| `storage.minio.rootUser` | 内置 MinIO root 用户名 | `modeldoctor` |
| `storage.minio.rootPassword` | 内置 MinIO root 密码;留空自动生成并跨 upgrade 保持 | `""` |
| `storage.minio.persistence.enabled` | `false` 时退化为 `emptyDir`——Pod 重建数据即丢失,仅用于临时验证 | `true` |
| `storage.minio.persistence.size` | PVC 容量 | `100Gi` |
| `storage.minio.persistence.storageClass` | 存储类;留空用集群默认 | `""` |
| `storage.minio.resources` | 内置 MinIO 容器资源请求/限制 | `requests: 250m/512Mi, limits: 2/4Gi` |

> MinIO 镜像固定用 `quay.io`,不是 Docker Hub:Docker Hub 对这两个 tag 已经拒绝匿名拉取
> (`pull access denied`),`quay.io` 上同样的 tag 正常。

### 压测(`benchmarks`)

| Key | 说明 | 默认值 |
|---|---|---|
| `benchmarks.namespace` | 压测 Job 运行的命名空间 | `modeldoctor-benchmarks` |
| `benchmarks.createNamespace` | 是否由 chart 创建该命名空间(与应用命名空间相同时此项被忽略,不会重复创建) | `true` |
| `benchmarks.watcherMode` | `primary`(K8s Informer 实时感知,单副本前提下推荐)\|`poll`(定时轮询,`watch` 权限不可用时的降级方案)\|`off`(不建议) | `primary` |
| `benchmarks.reconcileIntervalSec` | 轮询/对账间隔(秒) | `30` |
| `benchmarks.orphanMinAgeSec` | 判定孤儿 Job 的最小存活时间(秒) | `60` |
| `benchmarks.waitingFatalGraceSec` | Job 一直排队等待多久后判定为致命失败(秒) | `60` |
| `benchmarks.defaultMaxDurationSeconds` | 压测默认最长时长(秒) | `1800` |
| `benchmarks.defaultMaxConcurrency` | 压测默认最大并发 | `100` |
| `benchmarks.enabledTools` | 启用的压测工具列表;每个值必须能在 `runnerImages` 里找到对应的非占位镜像,否则渲染期报错 | `[guidellm, vegeta]` |
| `benchmarks.runnerImages.guidellm` | guidellm 工具镜像 | `swr.../md-runner-guidellm:latest` |
| `benchmarks.runnerImages.vegeta` | vegeta 工具镜像 | `swr.../md-runner-vegeta:latest` |
| `benchmarks.runnerImages.evalscope` | evalscope 工具镜像;不启用时留空即可 | `""` |
| `benchmarks.runnerImages.aiperf` | aiperf 工具镜像;不启用时留空即可 | `""` |
| `benchmarks.runnerImages.tau3` | tau3 工具镜像;不启用时留空即可 | `""` |
| `benchmarks.runnerImages.vllmOmniBench` | vllm-omni-bench 工具镜像;不启用时留空即可 | `""` |
| `benchmarks.hf.endpoint` | HuggingFace 镜像端点;留空用官方 `hf.co` | `""` |
| `benchmarks.hf.token` | HuggingFace token | `""` |
| `benchmarks.hf.offline` | 是否离线模式 | `false` |

### Prometheus 抓取

| Key | 说明 | 默认值 |
|---|---|---|
| `prometheus.fetchAllowHosts` | 允许抓取的 Prometheus 主机白名单(逗号分隔);留空不限制 | `""` |
| `prometheus.fetchBlockPrivate` | `true` 则拒绝抓取私有/内网地址(SSRF 防护);默认 `false` 因为集群内 Prometheus 本身就是内网地址 | `false` |
| `prometheus.fetchMaxBodyBytes` | 抓取响应体大小上限(字节) | `5242880` |

### MCP

| Key | 说明 | 默认值 |
|---|---|---|
| `mcp.enabled` | 是否启用 MCP 接口 | `false` |
| `mcp.bearerToken` | `enabled=true` 时必填 | `""` |
| `mcp.userId` | `enabled=true` 时必填 | `""` |
| `mcp.allowExecute` | 是否允许 MCP 执行类操作 | `true` |

### 资源 / 调度 / 安全

| Key | 说明 | 默认值 |
|---|---|---|
| `resources` | API 容器资源请求/限制 | `requests: 250m/512Mi, limits: 2/2Gi` |
| `podAnnotations` | 额外 Pod 注解 | `{}` |
| `podSecurityContext` | Pod 级安全上下文 | `runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000` |
| `securityContext` | 容器级安全上下文;`readOnlyRootFilesystem: false` 是必须的(Prisma 查询引擎启动时要写临时目录) | `allowPrivilegeEscalation: false, capabilities.drop: [ALL], readOnlyRootFilesystem: false` |
| `nodeSelector` | API Pod 调度约束 | `{}` |
| `tolerations` | API Pod 容忍 | `[]` |
| `affinity` | API Pod 亲和性 | `{}` |
| `terminationGracePeriodSeconds` | 优雅终止等待时间(报告生成等长任务需要足够窗口) | `120` |
| `serviceAccount.create` | 是否创建 ServiceAccount | `true` |
| `serviceAccount.name` | ServiceAccount 名;留空用 `modeldoctor.fullname` | `""` |
| `serviceAccount.annotations` | ServiceAccount 注解 | `{}` |

### helm test

| Key | 说明 | 默认值 |
|---|---|---|
| `test.image` | `helm test` 断言 `/api/health` 用的轻量 curl 镜像,与应用镜像无关。离线/私有化现场把其它镜像都重打标签推到自有仓库后,这一个也需要跟着改,否则 `helm test` 会因为拉不到镜像而失败;改成 `<your-registry>/.../curl:8.11.1` 即可 | `curlimages/curl:8.11.1` |

## 升级与回滚

```bash
# 升级(镜像 tag、任意 values 变更都走这条路径;新 Pod 起来前 initContainer 会先跑 migrate+seed)
helm upgrade md deploy/charts/modeldoctor -f <你上次用的 values 文件> \
  --set image.tag=<新版本 tag>

# 查看某个 release 的历史版本
helm history md --namespace modeldoctor

# 回滚到某个历史版本(不会重新跑 migrate——数据库 schema 只会向前走,不支持自动降级)
helm rollback md <REVISION> --namespace modeldoctor
```

要点:

- **`auth.jwtAccessSecret` / `auth.connectionApiKeyEncryptionKey` / `alertmanagerWebhookSecret`
  以及内置 Postgres/MinIO 的密码,升级时会自动保持不变**——chart 用 Helm 的 `lookup` 在
  渲染期把已存在 Secret 里的值读回来,而不是重新生成,前提是这些值第一次安装时就没有在
  values 里显式写死(留空触发自动生成的路径)。**这条自动保持只在真正的 `helm upgrade`
  (连了实际集群)时生效**——离线渲染(`helm template`/`helm lint`)看到的 `lookup` 恒为空,
  每次渲染都会生成不同的随机值,这是 Helm 的既定行为,不是 bug。
- 回滚**不会**自动回滚数据库 schema——`prisma migrate deploy` 只前进不后退。如果新版本
  引入了破坏性的 schema 变更,`helm rollback` 到旧版本代码之后,旧代码大概率无法正常读
  已经迁移过的新 schema。回滚前先确认目标版本与当前数据库 schema 兼容,拿不准就先做一次
  数据库备份(见下一节)。
- 升级会随着 api Pod 重建(`strategy: Recreate`)重新跑一次 `migrate-seed` initContainer——
  它是幂等的(`prisma migrate deploy` 只应用未应用过的迁移;`seed.ts` 对内置数据做
  upsert),正常情况下秒级完成,不需要额外操作。

> 下面「卸载」「初始管理员」「备份」「排障」几节里的示例命令,均假设 release 名为 `md`、
> 命名空间为 `modeldoctor`、未设置 `nameOverride`/`fullnameOverride`(资源名前缀因而是
> `md-modeldoctor`)。如果你的部署改过这些,先用 `kubectl get pods,secrets -n <namespace>`
> 确认实际资源名再替换命令里的名字。

## 卸载

```bash
helm uninstall md --namespace modeldoctor
```

**`helm uninstall` 不是"清空环境"。** 这个 chart 有意让所有承载数据和身份的对象活过卸载,
所以卸载之后重装默认是"接着原来的数据继续用",不是从零开始。想彻底清空必须额外手工删除。

### 卸载后仍然留在集群里的东西

| 对象 | 为什么留 |
|---|---|
| `md-modeldoctor-postgres-0` / `md-modeldoctor-minio-0` 的 PVC | StatefulSet 的 `volumeClaimTemplates` 建出来的 PVC,Kubernetes 本身就不会随 StatefulSet 删除而删除——这是 K8s 的行为,不是 chart 的选择。数据库和对象存储的全部数据都在里面 |
| Secret `md-modeldoctor-secrets` | 带 `helm.sh/resource-policy: keep`。里面的 `CONNECTION_API_KEY_ENCRYPTION_KEY` 是解开库内全部第三方连接 API Key / LLM judge 密钥的唯一钥匙——它和上面幸存的 Postgres 卷是一对,拆散就再也配不回来 |
| Secret `md-modeldoctor-postgres` | 带 `keep`。Postgres 镜像只在初始化空 `PGDATA` 时用 `POSTGRES_PASSWORD`,幸存的卷已经初始化过,密码必须跟着卷一起留存 |
| Secret `md-modeldoctor-minio` | 带 `keep`。MinIO root 凭据虽然每次启动都从环境变量读、换掉也能起,但备份脚本/`mc alias`/外部监控可能已经固化了这份凭据 |
| 命名空间 `modeldoctor-benchmarks` | 带 `keep`。里面可能还留着压测运行历史(Job/Pod/日志)供事后排查 |
| Job `md-modeldoctor-bucket-init` 及其 Pod | 这是个 `post-install,post-upgrade` hook,hook 资源不被 release 对象跟踪,`helm uninstall` 不会清理它(它的 `hook-delete-policy: before-hook-creation` 只在下一次 hook 创建前生效)。留着无害,是建桶那一步的日志留档 |

**会被删掉的:** Deployment、Service、Ingress、StatefulSet(PVC 不删)、ServiceAccount、
Role/RoleBinding,以及 benchmarks 命名空间里的 Secret `md-benchmark-storage`。
`md-benchmark-storage` 不需要 `keep`——它的内容完全由上面那三个带 `keep` 的 Secret 推导出来
(S3 凭据来自 `md-modeldoctor-minio`),重装时会被原样重建出同一份值。

### 重装到幸存的数据上(最常见的路径)

```bash
# release 名和命名空间必须与上次完全一致
helm install md deploy/charts/modeldoctor --namespace modeldoctor -f <你上次用的 values 文件>
```

三个带 `keep` 的 Secret 上残留着 Helm 写的 `meta.helm.sh/release-name` /
`meta.helm.sh/release-namespace` 注解,所以同名同命名空间的重装会直接认领它们,密钥和密码
原封不动,应用连上的还是原来那套数据。

**换 release 名或换命名空间重装,等于把数据和密钥拆散——务必先读完这段。** 三个带 `keep` 的
Secret 名字里含 release 名(`<release>-modeldoctor-secrets` 等),换名字就不会命中它们,
chart 会生成一套全新密钥;而幸存的 PVC 还在原地,里面是用旧密钥加密的数据。默认配置
(`benchmarks.createNamespace=true` 且 `benchmarks.namespace` 与 release 命名空间不同)下
这一步会被 benchmarks 命名空间挡住,报一个明确的错:

```
Error: INSTALLATION FAILED: rendered manifests contain a resource that already exists.
Unable to continue with install: Namespace "modeldoctor-benchmarks" ... invalid ownership
metadata; annotation validation error: key "meta.helm.sh/release-name" must equal "md2":
current value is "md"
```

这个命名空间名字不含 release 名、而且带 `keep`,所以它是这条路径上唯一会响亮拦住你的对象。
**但别把它当成安全网**:单命名空间模式(`benchmarks.namespace` = release 命名空间)或
`benchmarks.createNamespace=false` 时没有这个 Namespace 对象,换名重装会静默成功,而库里
所有加密字段从此无法解密。要换 release 名/命名空间,正确做法是先按下面「彻底清除」把旧对象
删干净再装;如果是必须保留数据的迁移,则按「恢复」一节把旧的
`auth.connectionApiKeyEncryptionKey`(以及内置 Postgres 密码 `database.postgres.password`)
显式传进新 release。

### 彻底清除(确认数据不再需要)

> **不可逆。** 执行前确认已经按「备份」一节导出过数据库和对象存储,或者确实不需要它们。

```bash
NS=modeldoctor
RELEASE=md

helm uninstall "$RELEASE" --namespace "$NS"

# 1. 三个带 keep 的 Secret(不删的话重装会沿用旧密钥/旧密码)
kubectl -n "$NS" delete secret \
  "${RELEASE}-modeldoctor-secrets" \
  "${RELEASE}-modeldoctor-postgres" \
  "${RELEASE}-modeldoctor-minio" --ignore-not-found

# 2. Postgres / MinIO 的数据卷(数据在这里)
kubectl -n "$NS" delete pvc -l app.kubernetes.io/instance="$RELEASE"
# 上面这条按 label 删。如果 PVC 上没有你期望的 label(改过 fullnameOverride 等),
# 先 `kubectl -n "$NS" get pvc` 看一眼实际名字再按名字删。

# 3. 建桶 hook 留下的 Job/Pod(hook 资源不受 release 跟踪,uninstall 不会清理)
kubectl -n "$NS" delete job "${RELEASE}-modeldoctor-bucket-init" --ignore-not-found

# 4. 压测命名空间(连同里面的历史 Job/Pod/日志)
kubectl delete namespace modeldoctor-benchmarks --ignore-not-found

# 5. 如果这个命名空间是专门为 ModelDoctor 建的,最后连它一起删
#    (这一步做了的话,上面第 1~3 步可以省掉——删命名空间会级联清掉里面所有对象)
kubectl delete namespace "$NS" --ignore-not-found
```

做完这几步,下一次 `helm install` 才是真正的全新安装。可以这样确认:装完之后
`kubectl -n <ns> get secret <release>-modeldoctor-secrets -o jsonpath='{.data.CONNECTION_API_KEY_ENCRYPTION_KEY}'`
的值应该与清除前记录的那一份不同。

## 初始管理员

`app.disableFirstUserAdmin=false`(默认)时,第一个在这个实例上注册的用户会自动获得管理员
角色,之后注册的用户都是普通角色。如果你把它设为 `true`(多用户/受控环境场景),或者第一个
注册的账号搞错了,需要手动把某个用户提升为管理员——角色存在 `users` 表的 `roles`(文本数组)
列上,直接改数据库即可,不需要重启应用:

```bash
# 内置 Postgres:
kubectl -n modeldoctor exec -it md-modeldoctor-postgres-0 -- \
  psql -U modeldoctor -d modeldoctor -c \
  "UPDATE users SET roles = array_append(roles, 'admin') WHERE email = '<email>';"

# 外接数据库:换成你自己连接数据库的方式,SQL 语句相同。
```

## 备份

ModelDoctor 的持久状态分两部分,都需要纳入备份计划:

1. **数据库(Postgres)** —— 用户、连接配置、压测元数据/结果、evaluation profile 等结构化
   数据。内置 Postgres 时:

   ```bash
   kubectl -n modeldoctor exec md-modeldoctor-postgres-0 -- \
     pg_dump -U modeldoctor modeldoctor > modeldoctor-$(date +%F).sql
   ```

   （把 `md-modeldoctor-postgres-0` 换成你实际 release 对应的 Pod 名,格式是
   `<release>-modeldoctor-postgres-0`;外接数据库则用你自己现有的备份流程。）

2. **对象存储(MinIO / S3)** —— 压测报告、日志等大对象。内置 MinIO 时可以用 `mc mirror`
   把桶同步到另一个 S3 兼容目标:

   ```bash
   kubectl -n modeldoctor port-forward svc/md-modeldoctor-minio 9000:9000 &
   mc alias set md-src http://localhost:9000 <rootUser> <rootPassword>
   mc mirror md-src/modeldoctor s3-backup/modeldoctor-backup
   ```

   外接 S3 兼容存储则直接用该云厂商自己的跨区域复制/备份能力。

3. **`CONNECTION_API_KEY_ENCRYPTION_KEY`(即 `auth.connectionApiKeyEncryptionKey`)必须
   与数据库一起备份,且必须能追溯到与该数据库快照对应的那个值。** 这个密钥用来加密数据库
   里存储的第三方连接 API Key 与 LLM judge 密钥;它**只**用来解密,数据库本身不含明文。
   升级场景下 chart 会通过 `lookup` 自动把这个值从既有 Secret 里读回来,不需要你手动干预;
   但**把数据库快照恢复到一个全新的 release**(换集群、灾难恢复、或者故意另起一个全新
   release 名)时,`lookup` 面对的是一个全新的 Secret,不会读到旧值,你必须显式传入与那份
   数据库快照配套的原始密钥:

   ```bash
   helm install md-restored deploy/charts/modeldoctor \
     --set auth.connectionApiKeyEncryptionKey=<备份时记录的那个值> \
     ...
   ```

   如果这个值和数据库快照对不上,或者干脆丢了,数据库里已经加密存储的所有第三方连接
   API Key / LLM judge 密钥都会变成无法解密——不是"重新登录一下就好"级别的问题,而是需要
   用户逐个重新填写所有连接的凭据。**建议把这个值和对应的数据库快照存在一起(同一份备份
   归档、同一条变更记录),而不是分开管理。** 获取当前生效值:

   ```bash
   kubectl -n modeldoctor get secret md-modeldoctor-secrets \
     -o jsonpath='{.data.CONNECTION_API_KEY_ENCRYPTION_KEY}' | base64 -d
   ```

## 恢复

灾难恢复/迁移集群的顺序固定为:**先把数据库和对象存储的数据恢复回去,再安装/升级 chart 并
传入与该数据库快照配套的 `auth.connectionApiKeyEncryptionKey`**(见上一节「备份」第 3 条——
恢复到一个全新 release 时 `lookup` 读不到旧值,必须显式传入,否则库里所有第三方连接的
API Key 都会变成无法解密)。下面两步都要在传入那个密钥、让应用真正对外提供服务**之前**
完成。

1. **数据库恢复(内置 Postgres)**

   恢复前先把应用缩容到 0 副本(如果 release 已经装过),避免 api Pod 的 `migrate-seed`
   initContainer 或应用本身同时写库,与手工恢复的数据打架:

   ```bash
   kubectl -n <namespace> scale deployment/<release>-modeldoctor --replicas=0
   ```

   把 dump 灌回内置 Postgres 的 Pod(Pod 名格式 `<release>-modeldoctor-postgres-0`,数据库名/
   用户名取自 `database.postgres.database` / `database.postgres.username`,默认都是
   `modeldoctor`):

   ```bash
   kubectl -n <namespace> exec -i <release>-modeldoctor-postgres-0 -- \
     psql -U modeldoctor -d modeldoctor < <dump.sql>
   ```

   如果是全新集群上的灾难恢复(Postgres StatefulSet 还不存在):先 `helm install` 一次让
   chart 把 StatefulSet/PVC 建出来(api Pod 可能会因为库是空的而卡在 `migrate-seed`
   initContainer,这是预期的,不用等它 Ready),执行上面的恢复命令灌数据,再 `helm upgrade`
   (或直接删除 api Pod 触发重建)重跑一次 `migrate-seed`——它是幂等的(`prisma migrate
   deploy` 只应用尚未应用过的迁移),不会破坏已经灌进去的数据。

   外接数据库:用你数据库自身的恢复流程(`pg_restore`/云厂商控制台的备份恢复等),恢复完成
   后把 `database.external.url`/`existingSecret` 指向恢复后的实例即可,chart 侧不需要额外
   操作。

2. **对象存储恢复(内置 MinIO)**

   桶不需要你手动创建——`bucket-init` 这个 `post-install` hook Job 会在 `helm install` 时
   自动建好目标桶。桶就绪后,把备份内容反向 mirror 回去(方向与「备份」小节的命令相反:
   源是你的备份目标,目的是新实例的桶):

   ```bash
   kubectl -n <namespace> port-forward svc/<release>-modeldoctor-minio 9000:9000 &
   mc alias set md-dst http://localhost:9000 <rootUser> <rootPassword>
   mc mirror s3-backup/modeldoctor-backup md-dst/modeldoctor
   ```

   外接 S3 兼容存储:用该云厂商自己的备份恢复/跨区域复制能力把数据写回目标桶。

3. 两部分数据都恢复完成后,把应用副本改回 1(如果之前缩容过),并按上一节「备份」第 3 条
   的做法传入 `auth.connectionApiKeyEncryptionKey`:

   ```bash
   kubectl -n <namespace> scale deployment/<release>-modeldoctor --replicas=1
   # 或者:全新 release 场景直接把这个值带进 helm install(见「备份」第 3 条的示例命令)
   ```

## 排障

- **api Pod 卡在 `Init:Error`/`Init:CrashLoopBackOff`,一直起不来**:迁移+seed 跑在这个 Pod
  自己的两个 initContainer(`wait-for-db`、`migrate-seed`)里,不是一个独立的 Job——先看
  Pod 状态确认卡在哪一个:

  ```bash
  kubectl -n modeldoctor get pods -l app.kubernetes.io/name=modeldoctor
  kubectl -n modeldoctor logs <pod> -c wait-for-db
  kubectl -n modeldoctor logs <pod> -c migrate-seed
  ```

  常见原因:数据库还没就绪(`wait-for-db` 最多重试 5 分钟后失败退出,日志里能看到具体是
  哪一步在重试)、`database.external.url`/`existingSecret` 配错、或者迁移本身有冲突。
  部署策略是 `Recreate`(见「当前限制」),升级时旧 Pod 会先终止再起新 Pod——如果新 Pod 卡
  在 `Init:`,服务会中断到问题解决为止,这也是为什么升级前建议先确认迁移不会失败(测试环境
  先跑一遍)。

- **压测 Job 起不来 / 一起就失败,报错和存储有关**:99% 是命名空间
  `benchmarks.namespace` 里缺一个名字精确为 `md-benchmark-storage` 的 Secret,或者这个
  Secret 里的 key 名/内容不对。先确认它存在:

  ```bash
  kubectl -n <benchmarks.namespace> get secret md-benchmark-storage -o yaml
  ```

  应该能看到 6 个 key:`S3_ENDPOINT` / `S3_BUCKET` / `S3_REGION` / `S3_FORCE_PATH_STYLE` /
  `S3_ACCESS_KEY` / `S3_SECRET_KEY`。**这个 Secret 在 `storage.bundled=false` 且
  `storage.external.existingSecret` 非空时不会被 chart 渲染**(Kubernetes 的 Secret 之间没有
  "引用另一个 Secret" 的机制,chart 故意不做跨命名空间复制,理由见 `values.yaml` 里
  `storage.external.existingSecret` 的注释)——这种模式下你需要自己在
  `benchmarks.namespace` 里手动创建这个 Secret,`helm install`/`helm upgrade` 的 NOTES 输出
  会在这种配置下打印醒目提醒,别忽略它。

- **watcher(K8s Informer)一直 crash-loop,或者压测状态一直不更新**:大概率是 RBAC 权限
  不够——`K8S_WATCHER_MODE=primary` 需要在 `benchmarks.namespace` 里对 `pods` 有 `watch`
  权限。核对方式:

  ```bash
  kubectl -n <benchmarks.namespace> get role,rolebinding
  kubectl auth can-i watch pods -n <benchmarks.namespace> \
    --as=system:serviceaccount:<release-namespace>:<ServiceAccount 名>
  ```

  `<ServiceAccount 名>` 默认是 `modeldoctor.fullname` 的输出(`helm template ... | grep
  "kind: ServiceAccount" -A2` 可以直接看到实际名字)。如果 `can-i` 返回 `no`,把
  `benchmarks.watcherMode` 临时降级为 `poll` 可以让压测继续可用,同时修 RBAC。

- **内置 MinIO 建桶 Job(`<fullname>-bucket-init`)一直失败**:看它的日志,常见原因是
  MinIO Pod 还没就绪(180 秒超时后会显式失败,不会无限重试)或者 `mc ilm rule` 相关命令
  报错:

  ```bash
  kubectl -n modeldoctor logs job/md-modeldoctor-bucket-init
  ```

- **忘记自己用的是哪种依赖模式 / 哪些压测工具真正启用**:重新看一次 NOTES(不需要重新
  安装):

  ```bash
  helm get notes md --namespace modeldoctor
  ```

## 当前限制

- **只支持单副本。** 通知派发、K8s watcher(Informer)、SSE Hub 都没有选主机制;
  `replicaCount` 填 `1` 之外的值会在渲染期直接失败,而不是留到运行时才暴露成难以定位的
  重复通知/重复处理压测 Job。水平扩展(多副本)需要先在应用层做选主/去重,这不是这个
  chart 能通过 values 打开的开关。
- **压测 runner Job 的 CPU/内存(`limits: 2 CPU / 8Gi`)以及 GPU/`nodeSelector`/
  `tolerations` 都硬编码在应用代码里(生成 Job manifest 的那段逻辑),不是 chart 的
  values。** 想在 GPU 节点上跑压测、或者调整 runner Job 的资源限制,今天需要改应用代码,
  这份 chart 没有对应的 values 开关——不要在 values 里找一个不存在的
  `benchmarks.runnerResources` 之类的字段。
- **UI 与 API 是同一个进程、同一个 host。** 不要试图把 `/api` 单独指向一个不同的后端
  Service 或域名——SPA 的静态资源与 API 路由共享同一个 Node 进程的同一个端口。
- **`database.postgres.persistence.enabled=false` / `storage.minio.persistence.enabled=false`
  时数据卷退化为 `emptyDir`**,仅适合临时验证——Pod 重建/滚动更新/节点漂移都会丢数据,
  不要在生产环境这样配置。
