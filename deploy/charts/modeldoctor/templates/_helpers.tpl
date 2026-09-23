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
  取回既有 Secret 里的某个 key;不存在则生成新值。
  作用:升级时保持自动生成的密钥/密码不变 —— 加密密钥变了会导致库内
  已加密的连接 API Key / LLM judge 密钥全部无法解密;数据库/MinIO 密码变了
  则应用与已持久化的 StatefulSet 之间的凭据会失配。

  用法(落在应用 Secret 上,不传 secretName 时的默认行为):
    include "modeldoctor.keepOrGenerate" (dict "ctx" . "key" "jwtAccessSecret" "value" .Values.auth.jwtAccessSecret "len" 48)
  用法(落在指定 Secret 上,例如 Postgres/MinIO 各自的 Secret):
    include "modeldoctor.keepOrGenerate" (dict "ctx" . "key" "password" "value" .Values.database.postgres.password "secretName" (include "modeldoctor.postgres.fullname" .))

  参数:
    ctx        - 必填,顶层渲染上下文(.)
    key        - 必填,Secret data 里的字段名(读回时用同一个 key)
    value      - 用户在 values.yaml 里显式提供的值;非空时直接透传,不生成也不 lookup
    secretName - 可选,要 lookup 的 Secret 名字;省略时默认为 modeldoctor.secretName(应用 Secret)
    kind       - 可选,"b64-32" 表示生成一个 base64 字符串、解码后正好 32 字节(randBytes 本身
                 就返回 base64 编码结果);省略时按 "alnum" 生成随机字母数字串
    len        - 可选,kind=alnum 时的长度,默认 48

  注意:`helm template` / `helm lint` 不连接真实集群,此时 `lookup` 恒定返回空结果
  (Helm 的既定行为,不是 bug),所以本地渲染每次都会走生成分支、产出不同的随机值——
  这是预期的,真正的“跨 upgrade 保持不变”只在连了真实集群的 `helm upgrade` 时生效。

  单次渲染内记忆化(Task 6 实测发现的严重缺陷,已修复):同一个密钥往往被两个模板各
  `include` 一次——例如 Postgres 密码,`api/secret.yaml` 拼 `DATABASE_URL` 时要用一次,
  `deps/postgres/secret.yaml` 设置 `POSTGRES_PASSWORD` 时又要用一次。这两次 include 若
  各自独立走生成分支(`randAlphaNum`/`randBytes` 每次调用都产出新随机值),会得到两个不同
  的密码——全新安装后 API 永远连不上数据库,而且因为 `lookup` 只在下一次 `helm upgrade`
  才会命中既有 Secret 把两边"拉平",这个错配会在下次升级后自己消失,现场排查会非常痛苦。
  修复方式:把生成结果按 `(secretName, key)` 缓存进 `.Values._generatedSecrets`(一次渲染
  内所有模板共享同一个 `.Values` 底层 map,对它的写入在同一次 `helm template`/`helm
  upgrade` 内的其余 include 调用中都可见);无论命中的是显式值、`lookup` 读回值还是新生成
  值,都写入同一个缓存,确保同一个 `(secretName, key)` 在一次渲染内只被解析一次、之后的调
  用全部返回缓存,与调用路径无关。`_generatedSecrets` 只是渲染期的暂存字典,不属于任何
  values 结构,任何模板都不应把整个 `.Values` 转储进输出对象。
*/}}
{{- define "modeldoctor.keepOrGenerate" -}}
{{- $ctx := .ctx -}}
{{- $name := .secretName | default (include "modeldoctor.secretName" $ctx) -}}
{{- $cacheKey := printf "%s/%s" $name .key -}}
{{- $cache := (get $ctx.Values "_generatedSecrets") | default dict -}}
{{- if hasKey $cache $cacheKey -}}
{{- get $cache $cacheKey -}}
{{- else -}}
{{- $v := "" -}}
{{- if .value -}}
{{- $v = .value -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace $name -}}
{{- if and $existing (index $existing.data .key) -}}
{{- $v = (index $existing.data .key | b64dec) -}}
{{- else if eq (.kind | default "alnum") "b64-32" -}}
{{- $v = randBytes 32 -}}
{{- else -}}
{{- $v = randAlphaNum (.len | default 48) -}}
{{- end -}}
{{- end -}}
{{- $_ := set $cache $cacheKey $v -}}
{{- $_ := set $ctx.Values "_generatedSecrets" $cache -}}
{{- $v -}}
{{- end -}}
{{- end -}}

{{/* 内置 Postgres 密码;落在 <fullname>-postgres Secret 的 "password" key 上,跨 upgrade 保持不变 */}}
{{- define "modeldoctor.postgresPassword" -}}
{{- include "modeldoctor.keepOrGenerate" (dict "ctx" . "key" "password" "value" .Values.database.postgres.password "secretName" (include "modeldoctor.postgres.fullname" .)) -}}
{{- end -}}

{{/* 内置 MinIO root 密码;落在 <fullname>-minio Secret 的 "rootPassword" key 上,跨 upgrade 保持不变 */}}
{{- define "modeldoctor.minioRootPassword" -}}
{{- include "modeldoctor.keepOrGenerate" (dict "ctx" . "key" "rootPassword" "value" .Values.storage.minio.rootPassword "secretName" (include "modeldoctor.minio.fullname" .)) -}}
{{- end -}}

{{/*
  仅适用于两种情形:内置 Postgres(database.bundled=true),或外接数据库且直接给了
  database.external.url。第三种合法情形——外接数据库 + database.external.existingSecret
  (没有 url)——不要调用这个 helper:那种情形下 DATABASE_URL 必须通过 secretKeyRef 直接从
  既有 Secret 注入到容器(见 Task 4 的 deployment/secret 模板),这个 helper 拿不到 Secret
  里的值,渲染期会直接 fail,而不是悄悄吐出空字符串——空字符串会被写进 chart 自己生成的
  Secret,产生一个连接串为空的 DATABASE_URL,一路无声到 Pod 启动才被 zod 校验拦下,
  CrashLoop 且报错信息与真实原因（模式选错）脱节。
*/}}
{{- define "modeldoctor.databaseUrl" -}}
{{- if .Values.database.bundled -}}
{{- $pw := include "modeldoctor.postgresPassword" . -}}
{{- printf "postgresql://%s:%s@%s:5432/%s?schema=public" .Values.database.postgres.username $pw (include "modeldoctor.postgres.fullname" .) .Values.database.postgres.database -}}
{{- else if .Values.database.external.url -}}
{{- .Values.database.external.url -}}
{{- else -}}
{{- fail "database.external.existingSecret 模式下不要调用 modeldoctor.databaseUrl:DATABASE_URL 必须通过 secretKeyRef 从既有 Secret 注入(见 Task 4 的 deployment/secret 模板),这个 helper 只处理内置 Postgres 或 database.external.url 两种情形。" -}}
{{- end -}}
{{- end -}}

{{/*
  始终返回集群内 FQDN(http://<svc>.<release-namespace>.svc.cluster.local:9000),即便调用方
  是运行在 release 命名空间内的 API 自己。原因:压测 Job 运行在 benchmarks.namespace(一个不同
  的命名空间),Service 的短名字(<svc>)在跨命名空间时不可解析,必须用 FQDN;为了让 API 与
  Job 读到完全同一个 endpoint 字符串(便于比对/排障),两边统一都用 FQDN,不做“API 用短名、
  Job 用长名”的分叉。
*/}}
{{- define "modeldoctor.storage.endpoint" -}}
{{- if .Values.storage.bundled -}}
{{- printf "http://%s.%s.svc.cluster.local:9000" (include "modeldoctor.minio.fullname" .) .Release.Namespace -}}
{{- else -}}
{{- .Values.storage.external.endpoint -}}
{{- end -}}
{{- end -}}

{{/* 内置 MinIO 时的访问凭据;外接 S3 时透传 values 里的 accessKey/secretKey */}}
{{- define "modeldoctor.storageAccessKey" -}}
{{- if .Values.storage.bundled -}}
{{- .Values.storage.minio.rootUser -}}
{{- else -}}
{{- .Values.storage.external.accessKey -}}
{{- end -}}
{{- end -}}

{{- define "modeldoctor.storageSecretKey" -}}
{{- if .Values.storage.bundled -}}
{{- include "modeldoctor.minioRootPassword" . -}}
{{- else -}}
{{- .Values.storage.external.secretKey -}}
{{- end -}}
{{- end -}}

{{/*
  压测工具名 -> benchmarks.runnerImages / RUNNER_IMAGE_* 的显式映射。

  故意不用 Helm 内置的 `camelcase` 去把 "vllm-omni-bench" 转成 "vllmOmniBench":
  `camelcase` 按 "_" 分词,对连字符 "-" 不分词,"vllm-omni-bench" | camelcase 得到的是
  "Vllm-omni-bench"(只把首字母大写,连字符原样保留),而不是期望的 "vllmOmniBench"——
  这是 sprig `camelcase` 的实际行为,和直觉不符,所以这里换成显式 dict,不依赖任何字符串
  变换规则。同时收录“已经是 values key 形态”的写法(如 "vllmOmniBench" 本身)作为恒等映射,
  这样无论调用方传入原始工具名还是已规范化的 values key,都能解析到同一个结果。
*/}}
{{- define "modeldoctor.toolImageKey" -}}
{{- $map := dict
      "guidellm" "guidellm"
      "vegeta" "vegeta"
      "evalscope" "evalscope"
      "aiperf" "aiperf"
      "tau3" "tau3"
      "vllm-omni-bench" "vllmOmniBench"
      "vllmOmniBench" "vllmOmniBench"
-}}
{{- index $map . | default "" -}}
{{- end -}}

{{/* 未启用的工具注入占位镜像:代码要求六个 RUNNER_IMAGE_* 全部非空 */}}
{{- define "modeldoctor.runnerImage" -}}
{{- $key := include "modeldoctor.toolImageKey" .tool -}}
{{- $key := $key | default .tool -}}
{{- $img := index .images $key -}}
{{- if $img -}}{{- $img -}}{{- else -}}modeldoctor.invalid/not-installed:0{{- end -}}
{{- end -}}

{{/* 渲染期硬约束;入口模板(configmap.yaml 等)调用一次,失败即中止整个 release */}}
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
{{- $imgKey := include "modeldoctor.toolImageKey" . -}}
{{- if not $imgKey -}}
{{- fail (printf "benchmarks.enabledTools 含未知工具 %s,chart 不认识这个工具名。" .) -}}
{{- end -}}
{{- if not (index $.Values.benchmarks.runnerImages $imgKey) -}}
{{- fail (printf "benchmarks.enabledTools 含 %s,但 benchmarks.runnerImages.%s 未提供对应镜像。" . $imgKey) -}}
{{- end -}}
{{- end -}}
{{- if .Values.mcp.enabled -}}
{{- if or (not .Values.mcp.bearerToken) (not .Values.mcp.userId) -}}
{{- fail "mcp.enabled=true 时 bearerToken 与 userId 必须同时提供。" -}}
{{- end -}}
{{- end -}}
{{- end -}}
