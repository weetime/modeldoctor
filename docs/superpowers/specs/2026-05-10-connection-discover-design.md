# 连接自动发现（Roadmap A）— Design

**Status:** Draft · 2026-05-10
**Branch:** `feat/connection-discover`
**Issue:** #151
**Umbrella:** #155
**Driver:** 给定 baseUrl + 可选 apiKey，自动探测推理服务，把 `serverKind / models / category / suggestedTags / prometheusUrl` 5 个字段以"自动检测，请确认"形态填入 Connection 表单。把"加 5 个新连接 < 3 分钟"作为体验目标。同时把过载的 ConnectionDialog (686 行 / 12 字段) 迁移为 ConnectionSheet (Drawer)，符合现有 "> 5 字段不用 Dialog" 规范。

---

## 1. Why

目标用户场景：私有化大量推理服务部署，频繁新建 Connection 是高频痛点。当前每个 Connection 需要手填：

- `name / baseUrl / apiKey / model` —— 这些用户必须知道
- `serverKind / category / tags / prometheusUrl / tokenizerHfId` —— 这些**全部可从 baseUrl 推导**

每多一个手填字段就多一次出错可能（拼错 model id、错填 serverKind 导致 engine-metrics 不显示）。Discover 把"我必须告诉系统"的字段缩到最少（baseUrl + apiKey），其他系统自己探测，用户只需确认。

同时这次顺带解决 ConnectionDialog 已经过大的问题（详见 §3 架构事实）。

## 2. Scope

**In（本 PR 范围）：**

- 后端 `discovery/` 子模块（在 `apps/api/src/modules/connection/` 下）
  - SSRF 守护 (混合策略 D)
  - 5 个并行 probe（全部 GET）
  - 推断规则（按 metric prefix / model id / Server header 等）
- `POST /api/connections/discover` —— REST endpoint，nestjs-zod controller validation，throttle 10 req/min/user
- MCP tool `discover_connection(baseUrl, apiKey?)` —— 复用 REST 响应 schema
- UI 迁移：`ConnectionDialog` → `ConnectionSheet`
  - 新增 `components/ui/sheet.tsx` (shadcn)
  - 表单逻辑原样搬运，壳子换 Drawer
  - 顶部加 Discover 按钮 + 推断结果展示（auto 徽章 + hover 看 evidence）
  - Edit 模式可重新 Discover，**只覆盖未被用户修改的字段**（react-hook-form `dirtyFields` 判断）
  - 所有引用点（`ConnectionsPage`, `ConnectionPicker`, queries hooks）跟着替换
- 删除旧 `ConnectionDialog.tsx`、`ConnectionDialog.test.tsx`
- e2e 测试（Playwright）
- i18n zh-CN + en-US

**Out（V1 不做，分别去向）：**

- ✗ Tokenizer 推断 / 字段处理 → **#156**（tokenizer 字段从 Connection 迁出 + 加 ModelScope source）
- ✗ POST probe (`/v1/chat/completions` 等) → **永远不做**，会消耗用户的 token
- ✗ 一次发现多模型 → 批量创建多个 Connection → V2（issue #151 已声明）
- ✗ HuggingFace API 二次验证 → V2（避免外部依赖）
- ✗ Auto-tag 自动入库 → **永远不做**（任何写入必须用户 Apply）
- ✗ Higress AI Gateway / APISIX 网关侧深度发现 → V2
- ✗ tokenizer 字段从 ConnectionSheet 物理移除 → 等 #156 里所有消费者迁移完再做

## 3. 当前架构事实（影响实现的硬约束）

| 事实 | 影响 |
|---|---|
| `Connection` schema 已有 `prometheusUrl / serverKind / tags / category / tokenizerHfId` 全部字段 | **0 Prisma 迁移**。Discover 只填值，不改表 |
| `serverKind` enum = 10 `ENGINE_IDS` + `higress` + `generic`（在 `packages/contracts/src/connection.ts:5`） | 推断目标值域固定，识别规则只需对这 12 个分支 |
| `packages/contracts/src/engine-metrics/manifests/{vllm,sglang,tgi,mindie,tei}.ts` 含每引擎的 PromQL metric name 前缀 | **复用**：抽出 `engineMetricNamespace` 字段供 server-kind 推断 |
| `apps/api/src/integrations/probes/` 已有 5 个 probe（embeddings/rerank/image-gen 等），但**目的是 diagnostics 单端点检测，不是 baseUrl 探测** | **不复用代码**，借接口风格（`ProbeCtx → ProbeResult`）保持一致 |
| `ConnectionDialog.tsx` 686 行 / ~12 字段，**违反 CLAUDE.md "> 5 字段用 Page-style"规范** | 顺带迁 Drawer（Sheet），合并到本 PR，避免 "Dialog 上加 Discover 后又拆 Drawer" 的过渡形态 |
| 项目无 Sheet/Drawer 组件（grep 0 hit），shadcn 提供官方 Sheet | 一行 `pnpm dlx shadcn@latest add sheet` 加进去，pure additive |
| nestjs-zod 5 + Zod controller validation 是当前模式（参考 `connection.controller.ts`） | discovery controller 跟样板走 |
| api 内已有 `undici` 通过 `globalThis.fetch` | 后端 probe 直接用 `fetch`，不引入新依赖 |
| `Connection` 已有 throttle 模式（`revealKey` `@Throttle({ default: { limit: 10, ttl: 60_000 } })`） | discover endpoint 同款 throttle |
| `Connection.tokenizerHfId` 字段架构已自我矛盾（GenaiPerfParamsForm 已有 override 字段） | Discover **不碰** tokenizer，待 #156 完成迁移后整字段从 Sheet 移除 |

## 4. 设计

### 4.1 SSRF 防御（混合策略 D）

新建 `apps/api/src/modules/connection/discovery/ssrf-guard.ts`，导出 `assertSafeUrl(url: string): Promise<{ resolvedIp: string; safeUrl: URL }>`：

```typescript
const PROTOCOL_WHITELIST = new Set(["http:", "https:"]);

const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",       // AWS, OpenStack, Alibaba ECS
  "metadata.google.internal", // GCP
  "168.63.129.16",         // Azure WireServer
  "100.100.100.200",       // Alibaba ECS metadata
]);

export async function assertSafeUrl(input: string): Promise<{ resolvedIp: string; safeUrl: URL }> {
  const url = new URL(input);

  // (1) Protocol whitelist
  if (!PROTOCOL_WHITELIST.has(url.protocol)) {
    throw new BadRequestException(`Protocol not allowed: ${url.protocol}`);
  }

  // (2) Hostname blocklist
  const hostname = url.hostname.toLowerCase();
  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    throw new BadRequestException(`Cloud metadata endpoint blocked: ${hostname}`);
  }

  // (3) DNS resolve, then re-check IP
  const { address } = await dns.lookup(hostname);
  if (CLOUD_METADATA_HOSTS.has(address)) {
    throw new BadRequestException(`Resolved IP blocked: ${address}`);
  }

  // (4) Allow private IPs (10.x / 172.16-31.x / 192.168.x / 127.x / fc00::/7)
  // explicitly — they're the user's main use case (private model deployment).
  // No allowlist filter here on purpose.

  return { resolvedIp: address, safeUrl: url };
}
```

**全局 fetch 配置（每个 probe 共用）：**

- `signal: AbortSignal.timeout(5000)` —— 5 秒超时
- 响应体读取最多 1 MB（用 `ReadableStream` 自定义截断）
- `redirect: "manual"` 然后手动追踪，最多 3 次，每次重新过 `assertSafeUrl`（防 DNS rebinding / redirect 攻击）
- 失败错误信息只保留状态码 + reason 短语，**不记录响应体**（防内部数据泄漏到日志）

### 4.2 探测器架构

```
apps/api/src/modules/connection/discovery/
├── discovery.service.ts           # 入口 orchestrator
├── ssrf-guard.ts                  # §4.1
├── safe-fetch.ts                  # 复用的 fetch wrapper（超时 + 大小限 + redirect）
├── probes/
│   ├── index.ts                   # ProbeCtx / ProbeResult 类型
│   ├── models.ts                  # GET {baseUrl}/v1/models
│   ├── metrics.ts                 # GET {baseUrl}/metrics
│   ├── health.ts                  # GET {baseUrl}/health 和 /healthz
│   └── server-header.ts           # GET {baseUrl}/ 取 Server / X-Powered-By header
├── inference/
│   ├── server-kind.ts             # § 4.4.1
│   ├── category.ts                # § 4.4.2
│   ├── tags.ts                    # § 4.4.3
│   └── prometheus-url.ts          # § 4.4.4
└── __tests__/                     # spec 文件
```

**Probe 接口（参考现有 `integrations/probes/`）：**

```typescript
export interface ProbeCtx {
  baseUrl: string;          // 已经过 assertSafeUrl
  apiKey?: string;
  // safe-fetch 已配好 timeout + size cap + redirect chain
}

export interface ProbeResult<T = unknown> {
  ok: boolean;
  durationMs: number;
  data?: T;                  // 类型按 probe 不同
  reason?: string;           // 失败时短描述
}
```

**Orchestrator：**

```typescript
async discover(input: DiscoverInput): Promise<DiscoverResponse> {
  const start = Date.now();
  await assertSafeUrl(input.baseUrl);
  const ctx: ProbeCtx = { baseUrl: input.baseUrl, apiKey: input.apiKey };

  // 全部并行
  const [modelsR, metricsR, healthR, serverHeaderR] = await Promise.all([
    runModelsProbe(ctx),
    runMetricsProbe(ctx),
    runHealthProbe(ctx),
    runServerHeaderProbe(ctx),
  ]);

  const inferred = {
    serverKind: inferServerKind({ metricsR, serverHeaderR, modelsR }),
    models: inferModels({ modelsR }),
    category: inferCategory({ modelsR }),
    suggestedTags: inferTags({ modelsR, serverKind: ... }),
    prometheusUrl: inferPrometheusUrl({ metricsR, baseUrl: input.baseUrl }),
  };

  return {
    health: {
      durationMs: Date.now() - start,
      probesAttempted: 4,
      probesFailed: [...failed],
      warnings: [...warnings],
    },
    inferred,
  };
}
```

### 4.3 API contract

```typescript
// packages/contracts/src/connection.ts (扩展)

export const discoverConnectionRequestSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1).optional(),
});
export type DiscoverConnectionRequest = z.infer<typeof discoverConnectionRequestSchema>;

export const inferenceConfidenceSchema = z.enum(["certain", "likely", "guess", "unknown"]);
export type InferenceConfidence = z.infer<typeof inferenceConfidenceSchema>;

export const inferredFieldSchema = <V extends z.ZodTypeAny>(value: V) =>
  z.object({
    value: value.nullable(),
    confidence: inferenceConfidenceSchema,
    evidence: z.string(),
  });

export const discoverConnectionResponseSchema = z.object({
  health: z.object({
    durationMs: z.number().int().min(0),
    probesAttempted: z.number().int().min(0),
    probesFailed: z.array(
      z.object({ probe: z.string(), reason: z.string() }),
    ),
    warnings: z.array(z.string()),
  }),
  inferred: z.object({
    serverKind: inferredFieldSchema(serverKindSchema),
    models: z
      .object({
        values: z.array(z.string()),
        confidence: inferenceConfidenceSchema,
        evidence: z.string(),
      }),
    category: inferredFieldSchema(ModalityCategorySchema),
    suggestedTags: z
      .object({
        values: z.array(z.string()),
        confidence: inferenceConfidenceSchema,
        evidence: z.string(),
      }),
    prometheusUrl: inferredFieldSchema(z.string().url()),
  }),
});
export type DiscoverConnectionResponse = z.infer<typeof discoverConnectionResponseSchema>;
```

**Controller endpoint：**

```typescript
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Post("discover")
discover(
  @CurrentUser() user: JwtPayload,
  @Body(new ZodValidationPipe(discoverConnectionRequestSchema)) body: DiscoverConnectionRequest,
): Promise<DiscoverConnectionResponse> {
  return this.discoveryService.discover(body);
}
```

挂在现有 `ConnectionController`（`/api/connections/discover`），不另起 module（discovery 是 Connection 的能力之一）。

### 4.4 推断规则

#### 4.4.1 serverKind

输入：`metricsR / serverHeaderR / modelsR`。优先级从高到低：

| 信号 | confidence | evidence 示例 |
|---|---|---|
| `/metrics` 200 + 含已知 prefix（`vllm:` / `sglang:` / `tgi_` / `te_` / `mindie:`） | `certain` | `"metric prefix 'vllm:' detected at /metrics"` |
| `Server` header 含引擎名（"vllm", "tgi", "Higress" 等） | `likely` | `"Server: higress/2.0.0"` |
| `/v1/models` 响应含 `served_model_name` 或特定 vendor 字段 | `likely` | `"served_model_name field present (vLLM convention)"` |
| 全部失败 | `unknown` | `"no engine signal detected"` |

manifest 集中维护 prefix 映射，新增引擎只改一处。

#### 4.4.2 category（仅靠 model id 启发式，**不发 POST**）

按优先级**自上而下**匹配 model id（小写），**首次命中即停**（不会出现"既 embedding 又 chat"的歧义）：

| 优先级 | 关键字 | category | confidence |
|---|---|---|---|
| 1 | 含 `rerank`, `bge-reranker` | rerank | likely |
| 2 | 含 `embed`, `bge`, `e5-`, `gte-`, `m3e` | embeddings | likely |
| 3 | 含 `flux`, `sd-`, `stable-diffusion`, `dall-e`, `imagen` | image | likely |
| 4 | 含 `whisper`, `voxtral`, `tts`, `parakeet` | audio | likely |
| 5 | 默认 | chat | guess |

evidence 标识匹配的关键字（如 `"matched 'embed' in model id 'bge-large-en'"`）。多模型时仅对第一个 model 推断。

#### 4.4.3 suggestedTags

来自三个源：

- `serverKind` 名（如 "vllm"）
- `category` 名（如 "chat"）
- 从 model id 抽出的特征：
  - 大小（regex `\b(\d+(?:\.\d+)?)b\b` → "7b" "13b" "70b"）
  - 形态（"instruct", "chat", "base", "code", "math"）
  - 量化（"awq", "gptq", "fp8", "int4"）

去重、保留前 8 个。**confidence = `guess`**（因为是启发式），用户必须 Apply 才入库。

#### 4.4.4 prometheusUrl

按 metrics probe 结果的三种情况：

| 情况 | value | confidence | evidence |
|---|---|---|---|
| `/metrics` 200 + 含已知引擎 prefix | `baseUrl` | `likely` | `"engine exposes /metrics directly; OK for single-pod deployment, otherwise use your aggregating Prometheus URL"` |
| `/metrics` 200 但无已知 prefix（暴露了别的指标） | `baseUrl` | `guess` | `"endpoint exposes /metrics with unrecognized format; verify before use"` |
| `/metrics` 非 200 | `null` | `unknown` | `"no /metrics endpoint detected"` |

真正的多 pod Prometheus 必须用户自己填，无法发现。

### 4.5 MCP tool

在 #132 标准下，每个 Roadmap 子项都暴露 MCP entry point。本 PR 添加：

- 工具签名：`discover_connection({ baseUrl, apiKey? })`
- 输出：与 `DiscoverConnectionResponse` 完全一致（B+ 结构）
- 实现：调用 `DiscoveryService.discover()` 并直接返回

MCP server 的具体放置位置（`apps/mcp-server/` 还是先 inline 在 api 内）由 #132 的整体架构决定。**本 PR 仅暴露 NestJS provider 给 MCP server 使用**，具体 MCP server 项目如果尚未存在，先在 PR 描述里 reserve 工具签名待 #132 接入。

### 4.6 UI: ConnectionDialog → ConnectionSheet

#### 4.6.1 添加 Sheet 组件

```bash
cd apps/web && pnpm dlx shadcn@latest add sheet
```

shadcn 的 Sheet 基于 Radix Dialog 但 layout 是右侧抽屉，with `side="right"`、宽度可配（用 `sm:max-w-[640px]` 适应 12 字段）。

#### 4.6.2 文件迁移

- 新建 `apps/web/src/features/connections/ConnectionSheet.tsx`：从 ConnectionDialog.tsx 搬迁所有表单逻辑、`useForm` / `useEffect` / submit handler 全部保留，只替换外壳：

  ```tsx
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="sm:max-w-[640px] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>{...}</SheetTitle>
      </SheetHeader>
      {/* 原 form 内容 */}
      <SheetFooter>{/* 原 footer */}</SheetFooter>
    </SheetContent>
  </Sheet>
  ```

- 新建 `apps/web/src/features/connections/ConnectionSheet.test.tsx`：从 ConnectionDialog.test.tsx 搬迁所有测试，调整 selector（`role="dialog"` → `role="dialog"`，shadcn Sheet 内部仍是 Radix Dialog；少数 layout 相关 selector 需要调）
- 更新所有 import 与 render 调用：
  - `apps/web/src/features/connections/ConnectionsPage.tsx`
  - `apps/web/src/components/connection/ConnectionPicker.tsx`
  - 其他 `grep -rn "ConnectionDialog" apps/web/src` 命中处
  - **Props API 不变**（`open / onOpenChange / mode / initialValues / onSaved`），调用点只需改名 import + JSX tag
- 删除旧 `ConnectionDialog.tsx` + `ConnectionDialog.test.tsx`
- 用户在 Discover 进行中关闭 Sheet → 通过 `AbortController` 取消 in-flight `useDiscoverConnection` 请求（防内存泄漏 + 防解析过期响应）
- i18n key 不变（连接表单文案不变），但 `connections.json` 的 `dialog.*` 命名空间下补 Discover 相关文案：

  ```json
  "discover": {
    "button": "🔍 自动发现",
    "running": "探测中…",
    "applyAll": "一键应用",
    "applyField": "应用",
    "autoBadge": "自动",
    "autoBadgeTooltip": "自动检测，请确认",
    "evidence": "依据",
    "warningsTitle": "探测警告",
    "noResults": "无法识别端点信息，请手动填写",
    "ssrfBlocked": "出于安全考虑，该地址不允许探测"
  }
  ```

#### 4.6.3 Discover 区块 UX

- baseUrl 输入下方加一行 Discover 按钮 + 说明
- 点击后：
  - 按钮变 spinner + "探测中…"，**禁用 Save 按钮**（防表单半填提交）
  - 5 秒后（或更早返回）→ Discover 区块展开 health 摘要 + 推断结果
- 推断结果展示：每个推断字段在表单对应位置显示淡色 placeholder + `auto` 徽章
- 顶部 banner：
  - 全 success → 淡绿色 "已检测到 X 个字段，请确认"
  - 部分 fail → 淡黄色 "X 字段已检测，Y 字段失败：[...]"
  - 全 fail → 淡红色 + 错误说明 + "请手动填写"
- 字段处理：
  - `value !== null && confidence != "unknown"` → 渲染 placeholder + auto 徽章
  - hover auto 徽章 → tooltip 显示 evidence
  - 用户编辑后徽章消失（react-hook-form `dirtyFields`）
- 一键应用按钮：把所有未 dirty 的推断字段写入表单值（保留用户已改的字段）
- Edit 模式：Discover 按钮始终可见，点击后**仅覆盖未 dirty 字段**

#### 4.6.4 React Query hook

```typescript
// queries.ts 增加
export function useDiscoverConnection() {
  return useMutation({
    mutationFn: async (input: DiscoverConnectionRequest) => {
      const res = await api.post("/connections/discover", input);
      return discoverConnectionResponseSchema.parse(res);
    },
  });
}
```

### 4.7 错误处理

| 场景 | HTTP | 行为 |
|---|---|---|
| baseUrl 非 URL | 400 | Zod 校验失败，标准错误格式 |
| SSRF reject | 400 | `{ message: "URL not allowed", reason: "..." }` |
| 全部 probe 失败 | 200 | `inferred` 全 unknown + `health.warnings` 列出原因 |
| 单 probe 失败 | 200 | 该字段 confidence=unknown，`probesFailed` 列出 |
| Throttle 超限 | 429 | 标准 throttle 响应 |

UI 对应：400 时 banner 红色，200 + 全 unknown banner 红色（"无法识别"），200 + 部分成功 banner 黄色，200 + 全成功 banner 绿色。

### 4.8 不做（明确，再次声明）

- ✗ tokenizer 字段处理（从 Discover scope 完全移除，→ #156 接管）
- ✗ POST 试 chat/embeddings/image 端点（消耗 token）
- ✗ 多模型一次发现 + 批量创建（V2，UI 复杂度高）
- ✗ HuggingFace API 二次验证 model id（V2，避免外部网络依赖）
- ✗ "auto-tag" 自动入库（永远要用户 Apply）
- ✗ 真正的 Prometheus 服务器发现（架构上不可能 100% 自动）
- ✗ Higress AI Gateway 深度发现 / APISIX / Envoy 网关侧识别（V2）
- ✗ 检测 customHeaders / queryParams 模板（用户场景太杂，反而出错）

## 5. 工程约束

- 不引入新 npm 依赖（`undici` / `dns` 都是 Node 内置或已有）
- 不引入新 Python 依赖（不影响 runner）
- 0 Prisma 迁移
- shadcn `sheet` 组件用官方 CLI 生成，不手写
- e2e 用 mock OpenAI-compatible server（在 `e2e/` 下加 fixture），不依赖真实 vLLM/SGLang 实例

## 6. Test plan

### 6.1 单元（Vitest, apps/api）

- `ssrf-guard.spec.ts`：
  - 协议白名单（http/https 通过，ftp/file/gopher 拒绝）
  - 硬编码黑名单（4 个 metadata host）
  - DNS resolve 后再校验
  - 私有 IP 允许（10.x / 172.16.x / 192.168.x / 127.x）
  - 公网 IP 允许
- 每个 probe spec：mock `globalThis.fetch`，覆盖 200 / 404 / 401 / timeout / abort 路径
- 每个 inference rule spec：表驱动测试，覆盖 manifest 列出的所有引擎 + 已知 model id 模式
- `discovery.service.spec.ts`：mock 4 个 probe，验证 orchestrator 把结果聚合成 B+ 形状

### 6.2 单元（Vitest, apps/web）

- `ConnectionSheet.test.tsx`：迁移自 ConnectionDialog.test.tsx，验证表单 happy path 不变
- `ConnectionSheet.discover.test.tsx`（新）：
  - 点击 Discover 按钮 → mock useDiscoverConnection 返回成功 → 字段 placeholder 渲染、auto 徽章可见
  - 编辑后 auto 徽章消失
  - 一键应用 → 未 dirty 字段填入 form values
  - Edit 模式重新 Discover → 已 dirty 字段不被覆盖

### 6.3 e2e (Playwright)

- `e2e/connection-discover.spec.ts`：
  - 新 fixture：`mock-vllm-server.ts`（基于 `http.createServer` 的最小 mock，暴露 `/v1/models` `/metrics`（含 `vllm:` prefix）`/health`）
  - 新建 Connection → 输入 mock baseUrl → 点 Discover → 等待结果 → 验证 serverKind = vllm、category = chat、suggestedTags 含 "vllm" "chat"
  - SSRF：输入 `http://169.254.169.254/` → 点 Discover → 红色 banner 显示拒绝
  - Edit 模式：打开已存在 Connection → 改 baseUrl 但保持 model 为旧值 → Discover → 验证 model 字段不被覆盖

### 6.4 类型 + lint
- `pnpm type-check` / `pnpm lint` / `pnpm test` 三项必须通过

## 7. Risks

| 风险 | 缓解 |
|---|---|
| 某些 upstream 把 `/metrics` 暴露在非默认路径（如 Spring `/actuator/prometheus`） | V1 仅识别默认路径，warning 中提示 |
| Cloudflare-fronted endpoints 可能因 UA 检测 block 服务端探测 | 错误信息明确；用户可手动填表 |
| DNS 解析在 corporate proxy 下慢 → 拖累总耗时 | 全局 5s timeout + 全部 probe 并行 |
| Sheet 组件首次引入可能与现有 layout 冲突 | 单独一个迁移 commit 隔离风险，e2e 提早覆盖 |
| ConnectionDialog 测试迁移漏掉 selector | Component test 必须先全绿 |

## 8. 关联

- Issue: #151
- Umbrella: #155
- 横向 MCP standard: #132
- Tokenizer 处理拆出: #156（不在本 PR 范围）
- 现有引擎 manifests: `packages/contracts/src/engine-metrics/manifests/`（被 §4.4.1 复用）
- 现有 Throttle 模式参考: `apps/api/src/modules/connection/connection.controller.ts:53` (`revealKey`)
- 项目规范: `docs/project-standards.md`、`apps/web/CLAUDE.md`（form 与 layout 约定）
