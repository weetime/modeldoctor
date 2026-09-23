# ModelDoctor Helm Chart 与发行工程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一套可用于客户现场私有化部署的 Helm chart、离线包与发行流水线，让运维在一个 K8s 集群上 `helm install` 即可跑起 ModelDoctor（含内置 Postgres/MinIO），并让应用镜像能从 tag 自动构建推送到华为云 SWR。

**Architecture:** 单 Deployment（api+web 同进程同镜像）+ 可选内置 Postgres/MinIO StatefulSet + benchmarks 命名空间（RBAC + 存储 Secret）+ Helm hook Job（迁移与 seed）。镜像与 chart 均发布到 `swr.cn-north-4.myhuaweicloud.com/modeldoctor`；离线包按 core/full 分层。

**Tech Stack:** Helm 3（OCI）、Kubernetes 1.24+、Docker buildx + `docker manifest`、GitHub Actions、kind（CI 集成测试）、Postgres 16、MinIO。

**Spec:** `docs/superpowers/specs/2026-09-23-helm-chart-design.md`

## Global Constraints

- **凭据绝不进仓库。** SWR 账号密码只以 `${{ secrets.SWR_USERNAME }}` / `${{ secrets.SWR_PASSWORD }}` 形式出现在 workflow 里；任何脚本、values、文档、测试都不得出现明文 AK/SK。文档里一律写 `docker login -u <SWR_USERNAME> -p <SWR_PASSWORD> swr.cn-north-4.myhuaweicloud.com`。
- 镜像仓库固定 `swr.cn-north-4.myhuaweicloud.com`，组织 `modeldoctor`。
- **SWR 不接受 buildx 推送的 OCI index**（返回 `400 fail to parse`）。多架构必须：per-arch tag 各自 push，再用 `docker manifest create/annotate/push` 合成 v2 manifest list。
- 应用容器必须 `NODE_ENV=production`（否则前端 404），且不得覆盖 `workingDir`（镜像 `WORKDIR /app`，静态目录按 `process.cwd()` 解析）。
- API 环境变量的布尔值解析器只认字面量 `true` / `false`；ConfigMap 里一律 `quote` 且小写。
- 六个 `RUNNER_IMAGE_*` 全部必填：未启用的工具注入占位 `modeldoctor.invalid/not-installed:0`。
- `replicaCount` 只允许 1（无选主）；`strategy: Recreate`；`automountServiceAccountToken` 必须为 true。
- `/api/health` 只用于 readiness/startup；liveness 用 TCP 探针。
- 加密密钥 `CONNECTION_API_KEY_ENCRYPTION_KEY` 必须跨升级保持不变（用 `lookup` 读回已存在的 Secret），否则库内已加密数据全部失效。
- 提交规范：conventional prefix，显式 `git add <files>`（禁止 `git add -A`），commit body 以下面这行结尾：
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- 所有命令**前台执行**，Bash 调用显式设置 `timeout`（套件类 900000，其余 600000），禁止 `run_in_background` / Monitor 等待，长输出用 `tail` 截断。
- 不要执行 `prisma migrate reset` 或任何破坏共享开发库的操作。
- 本仓库不存在 `helm` 以外的模板工具；不要引入 kustomize 到 chart 里。

## File Structure

```
apps/api/package.json                 # T1: tsx → dependencies
Dockerfile                            # T1: CMD 去掉 migrate
deploy/k8s/rbac.yaml                  # T1: 补 pods:watch + 标注被 chart 取代
tools/build-runner-images.sh          # T1: REGISTRY 参数化
tools/build-app-image.sh              # T2: 多架构构建 + SWR manifest list
deploy/charts/modeldoctor/
  Chart.yaml values.yaml .helmignore  # T3
  templates/_helpers.tpl              # T3: 命名/标签/密钥 lookup/镜像拼装/校验
  templates/api/*.yaml                # T4
  templates/rbac/*.yaml               # T5
  templates/benchmarks/*.yaml         # T5
  templates/deps/postgres/*.yaml      # T6
  templates/deps/minio/*.yaml         # T7
  templates/jobs/*.yaml               # T7(bucket-init) T8(migrate-seed)
  templates/NOTES.txt                 # T9
  templates/tests/test-health.yaml    # T9
  README.md values-external.yaml values-4pd.yaml   # T9
deploy/offline/                       # T10
.github/workflows/release.yml         # T11
.github/workflows/ci.yml              # T12: 新增 chart 作业
```

---

### Task 1: 前置代码改动（seed 可执行、迁移移出 CMD、RBAC 补全、registry 参数化）

**Files:**
- Modify: `apps/api/package.json`
- Modify: `Dockerfile`（最后一行 CMD）
- Modify: `deploy/k8s/rbac.yaml`
- Modify: `deploy/k8s/README.md`
- Modify: `tools/build-runner-images.sh`

**Interfaces:**
- Produces：生产镜像可执行 `pnpm -F @modeldoctor/api exec prisma migrate deploy` 与 `pnpm -F @modeldoctor/api db:seed`；镜像启动只做 `node apps/api/dist/main.js`；`tools/build-runner-images.sh` 支持 `REGISTRY` 环境变量覆盖。

- [ ] **Step 1: 把 tsx 挪到生产依赖**

`apps/api/package.json`：把 `"tsx": "^4.20.0"` 从 `devDependencies` 移到 `dependencies`（保持版本号不变，保持字段字母序）。理由写进 commit body：生产镜像要执行 `prisma db seed`（`tsx prisma/seed.ts`），而运行时镜像只装 `--prod`。

Run: `pnpm install --lockfile-only 2>&1 | tail -5`
Expected: `pnpm-lock.yaml` 更新，无报错。

- [ ] **Step 2: 镜像 CMD 去掉迁移**

`Dockerfile` 最后一行改为：

```dockerfile
# Migrations are NOT run here: the Helm chart runs them in a pre-install/pre-upgrade
# Job (deploy/charts/modeldoctor/templates/jobs/migrate-seed.yaml) so a failed migration
# fails the release visibly instead of crash-looping every replica.
# Deploying without Helm? Run `pnpm -F @modeldoctor/api exec prisma migrate deploy`
# (and `pnpm -F @modeldoctor/api db:seed`) before starting the container.
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **Step 3: RBAC 补 pods:watch**

`deploy/k8s/rbac.yaml`：把 `pods` 规则的 verbs 改为 `["get", "list", "watch"]`，并在文件顶部加注释：

```yaml
# NOTE: 这份手工清单已被 Helm chart(deploy/charts/modeldoctor)取代，仅供不使用 Helm 的
# 部署参考。K8S_WATCHER_MODE=primary(默认)的 Informer 需要 pods:watch —— 缺了会 CrashLoop。
```

同步更新 `deploy/k8s/README.md` 中引用这份 RBAC 的段落，加一句指向 chart。

- [ ] **Step 4: runner 构建脚本的 registry 参数化**

`tools/build-runner-images.sh`：把写死的 `REGISTRY="ghcr.io/weetime"` 改为

```bash
REGISTRY="${REGISTRY:-swr.cn-north-4.myhuaweicloud.com/modeldoctor}"
```

并在脚本顶部 usage 注释里加一行说明可用 `REGISTRY=... ./tools/build-runner-images.sh --push` 覆盖。不要改镜像名与 tag 规则。

- [ ] **Step 5: 验证**

Run: `pnpm -F @modeldoctor/api exec tsx --version 2>&1 | tail -2 && docker build -t modeldoctor:plan-t1 . 2>&1 | tail -5`
Expected: tsx 版本号打印成功；镜像构建成功。

Run: `docker run --rm --entrypoint sh modeldoctor:plan-t1 -c "pnpm -F @modeldoctor/api exec prisma --version | head -3 && ls node_modules/.bin/tsx" 2>&1 | tail -6`
Expected: prisma 版本打印；`node_modules/.bin/tsx` 存在（证明 seed 能在生产镜像里跑）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml Dockerfile deploy/k8s/rbac.yaml deploy/k8s/README.md tools/build-runner-images.sh
git commit -m "build: 让生产镜像可执行 seed，迁移移交 Helm，补齐 RBAC"
```

---

### Task 2: 应用镜像多架构构建脚本

**Files:**
- Create: `tools/build-app-image.sh`

**Interfaces:**
- Produces：`./tools/build-app-image.sh --tag v0.1.0 [--push] [--platforms linux/amd64,linux/arm64] [--registry <host>] [--project <org>]`，推送后在 `<registry>/<project>/modeldoctor:<tag>` 得到一个 v2 manifest list，同时保留 `<tag>-amd64` / `<tag>-arm64` 两个 per-arch tag。

- [ ] **Step 1: 写脚本**

```bash
#!/usr/bin/env bash
# 构建 ModelDoctor 应用镜像(api + web 同一个镜像)并推送到镜像仓库。
#
# 华为云 SWR 拒收 buildx 直接推送的 OCI image index(HTTP 400 "fail to parse"),
# 所以这里不用 `buildx --platform a,b --push`,而是:
#   1. 每个架构单独 build+push 成 <tag>-<arch>
#   2. 用 docker manifest 合成 Docker v2 manifest list
# 这是 SWR 唯一能正确解析的多架构形式。
set -euo pipefail

REGISTRY="${REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
PROJECT="${PROJECT:-modeldoctor}"
IMAGE_NAME="${IMAGE_NAME:-modeldoctor}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
TAG=""
PUSH=0

usage() {
  cat <<'USAGE'
用法: tools/build-app-image.sh --tag <tag> [选项]

选项:
  --tag <tag>           必填,镜像 tag(通常是 git tag,如 v0.1.0)
  --push                构建后推送(不加则只在本地构建 amd64 供验证)
  --platforms <list>    默认 linux/amd64,linux/arm64
  --registry <host>     默认 swr.cn-north-4.myhuaweicloud.com
  --project <org>       默认 modeldoctor
环境变量 REGISTRY / PROJECT / IMAGE_NAME / PLATFORMS 同名可覆盖。
推送前需先 docker login <registry>。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --push) PUSH=1; shift ;;
    --platforms) PLATFORMS="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$TAG" ]] || { echo "错误: --tag 必填" >&2; usage; exit 1; }

REPO="${REGISTRY}/${PROJECT}/${IMAGE_NAME}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IFS=',' read -r -a PLATFORM_ARR <<< "$PLATFORMS"

if [[ "$PUSH" -eq 0 ]]; then
  echo "==> 本地构建(不推送): ${REPO}:${TAG}"
  docker build -t "${REPO}:${TAG}" "$ROOT"
  echo "==> 完成。加 --push 才会推送并合成 manifest list。"
  exit 0
fi

ARCH_TAGS=()
for platform in "${PLATFORM_ARR[@]}"; do
  arch="${platform##*/}"
  arch_tag="${REPO}:${TAG}-${arch}"
  echo "==> 构建并推送 ${arch_tag}"
  docker buildx build \
    --platform "$platform" \
    --tag "$arch_tag" \
    --provenance=false \
    --sbom=false \
    --push \
    "$ROOT"
  ARCH_TAGS+=("$arch_tag")
done

echo "==> 合成 manifest list ${REPO}:${TAG}"
docker manifest rm "${REPO}:${TAG}" >/dev/null 2>&1 || true
docker manifest create "${REPO}:${TAG}" "${ARCH_TAGS[@]}"
for platform in "${PLATFORM_ARR[@]}"; do
  arch="${platform##*/}"
  docker manifest annotate "${REPO}:${TAG}" "${REPO}:${TAG}-${arch}" \
    --os "${platform%%/*}" --arch "$arch"
done
docker manifest push "${REPO}:${TAG}"

echo "==> 完成: ${REPO}:${TAG}"
docker manifest inspect "${REPO}:${TAG}" | head -40
```

`--provenance=false --sbom=false` 同样是为了避免 buildx 生成 SWR 无法解析的附加 attestation manifest。

- [ ] **Step 2: 可执行 + 本地冒烟**

Run: `chmod +x tools/build-app-image.sh && ./tools/build-app-image.sh --help && ./tools/build-app-image.sh --tag plan-t2 2>&1 | tail -5`
Expected: usage 正常；本地构建成功（不推送）。

- [ ] **Step 3: Commit**

```bash
git add tools/build-app-image.sh
git commit -m "build: 应用镜像多架构构建脚本(SWR manifest list)"
```

---

### Task 3: chart 骨架 —— Chart.yaml / values.yaml / _helpers.tpl

**Files:**
- Create: `deploy/charts/modeldoctor/Chart.yaml`
- Create: `deploy/charts/modeldoctor/values.yaml`
- Create: `deploy/charts/modeldoctor/.helmignore`
- Create: `deploy/charts/modeldoctor/templates/_helpers.tpl`

**Interfaces:**
- Produces（后续 task 全部依赖这些 helper 名）：
  - `modeldoctor.name` / `modeldoctor.fullname` / `modeldoctor.labels` / `modeldoctor.selectorLabels` / `modeldoctor.serviceAccountName`
  - `modeldoctor.image`（应用镜像完整引用）
  - `modeldoctor.secretName`（应用 Secret 名）、`modeldoctor.postgres.fullname`、`modeldoctor.minio.fullname`
  - `modeldoctor.databaseUrl`（内置/外接统一出口）
  - `modeldoctor.storage.endpoint`
  - `modeldoctor.runnerImage`（按工具名返回镜像或占位）
  - `modeldoctor.validate`（所有渲染期硬约束，入口模板调用一次）
  - `modeldoctor.genSecret`（首次生成 / 升级时 `lookup` 复用）

- [ ] **Step 1: Chart.yaml**

```yaml
apiVersion: v2
name: modeldoctor
description: ModelDoctor — 私有化部署的推理服务评测与可观测平台
type: application
# version / appVersion 由 release 流水线按 git tag 覆盖(.github/workflows/release.yml)
version: 0.1.0
appVersion: "0.1.0"
kubeVersion: ">=1.24.0-0"
home: https://github.com/weetime/modeldoctor
sources:
  - https://github.com/weetime/modeldoctor
maintainers:
  - name: weetime
annotations:
  artifacthub.io/license: Apache-2.0
```

- [ ] **Step 2: .helmignore**

标准内容（`.git`、`*.tgz`、`ci/`、`*.md` 保留 README 不忽略）。至少包含：

```
.DS_Store
.git/
.gitignore
*.tgz
*.swp
```

- [ ] **Step 3: values.yaml（带注释，逐项说明）**

按 spec §4 的结构写全，要点：

```yaml
nameOverride: ""
fullnameOverride: ""

image:
  registry: swr.cn-north-4.myhuaweicloud.com
  repository: modeldoctor/modeldoctor
  tag: ""            # 留空 = Chart.appVersion
  pullPolicy: IfNotPresent
imagePullSecrets: []

# 当前版本只支持单副本:通知派发、K8s watcher、SSE 均无选主机制,
# 多副本会导致重复通知与重复处理。填 >1 会在渲染期直接失败。
replicaCount: 1

app:
  logLevel: info              # trace|debug|info|warn|error|fatal|silent
  disableFirstUserAdmin: false
  baseUrl: ""                 # 留空则由 ingress.host 推导
  corsOrigins: ""             # 留空则由 ingress.host 推导
  jwt:
    accessExpiresIn: 15m
    refreshExpiresDays: 7

service:
  type: ClusterIP
  port: 80                    # Service 端口;容器固定 3001

ingress:
  enabled: true
  className: nginx
  host: modeldoctor.local
  path: /
  pathType: Prefix
  tls:
    enabled: false
    secretName: ""
  # 默认注解针对 ingress-nginx:报告生成最长 ~180s,导入接口 body 10MB
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-body-size: "16m"

auth:
  existingSecret: ""          # 提供则完全使用该 Secret,不再自动生成
  # 以下留空则首次安装自动生成,升级时通过 lookup 保持不变
  jwtAccessSecret: ""
  connectionApiKeyEncryptionKey: ""   # base64,解码后必须正好 32 字节
  alertmanagerWebhookSecret: ""

database:
  bundled: true
  external:
    url: ""                   # postgresql://user:pass@host:5432/db?schema=public
    existingSecret: ""
    existingSecretKey: url
  postgres:
    image: postgres:16-alpine
    database: modeldoctor
    username: modeldoctor
    password: ""              # 留空自动生成并保持
    persistence:
      enabled: true
      size: 20Gi
      storageClass: ""
    resources:
      requests: { cpu: 250m, memory: 512Mi }
      limits: { cpu: "2", memory: 2Gi }

storage:
  bundled: true
  bucket: modeldoctor
  region: us-east-1
  forcePathStyle: true        # MinIO 必须 true;阿里云 OSS / AWS S3 必须 false
  retentionDays: 30
  external:
    endpoint: ""
    accessKey: ""
    secretKey: ""
    existingSecret: ""        # 需含 accessKey / secretKey 两个 key
  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    mcImage: minio/mc:RELEASE.2025-04-16T18-13-26Z
    rootUser: modeldoctor
    rootPassword: ""          # 留空自动生成并保持
    persistence:
      enabled: true
      size: 100Gi
      storageClass: ""
    resources:
      requests: { cpu: 250m, memory: 512Mi }
      limits: { cpu: "2", memory: 4Gi }

benchmarks:
  namespace: modeldoctor-benchmarks
  createNamespace: true
  watcherMode: primary        # off|primary|poll
  reconcileIntervalSec: 30
  orphanMinAgeSec: 60
  waitingFatalGraceSec: 60
  defaultMaxDurationSeconds: 1800
  defaultMaxConcurrency: 100
  enabledTools: [guidellm, vegeta]
  runnerImages:
    guidellm: swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-guidellm:latest
    vegeta: swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-vegeta:latest
    evalscope: ""
    aiperf: ""
    tau3: ""
    vllmOmniBench: ""
  hf:
    endpoint: ""
    token: ""
    offline: false

prometheus:
  fetchAllowHosts: ""
  fetchBlockPrivate: false
  fetchMaxBodyBytes: 5242880

mcp:
  enabled: false
  bearerToken: ""
  userId: ""
  allowExecute: true

resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits: { cpu: "2", memory: 2Gi }

podAnnotations: {}
podSecurityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
securityContext:
  allowPrivilegeEscalation: false
  capabilities: { drop: ["ALL"] }
  readOnlyRootFilesystem: false   # Prisma 引擎需要可写临时目录
nodeSelector: {}
tolerations: []
affinity: {}
terminationGracePeriodSeconds: 120

serviceAccount:
  create: true
  name: ""
  annotations: {}
```

- [ ] **Step 4: _helpers.tpl**

```yaml
{{/* 基础命名 */}}
{{- define "modeldoctor.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "modeldoctor.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "modeldoctor.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "modeldoctor.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{ include "modeldoctor.selectorLabels" . }}
{{- end -}}

{{- define "modeldoctor.selectorLabels" -}}
app.kubernetes.io/name: {{ include "modeldoctor.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "modeldoctor.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "modeldoctor.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "modeldoctor.secretName" -}}
{{- printf "%s-secrets" (include "modeldoctor.fullname" .) -}}
{{- end -}}

{{- define "modeldoctor.postgres.fullname" -}}
{{- printf "%s-postgres" (include "modeldoctor.fullname" .) -}}
{{- end -}}

{{- define "modeldoctor.minio.fullname" -}}
{{- printf "%s-minio" (include "modeldoctor.fullname" .) -}}
{{- end -}}

{{- define "modeldoctor.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository $tag -}}
{{- end -}}

{{/*
  取回既有 Secret 里的某个 key;不存在则返回空。
  作用:升级时保持自动生成的密钥不变 —— 加密密钥变了会导致库内
  已加密的连接 API Key / LLM judge 密钥全部无法解密。
  用法: include "modeldoctor.keepOrGenerate" (dict "ctx" . "key" "jwtAccessSecret" "value" .Values.auth.jwtAccessSecret "len" 48)
*/}}
{{- define "modeldoctor.keepOrGenerate" -}}
{{- $ctx := .ctx -}}
{{- if .value -}}
{{- .value -}}
{{- else -}}
{{- $name := include "modeldoctor.secretName" $ctx -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace $name -}}
{{- if and $existing (index $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else if eq (.kind | default "alnum") "b64-32" -}}
{{- randBytes 32 -}}
{{- else -}}
{{- randAlphaNum (.len | default 48) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "modeldoctor.databaseUrl" -}}
{{- if .Values.database.bundled -}}
{{- $pw := include "modeldoctor.postgresPassword" . -}}
{{- printf "postgresql://%s:%s@%s:5432/%s?schema=public" .Values.database.postgres.username $pw (include "modeldoctor.postgres.fullname" .) .Values.database.postgres.database -}}
{{- else -}}
{{- .Values.database.external.url -}}
{{- end -}}
{{- end -}}

{{- define "modeldoctor.storage.endpoint" -}}
{{- if .Values.storage.bundled -}}
{{- printf "http://%s:9000" (include "modeldoctor.minio.fullname" .) -}}
{{- else -}}
{{- .Values.storage.external.endpoint -}}
{{- end -}}
{{- end -}}

{{/* 未启用的工具注入占位镜像:代码要求六个 RUNNER_IMAGE_* 全部非空 */}}
{{- define "modeldoctor.runnerImage" -}}
{{- $img := index .images .tool -}}
{{- if $img -}}{{- $img -}}{{- else -}}modeldoctor.invalid/not-installed:0{{- end -}}
{{- end -}}

{{/* 渲染期硬约束 */}}
{{- define "modeldoctor.validate" -}}
{{- if ne (int .Values.replicaCount) 1 -}}
{{- fail "replicaCount 只能是 1:通知派发器、K8s watcher、SSE Hub 均无选主机制,多副本会重复发送通知并重复处理压测 Job。" -}}
{{- end -}}
{{- if not .Values.database.bundled -}}
{{- if and (not .Values.database.external.url) (not .Values.database.external.existingSecret) -}}
{{- fail "database.bundled=false 时必须提供 database.external.url 或 database.external.existingSecret。" -}}
{{- end -}}
{{- end -}}
{{- if not .Values.storage.bundled -}}
{{- if not .Values.storage.external.endpoint -}}
{{- fail "storage.bundled=false 时必须提供 storage.external.endpoint。" -}}
{{- end -}}
{{- if and (not .Values.storage.external.existingSecret) (or (not .Values.storage.external.accessKey) (not .Values.storage.external.secretKey)) -}}
{{- fail "storage.bundled=false 时必须提供 storage.external.accessKey/secretKey 或 existingSecret。" -}}
{{- end -}}
{{- end -}}
{{- range .Values.benchmarks.enabledTools -}}
{{- $key := . | replace "-" "" -}}
{{- if not (index $.Values.benchmarks.runnerImages (camelcase $key)) -}}
{{- fail (printf "benchmarks.enabledTools 含 %s,但 benchmarks.runnerImages 未提供对应镜像。" .) -}}
{{- end -}}
{{- end -}}
{{- if .Values.mcp.enabled -}}
{{- if or (not .Values.mcp.bearerToken) (not .Values.mcp.userId) -}}
{{- fail "mcp.enabled=true 时 bearerToken 与 userId 必须同时提供。" -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

注意：`enabledTools` 的元素是 `guidellm|vegeta|evalscope|aiperf|tau3|vllm-omni-bench`，`camelcase` 后需与 `runnerImages` 的 key 对齐——实现时用一个显式的 dict 映射更稳妥（`vllm-omni-bench` → `vllmOmniBench`），不要依赖 `camelcase` 的具体行为；若 `camelcase` 结果不符，改成显式映射并在报告里说明。

密码 helper（`modeldoctor.postgresPassword`、`modeldoctor.minioRootPassword`）同样走 `keepOrGenerate`，分别落在各自的 Secret 上。

- [ ] **Step 5: 验证**

Run: `helm lint deploy/charts/modeldoctor 2>&1 | tail -10`
Expected: 通过（此时还没有资源模板，lint 只校验结构）。

- [ ] **Step 6: Commit**

```bash
git add deploy/charts/modeldoctor/Chart.yaml deploy/charts/modeldoctor/values.yaml deploy/charts/modeldoctor/.helmignore deploy/charts/modeldoctor/templates/_helpers.tpl
git commit -m "feat(chart): chart 骨架 —— Chart.yaml / values / helpers"
```

---

### Task 4: API 工作负载模板

**Files:**
- Create: `templates/api/serviceaccount.yaml`、`configmap.yaml`、`secret.yaml`、`deployment.yaml`、`service.yaml`、`ingress.yaml`（均在 `deploy/charts/modeldoctor/`）

**Interfaces:**
- Consumes: Task 3 的全部 helper
- Produces: Deployment `<fullname>`、Service `<fullname>`、ConfigMap `<fullname>-config`、Secret `<fullname>-secrets`

- [ ] **Step 1: configmap.yaml（非敏感环境变量）**

关键点：所有布尔值 `| quote` 且小写；`NODE_ENV` 固定 `production`。

```yaml
{{- include "modeldoctor.validate" . -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "modeldoctor.fullname" . }}-config
  labels: {{- include "modeldoctor.labels" . | nindent 4 }}
data:
  NODE_ENV: "production"
  PORT: "3001"
  LOG_LEVEL: {{ .Values.app.logLevel | quote }}
  CORS_ORIGINS: {{ (.Values.app.corsOrigins | default (printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.ingress.host)) | quote }}
  {{- if or .Values.app.baseUrl .Values.ingress.enabled }}
  APP_BASE_URL: {{ (.Values.app.baseUrl | default (printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.ingress.host)) | quote }}
  {{- end }}
  JWT_ACCESS_EXPIRES_IN: {{ .Values.app.jwt.accessExpiresIn | quote }}
  JWT_REFRESH_EXPIRES_DAYS: {{ .Values.app.jwt.refreshExpiresDays | quote }}
  DISABLE_FIRST_USER_ADMIN: {{ .Values.app.disableFirstUserAdmin | ternary "true" "false" | quote }}
  BENCHMARK_K8S_NAMESPACE: {{ .Values.benchmarks.namespace | quote }}
  K8S_WATCHER_MODE: {{ .Values.benchmarks.watcherMode | quote }}
  BENCHMARK_RECONCILE_INTERVAL_SEC: {{ .Values.benchmarks.reconcileIntervalSec | quote }}
  BENCHMARK_ORPHAN_MIN_AGE_SEC: {{ .Values.benchmarks.orphanMinAgeSec | quote }}
  WAITING_FATAL_GRACE_SEC: {{ .Values.benchmarks.waitingFatalGraceSec | quote }}
  BENCHMARK_DEFAULT_MAX_DURATION_SECONDS: {{ .Values.benchmarks.defaultMaxDurationSeconds | quote }}
  BENCHMARK_DEFAULT_MAX_CONCURRENCY: {{ .Values.benchmarks.defaultMaxConcurrency | quote }}
  S3_BUCKET: {{ .Values.storage.bucket | quote }}
  S3_REGION: {{ .Values.storage.region | quote }}
  S3_FORCE_PATH_STYLE: {{ .Values.storage.forcePathStyle | ternary "true" "false" | quote }}
  S3_ENDPOINT: {{ include "modeldoctor.storage.endpoint" . | quote }}
  RUNNER_IMAGE_GUIDELLM: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "guidellm") | quote }}
  RUNNER_IMAGE_VEGETA: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "vegeta") | quote }}
  RUNNER_IMAGE_EVALSCOPE: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "evalscope") | quote }}
  RUNNER_IMAGE_AIPERF: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "aiperf") | quote }}
  RUNNER_IMAGE_TAU3: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "tau3") | quote }}
  RUNNER_IMAGE_VLLM_OMNI_BENCH: {{ include "modeldoctor.runnerImage" (dict "images" .Values.benchmarks.runnerImages "tool" "vllmOmniBench") | quote }}
  {{- with .Values.benchmarks.hf.endpoint }}
  RUNNER_HF_ENDPOINT: {{ . | quote }}
  {{- end }}
  RUNNER_HF_OFFLINE: {{ .Values.benchmarks.hf.offline | ternary "true" "false" | quote }}
  {{- with .Values.prometheus.fetchAllowHosts }}
  PROMETHEUS_FETCH_ALLOW_HOSTS: {{ . | quote }}
  {{- end }}
  PROMETHEUS_FETCH_BLOCK_PRIVATE: {{ .Values.prometheus.fetchBlockPrivate | ternary "true" "false" | quote }}
  PROMETHEUS_FETCH_MAX_BODY_BYTES: {{ .Values.prometheus.fetchMaxBodyBytes | quote }}
  MCP_ALLOW_EXECUTE: {{ .Values.mcp.allowExecute | ternary "true" "false" | quote }}
```

- [ ] **Step 2: secret.yaml**

仅在 `auth.existingSecret` 为空时渲染；包含 `DATABASE_URL`、三个密钥、S3 凭据、可选 `RUNNER_HF_TOKEN` / MCP。所有值 `b64enc`。密钥用 `modeldoctor.keepOrGenerate`（`connectionApiKeyEncryptionKey` 传 `kind=b64-32` 并 `b64enc` 成 base64 字符串——注意代码要求它本身就是 base64 字符串且解码后 32 字节，所以 Secret 里存的是「base64 编码的(base64 字符串)」，不要少编一层）。

- [ ] **Step 3: deployment.yaml**

要点：

```yaml
spec:
  replicas: {{ .Values.replicaCount }}
  strategy:
    type: Recreate            # 单副本 + 避免两个 K8s Informer 并存
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/api/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/api/secret.yaml") . | sha256sum }}
    spec:
      serviceAccountName: {{ include "modeldoctor.serviceAccountName" . }}
      automountServiceAccountToken: true   # 代码用 loadFromDefault() 访问 apiserver
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
      containers:
        - name: api
          image: {{ include "modeldoctor.image" . }}
          envFrom:
            - configMapRef: { name: {{ include "modeldoctor.fullname" . }}-config }
            - secretRef: { name: {{ include "modeldoctor.secretName" . }} }
          ports: [{ name: http, containerPort: 3001 }]
          startupProbe:
            httpGet: { path: /api/health, port: http }
            periodSeconds: 5
            failureThreshold: 60        # 冷启动最多 5 分钟
          readinessProbe:
            httpGet: { path: /api/health, port: http }
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            tcpSocket: { port: http }   # 不用 /api/health:它带 500ms DB 超时,
            periodSeconds: 20           # 数据库抖动会误杀 Pod
            failureThreshold: 6
```

不要设置 `workingDir`（镜像 `WORKDIR /app`，静态资源按 cwd 解析）。

- [ ] **Step 4: service.yaml / serviceaccount.yaml / ingress.yaml**

Service 把 `.Values.service.port` 映射到容器 3001。Ingress 单 host 单 path，把 `/` 全部指向该 Service（前端与 API 同源，**不要**为 `/api` 单独开 path 到别的后端）。

- [ ] **Step 5: 验证**

Run: `helm template md deploy/charts/modeldoctor 2>&1 | tail -20 && helm template md deploy/charts/modeldoctor | grep -E "NODE_ENV|S3_FORCE_PATH_STYLE|RUNNER_IMAGE_TAU3|strategy|automount" | head -10`
Expected: 渲染成功；`NODE_ENV: "production"`；布尔值是带引号的小写；未启用工具是占位镜像；`type: Recreate`；`automountServiceAccountToken: true`。

Run: `helm template md deploy/charts/modeldoctor --set replicaCount=2 2>&1 | tail -3`
Expected: 渲染失败，报错文案包含"只能是 1"。

- [ ] **Step 6: Commit**

```bash
git add deploy/charts/modeldoctor/templates/api
git commit -m "feat(chart): API 工作负载模板(Deployment/Service/Ingress/Config/Secret)"
```

---

### Task 5: benchmarks 命名空间、RBAC 与存储 Secret

**Files:**
- Create: `templates/benchmarks/namespace.yaml`、`templates/benchmarks/storage-secret.yaml`
- Create: `templates/rbac/role.yaml`、`templates/rbac/rolebinding.yaml`

**Interfaces:**
- Produces: Namespace `<benchmarks.namespace>`（可选创建）、Secret `md-benchmark-storage`（**名字固定，代码硬编码**）、Role `<fullname>-benchmark-driver` 与 RoleBinding（均在 benchmarks 命名空间，绑定 release 命名空间里的 SA）

- [ ] **Step 1: namespace.yaml**

仅当 `benchmarks.createNamespace=true` 且 `benchmarks.namespace != .Release.Namespace` 时渲染。加 `helm.sh/hook: pre-install,pre-upgrade` + `hook-weight: -20` 与 `hook-delete-policy: before-hook-creation`，确保它先于同命名空间内的 Role/Secret 建立。

- [ ] **Step 2: storage-secret.yaml**

```yaml
apiVersion: v1
kind: Secret
metadata:
  # 名字由代码硬编码(benchmark/k8s/k8s-job-manifest.ts: STORAGE_SECRET_NAME),不可改
  name: md-benchmark-storage
  namespace: {{ .Values.benchmarks.namespace }}
type: Opaque
data:
  S3_ENDPOINT: {{ include "modeldoctor.storage.endpoint" . | b64enc }}
  S3_BUCKET: {{ .Values.storage.bucket | b64enc }}
  S3_REGION: {{ .Values.storage.region | b64enc }}
  S3_FORCE_PATH_STYLE: {{ .Values.storage.forcePathStyle | ternary "true" "false" | b64enc }}
  S3_ACCESS_KEY: {{ include "modeldoctor.storageAccessKey" . | b64enc }}
  S3_SECRET_KEY: {{ include "modeldoctor.storageSecretKey" . | b64enc }}
```

注意内置 MinIO 时 endpoint 是 `http://<minio-svc>:9000`——runner Job 在**另一个命名空间**，必须用 FQDN `http://<svc>.<release-ns>.svc.cluster.local:9000`。实现时 `modeldoctor.storage.endpoint` 要接受一个 `fqdn` 参数，API 自己用短名、Job 用 FQDN；或统一都用 FQDN（更简单，推荐）。

- [ ] **Step 3: role.yaml / rolebinding.yaml**

```yaml
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["create", "get", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]   # watch 必需:K8S_WATCHER_MODE=primary 的 Informer
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

RoleBinding 的 subject 指向 release 命名空间里的 SA（`kind: ServiceAccount`，带 `namespace: {{ .Release.Namespace }}`）。

- [ ] **Step 4: 验证**

Run: `helm template md deploy/charts/modeldoctor | grep -A6 "kind: Role$" | head -20 && helm template md deploy/charts/modeldoctor | grep -B2 -A8 "name: md-benchmark-storage" | head -20`
Expected: Role 含 `watch`；Secret 名字是 `md-benchmark-storage` 且在 benchmarks 命名空间；endpoint 是 FQDN。

- [ ] **Step 5: Commit**

```bash
git add deploy/charts/modeldoctor/templates/benchmarks deploy/charts/modeldoctor/templates/rbac
git commit -m "feat(chart): benchmarks 命名空间、RBAC 与存储 Secret"
```

---

### Task 6: 内置 Postgres

**Files:**
- Create: `templates/deps/postgres/secret.yaml`、`service.yaml`、`statefulset.yaml`

**Interfaces:**
- Produces: StatefulSet/Service `<fullname>-postgres`（仅 `database.bundled=true`）；密码写入 `<fullname>-postgres` Secret 并被 `modeldoctor.databaseUrl` 引用

- [ ] **Step 1: 三个模板**

StatefulSet 要点：
- `image: {{ .Values.database.postgres.image }}`，单副本，`serviceName` 指向 headless/ClusterIP Service（用普通 ClusterIP 即可，单实例不需要 headless）。
- 环境：`POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`（来自 Secret）、`PGDATA: /var/lib/postgresql/data/pgdata`（**必须设子目录**，否则挂载点上的 `lost+found` 会让初始化失败）。
- `volumeClaimTemplates` 用 `database.postgres.persistence`（`enabled=false` 时退化为 emptyDir，并在 NOTES 里警告数据不持久）。
- readiness/liveness 用 `pg_isready -U <user> -d <db>`。
- `securityContext`: postgres 官方镜像以 uid 999 运行，设 `fsGroup: 999`。

- [ ] **Step 2: 验证**

Run: `helm template md deploy/charts/modeldoctor | grep -E "PGDATA|pg_isready|fsGroup" | head -6 && helm template md deploy/charts/modeldoctor --set database.bundled=false --set database.external.url=postgresql://u:p@h:5432/d 2>&1 | grep -c "kind: StatefulSet"`
Expected: 第一条能看到 PGDATA 子目录与探针；第二条只剩 MinIO 一个 StatefulSet（输出 1）。

- [ ] **Step 3: Commit**

```bash
git add deploy/charts/modeldoctor/templates/deps/postgres
git commit -m "feat(chart): 内置 Postgres StatefulSet"
```

---

### Task 7: 内置 MinIO 与建桶 Job

**Files:**
- Create: `templates/deps/minio/secret.yaml`、`service.yaml`、`statefulset.yaml`
- Create: `templates/jobs/bucket-init.yaml`

**Interfaces:**
- Produces: StatefulSet/Service `<fullname>-minio`（端口 9000 API / 9001 Console）；post-install/post-upgrade Job 建桶并设置生命周期

- [ ] **Step 1: MinIO 模板**

- `command: ["minio", "server", "/data", "--console-address", ":9001"]`
- 环境 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 来自 Secret。
- readiness `httpGet /minio/health/ready`（9000），liveness `httpGet /minio/health/live`。
- `volumeClaimTemplates` 同 Postgres 处理方式。

- [ ] **Step 2: bucket-init Job**

```yaml
{{- if .Values.storage.bundled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "modeldoctor.fullname" . }}-bucket-init
  annotations:
    "helm.sh/hook": post-install,post-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 6
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: mc
          image: {{ .Values.storage.minio.mcImage }}
          env: [ ... MINIO_ROOT_USER / MINIO_ROOT_PASSWORD from secret ... ]
          command:
            - sh
            - -c
            - |
              set -e
              until mc alias set md http://{{ include "modeldoctor.minio.fullname" . }}:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
                echo "waiting for minio..."; sleep 3
              done
              mc mb --ignore-existing md/{{ .Values.storage.bucket }}
              mc ilm rule add --expire-days {{ .Values.storage.retentionDays }} md/{{ .Values.storage.bucket }} || \
                echo "生命周期规则已存在,跳过"
{{- end }}
```

- [ ] **Step 3: 验证**

Run: `helm template md deploy/charts/modeldoctor | grep -E "minio/health|expire-days|console-address" | head -6`
Expected: 三项都在。

- [ ] **Step 4: Commit**

```bash
git add deploy/charts/modeldoctor/templates/deps/minio deploy/charts/modeldoctor/templates/jobs/bucket-init.yaml
git commit -m "feat(chart): 内置 MinIO 与建桶初始化 Job"
```

---

### Task 8: 迁移与 seed 的 Helm hook Job

**Files:**
- Create: `templates/jobs/migrate-seed.yaml`

**Interfaces:**
- Produces: `pre-install,pre-upgrade` hook Job `<fullname>-migrate`，串行执行 `prisma migrate deploy` 与 `prisma db seed`

- [ ] **Step 1: 模板**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "modeldoctor.fullname" . }}-migrate
  labels: {{- include "modeldoctor.labels" . | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-10"
    # 失败的 Job 保留,便于 kubectl logs 排障
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 2
  template:
    metadata:
      labels: {{- include "modeldoctor.selectorLabels" . | nindent 8 }}
    spec:
      restartPolicy: Never
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets: {{- toYaml . | nindent 8 }}
      {{- end }}
      initContainers:
        - name: wait-for-db
          image: {{ include "modeldoctor.image" . }}
          command:
            - sh
            - -c
            - |
              # 等数据库可连:用 prisma 自身,避免额外引入 psql 镜像
              for i in $(seq 1 60); do
                if pnpm -F @modeldoctor/api exec prisma migrate status >/dev/null 2>&1; then exit 0; fi
                echo "waiting for database... ($i/60)"; sleep 5
              done
              echo "数据库在 5 分钟内未就绪" >&2; exit 1
          envFrom:
            - secretRef: { name: {{ include "modeldoctor.secretName" . }} }
      containers:
        - name: migrate-seed
          image: {{ include "modeldoctor.image" . }}
          command:
            - sh
            - -c
            - |
              set -e
              echo "==> prisma migrate deploy"
              pnpm -F @modeldoctor/api exec prisma migrate deploy
              echo "==> prisma db seed (幂等 upsert:内置评测集 + 官方压测模板)"
              pnpm -F @modeldoctor/api db:seed
          envFrom:
            - configMapRef: { name: {{ include "modeldoctor.fullname" . }}-config }
            - secretRef: { name: {{ include "modeldoctor.secretName" . }} }
          resources: {{- toYaml .Values.resources | nindent 12 }}
```

注意：`prisma migrate status` 在「有未应用迁移」时返回非 0，所以它只能用来判断**能否连上库**——不行的话改用 `node -e` 直接连一次 `DATABASE_URL`（用 `pg` 不可用，镜像里没有），或退化为 `prisma db execute --stdin <<< "SELECT 1"`。实现时用 `prisma db execute --url "$DATABASE_URL" --stdin` 喂 `SELECT 1;` 最稳，验证时确认该子命令在 prisma 6 可用；若不可用，改用重试整个 `migrate deploy`（它本身幂等）并在报告里说明。

- [ ] **Step 2: 验证渲染**

Run: `helm template md deploy/charts/modeldoctor | grep -B4 -A2 "helm.sh/hook\": pre-install" | head -20`
Expected: hook 注解、weight、镜像、envFrom 都在。

- [ ] **Step 3: Commit**

```bash
git add deploy/charts/modeldoctor/templates/jobs/migrate-seed.yaml
git commit -m "feat(chart): 迁移与 seed 的 pre-install/pre-upgrade Job"
```

---

### Task 9: NOTES、helm test、README 与场景 values

**Files:**
- Create: `templates/NOTES.txt`、`templates/tests/test-health.yaml`
- Create: `deploy/charts/modeldoctor/README.md`、`values-external.yaml`、`values-4pd.yaml`

- [ ] **Step 1: NOTES.txt**

打印：访问地址（按 ingress 是否启用分支）、首个注册用户即管理员的提示、当前生效的依赖模式（内置/外接）、未启用的压测工具清单、以及三条警告——`persistence.enabled=false` 时数据不持久、`ingress.enabled=false` 且未设 `app.baseUrl` 时通知深链不可用、`storage.forcePathStyle` 对非 MinIO 后端的要求。

- [ ] **Step 2: helm test**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "modeldoctor.fullname" . }}-test-health
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  restartPolicy: Never
  containers:
    - name: curl
      image: curlimages/curl:8.11.1
      command: ["sh","-c"]
      args:
        - |
          set -e
          code=$(curl -s -o /tmp/body -w '%{http_code}' http://{{ include "modeldoctor.fullname" . }}:{{ .Values.service.port }}/api/health)
          echo "HTTP $code"; cat /tmp/body; echo
          test "$code" = "200"
          grep -q '"status":"ok"' /tmp/body
```

- [ ] **Step 3: README.md**

必含：架构图（一段文字即可）、前置条件（K8s ≥1.24、StorageClass、Ingress Controller）、三种场景的完整命令（全内置 / 外接 PG+OSS / 单命名空间）、完整参数表、**升级与回滚**、**备份**（`pg_dump` + 桶同步 + 强调 `CONNECTION_API_KEY_ENCRYPTION_KEY` 必须与库一起备份）、排障（migrate Job 日志、watcher RBAC、Job 起不来看 `md-benchmark-storage`）、以及"当前限制"（单副本、runner Job 资源与 GPU 调度硬编码在代码里）。

- [ ] **Step 4: 场景 values**

`values-external.yaml`：`database.bundled=false` + 外接 url 占位、`storage.bundled=false` + OSS 占位并把 `forcePathStyle` 设 false、`ingress.host` 占位。
`values-4pd.yaml`：4pd 集群的实际取值（MinIO `10.100.121.67:31871`、bucket `weetime`、`benchmarks.namespace`），**凭据留空并注明用 `--set` 或 existingSecret 传入**。

- [ ] **Step 5: 验证**

Run: `helm lint deploy/charts/modeldoctor && helm lint deploy/charts/modeldoctor -f deploy/charts/modeldoctor/values-external.yaml 2>&1 | tail -5 && helm template md deploy/charts/modeldoctor -f deploy/charts/modeldoctor/values-4pd.yaml >/dev/null && echo "4pd values 渲染通过"`
Expected: 三条全过。

- [ ] **Step 6: Commit**

```bash
git add deploy/charts/modeldoctor/templates/NOTES.txt deploy/charts/modeldoctor/templates/tests deploy/charts/modeldoctor/README.md deploy/charts/modeldoctor/values-external.yaml deploy/charts/modeldoctor/values-4pd.yaml
git commit -m "docs(chart): NOTES、helm test、README 与场景 values"
```

---

### Task 10: 离线交付包

**Files:**
- Create: `deploy/offline/images.txt`、`pull-and-save.sh`、`load-and-push.sh`、`README.md`

**Interfaces:**
- Produces: `./deploy/offline/pull-and-save.sh --tier core|full --out <dir>`；`./deploy/offline/load-and-push.sh --archive <tar> --registry <host> --project <org>`

- [ ] **Step 1: images.txt**

两段式清单，注释说明分层依据：

```
# tier=core —— 最小可用:应用 + 内置依赖 + 性能压测主路径
core swr.cn-north-4.myhuaweicloud.com/modeldoctor/modeldoctor:__APP_TAG__
core postgres:16-alpine
core minio/minio:RELEASE.2025-04-22T22-12-26Z
core minio/mc:RELEASE.2025-04-16T18-13-26Z
core curlimages/curl:8.11.1
core swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-guidellm:__RUNNER_TAG__
core swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-vegeta:__RUNNER_TAG__
# tier=full —— 额外的评测/多模态工具,镜像很大(evalscope ~866MB 数据集、aiperf ~672MB)
full swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-evalscope:__RUNNER_TAG__
full swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-aiperf:__RUNNER_TAG__
full swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-tau3:__RUNNER_TAG__
full swr.cn-north-4.myhuaweicloud.com/modeldoctor/md-runner-vllm-omni-bench:__RUNNER_TAG__
```

`__APP_TAG__` / `__RUNNER_TAG__` 由脚本参数替换。

- [ ] **Step 2: pull-and-save.sh**

参数 `--tier`（默认 core）、`--app-tag`、`--runner-tag`、`--out`（默认 `./dist/offline`）、`--platform`（默认 `linux/amd64`）。行为：按 tier 过滤清单 → `docker pull --platform` → `docker save` 成单个 `modeldoctor-images-<tier>-<apptag>.tar` → 同时把 `helm package` 出的 chart tgz 和 values 示例复制进输出目录 → 生成 `manifest.txt`（镜像列表 + 各自 digest）与 `checksums.sha256`。

- [ ] **Step 3: load-and-push.sh**

参数 `--archive`、`--registry`、`--project`、`--dry-run`。行为：`docker load` → 对每个镜像重打标签到 `<registry>/<project>/<name>:<tag>` → 推送 → 最后在 stdout 输出一段可直接 `-f` 使用的 values 覆盖片段：

```yaml
image:
  registry: <registry>
  repository: <project>/modeldoctor
  tag: <apptag>
benchmarks:
  runnerImages:
    guidellm: <registry>/<project>/md-runner-guidellm:<runnertag>
    vegeta: <registry>/<project>/md-runner-vegeta:<runnertag>
storage:
  minio:
    image: <registry>/<project>/minio:<...>
    mcImage: <registry>/<project>/mc:<...>
database:
  postgres:
    image: <registry>/<project>/postgres:16-alpine
```

- [ ] **Step 4: README.md**

有网侧与现场侧两段操作手册，含磁盘占用预估（core 约 2–3GB、full 约 15GB+）、`docker login` 提示（**不要写任何真实凭据**）、以及"客户仓库不支持 manifest list 时怎么办"（退化为单架构，用 `--platform` 指定）。

- [ ] **Step 5: 验证**

Run: `bash -n deploy/offline/pull-and-save.sh && bash -n deploy/offline/load-and-push.sh && ./deploy/offline/pull-and-save.sh --help 2>&1 | head -5 && ./deploy/offline/load-and-push.sh --help 2>&1 | head -5`
Expected: 语法检查通过，两个 usage 正常。

Run: `./deploy/offline/pull-and-save.sh --tier core --app-tag plan-t2 --runner-tag latest --out /tmp/offline-dryrun --dry-run 2>&1 | tail -10`
Expected: 打印将要拉取的 core 清单（若脚本未实现 `--dry-run` 则在本步骤补上）。

- [ ] **Step 6: Commit**

```bash
git add deploy/offline
git commit -m "feat(offline): 离线镜像包与现场导入脚本"
```

---

### Task 11: release 流水线

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `tools/check-no-secrets.sh`（凭据形态扫描，供本 task 与 T13 复用；脚本本身不得包含任何真实凭据样本）

- [ ] **Step 1: workflow**

触发 `push: tags: ['v*']`。步骤：
1. checkout（`fetch-depth: 0`）。
2. 校验 tag 与根 `package.json` 的 version 一致，不一致直接失败（避免镜像 tag 与代码版本脱节）。
3. `docker/setup-qemu-action` + `docker/setup-buildx-action`。
4. `docker login` 到 SWR，账号密码来自 `secrets.SWR_USERNAME` / `secrets.SWR_PASSWORD`。
5. `./tools/build-app-image.sh --tag ${GITHUB_REF_NAME} --push`。
6. `helm package` 前用 `yq`/`sed` 把 `Chart.yaml` 的 `version`/`appVersion` 改成去掉 `v` 前缀的版本号；`helm registry login` 后 `helm push` 到 `oci://swr.cn-north-4.myhuaweicloud.com/modeldoctor`。
7. 生成离线清单（把 `images.txt` 里的占位替换成本次 tag）并作为 release 附件上传，连同 chart tgz。
8. `gh release create`（或 `softprops/action-gh-release`）附带上述产物。

明确写上 `permissions: contents: write`；不要 `pull_request` 触发。

- [ ] **Step 2: 静态校验**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml ok')" && grep -c "SWR_PASSWORD" .github/workflows/release.yml && ./tools/check-no-secrets.sh`
Expected: yaml ok；引用了 secret；泄漏检查输出 0 条命中。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag 触发的镜像与 chart 发布流水线"
```

---

### Task 12: CI 增加 chart 作业（lint + 模板快照 + kind 真装）

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `deploy/charts/modeldoctor/ci/*.yaml`（若干 values 组合，供 `helm template` 快照使用）

- [ ] **Step 1: ci values 组合**

`ci/default-values.yaml`（全内置）、`ci/external-values.yaml`（全外接）、`ci/no-ingress-values.yaml`、`ci/same-namespace-values.yaml`（benchmarks 与 release 同命名空间）。

- [ ] **Step 2: chart 作业**

在 `ci.yml` 追加一个与 `lint-type-test` 并行的 `chart` 作业：

```yaml
  chart:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: azure/setup-helm@v4
      - name: helm lint (所有 values 组合)
        run: |
          set -e
          helm lint deploy/charts/modeldoctor
          for f in deploy/charts/modeldoctor/ci/*.yaml; do
            echo "== $f"; helm lint deploy/charts/modeldoctor -f "$f"
          done
      - name: helm template 渲染校验
        run: |
          set -e
          for f in deploy/charts/modeldoctor/ci/*.yaml; do
            helm template md deploy/charts/modeldoctor -f "$f" > /dev/null
          done
          # 反向断言:多副本必须被拦住
          if helm template md deploy/charts/modeldoctor --set replicaCount=2 >/dev/null 2>&1; then
            echo "replicaCount=2 应当渲染失败" >&2; exit 1
          fi
      - uses: helm/kind-action@v1
      - name: 构建并载入应用镜像
        run: |
          docker build -t modeldoctor:ci .
          kind load docker-image modeldoctor:ci --name chart-testing
      - name: 安装并验证
        run: |
          set -e
          helm install md deploy/charts/modeldoctor \
            --namespace modeldoctor --create-namespace \
            --set image.registry=docker.io --set image.repository=library/modeldoctor --set image.tag=ci \
            --set image.pullPolicy=Never \
            --set ingress.enabled=false \
            --set database.postgres.persistence.size=1Gi \
            --set storage.minio.persistence.size=1Gi \
            --wait --timeout 15m
          helm test md --namespace modeldoctor --logs
          # seed 生效:官方压测模板必须存在
          kubectl -n modeldoctor exec deploy/md-modeldoctor -- \
            node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().benchmarkTemplate.count({where:{isOfficial:true}}).then(n=>{console.log('official templates:',n);process.exit(n>0?0:1)})"
          # RBAC 与存储 Secret 到位
          kubectl -n modeldoctor-benchmarks get role -o yaml | grep -q watch
          kubectl -n modeldoctor-benchmarks get secret md-benchmark-storage
      - name: 升级可重入 + 密钥不变
        run: |
          set -e
          before=$(kubectl -n modeldoctor get secret md-modeldoctor-secrets -o jsonpath='{.data.CONNECTION_API_KEY_ENCRYPTION_KEY}')
          helm upgrade md deploy/charts/modeldoctor --namespace modeldoctor --reuse-values --wait --timeout 10m
          after=$(kubectl -n modeldoctor get secret md-modeldoctor-secrets -o jsonpath='{.data.CONNECTION_API_KEY_ENCRYPTION_KEY}')
          test "$before" = "$after" || { echo "加密密钥在升级后变化了" >&2; exit 1; }
      - name: 失败时导出诊断
        if: failure()
        run: |
          kubectl -n modeldoctor get pods,jobs -o wide || true
          kubectl -n modeldoctor describe pods || true
          kubectl -n modeldoctor logs job/md-modeldoctor-migrate --tail=200 || true
          kubectl -n modeldoctor logs deploy/md-modeldoctor --tail=200 || true
```

镜像引用方式按 chart 的 `modeldoctor.image` 拼装规则调整（保证 `kind load` 的名字与渲染出的一致）；Secret 与 Deployment 的实际名字以 `helm template` 输出为准，不要凭记忆写死。

- [ ] **Step 3: 本地预演关键断言**

Run: `helm lint deploy/charts/modeldoctor && for f in deploy/charts/modeldoctor/ci/*.yaml; do helm template md deploy/charts/modeldoctor -f "$f" >/dev/null || exit 1; done && echo "所有 ci values 渲染通过"`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml deploy/charts/modeldoctor/ci
git commit -m "ci: chart lint/模板校验与 kind 集成安装测试"
```

---

### Task 13: 全量验证与真实集群实装

**Files:** 无新增（仅修复验证中发现的问题）

- [ ] **Step 1: 仓库级检查**

Run: `pnpm -r build 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3 && pnpm type-check 2>&1 | tail -3 && pnpm -F @modeldoctor/api test 2>&1 | tail -4`
Expected: 全绿（Task 1 动了 package.json 与 Dockerfile，要确认没有连带破坏）。

- [ ] **Step 2: 本地 kind/k3d 全流程**

在本机用 k3d（本机已有 `k3d-modeldoctor` 集群，按需新建一个独立集群避免污染）复跑 Task 12 的安装与升级断言，确认 CI 里的脚本在真实环境成立。结束后删除该测试集群。

- [ ] **Step 3: 凭据泄漏终检**

Run: `./tools/check-no-secrets.sh`
Expected: 输出 `0`。非 0 则立即清除并报告。

该脚本在 Task 11 一并创建，内容为通用的**形态**匹配，不含任何真实凭据：检测 SWR 风格的 20 位大写 AK（`[A-Z0-9]{20}` 且与 `swr` 同现）、64 位十六进制 SK、`docker login -p <明文>`、以及 `AKIA`/`LTAI` 等常见云厂商前缀。扫描范围排除 `.git`、`node_modules`、`dist`。

- [ ] **Step 4: 4pd 集群实装（手工，需用户在场）**

用 `values-4pd.yaml` 在 4pd 集群装一次，跑通一次真实压测（Job 创建 → 报告落 MinIO → UI 可见）。这一步涉及真实集群写操作，**执行前向用户确认**；把结果写进报告。

- [ ] **Step 5: 修复与提交**（如有）

```bash
git add <修改的文件>
git commit -m "fix(chart): <具体问题>"
```

- [ ] **Step 6: 推送 + PR**

```bash
git push -u origin feat/helm-chart
gh pr create --title "feat(deploy): Helm chart 与私有化发行工程" --body "<按 spec 概述;列出三处前置代码改动、单副本限制、runner Job 资源硬编码这三点已知取舍;Test plan 勾选 Step 1-4 结果>"
```

然后按仓库 CLAUDE.md 的 PR follow-through 检查 CI 与 review 评论。

---

## Self-Review 记录

- **Spec 覆盖**：§3 仓库结构 → T3–T11；§4 values → T3；§5 硬约束 → T3(helper) + T4(调用) + T12(反向断言)；§6 初始化与生命周期 → T7/T8 + T9(README 备份章节)；§7 前置代码改动 → T1；§8 发行工程 → T2/T11 + T10(离线)；§9 验证 → T12/T13；§10 不做项未被任何 task 触碰。
- **已知风险**（实现时若与现实不符，按 CLAUDE.md 报告偏差）：`prisma db execute --stdin` 的可用性（T8 Step 1 已给退路）；`camelcase` 对 `vllm-omni-bench` 的转换结果（T3 Step 4 已要求改显式映射）；`helm/kind-action` 的集群名默认值（T12 里 `kind load --name` 需与之匹配）。
- **凭据**：T11 新增 `tools/check-no-secrets.sh`（按**形态**匹配，不内嵌任何真实凭据），T11 Step 2 与 T13 Step 3 各调用一次，确保 SWR 凭据不进仓库。计划与 spec 本身也受同一脚本约束。
