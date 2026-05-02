> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Playground 设计方案

**日期**：2026-04-29
**作者**：weetime001@gmail.com（与 Claude 协同 brainstorming）
**状态**：approved — 待 writing-plans 拆解
**相关**：
- 复用 E2E Smoke 的 `ProbeCategorySchema`（[`packages/contracts/src/e2e-test.ts`](../../../packages/contracts/src/e2e-test.ts)）
- 复用 `EndpointPicker` / `EndpointSelector` 模式（[`apps/web/src/components/connection/EndpointPicker.tsx`](../../../apps/web/src/components/connection/EndpointPicker.tsx)）
- 参照 GPUStack Playground UX（chat / image / audio / embedding / rerank 5 sub-page）

## 1. 目标

为 ModelDoctor 增加一个手动验证用的 Playground 区域，覆盖 5 类模态：对话 / 图像 / 语音 (TTS+ASR) / 嵌入 / 重排。Playground 与现有的"性能 / 正确性 / 可观测性"侧边栏分组并列，定位是**手动体验 + 调参 + 生成示例代码**，与 E2E Smoke 的"自动化 probe"和 Load Test 的"压测"互补。

同时为支持 Playground 的"按模态过滤连接"体验，扩展 Connection 数据模型，加入 `category`（必填单选）+ `tags`（自由多选），并在所有 Connection 相关 UI 中展示与编辑。

## 2. 范围

### 2.1 v1 包含

- 5 个模态 sub-page：Chat / Image / Audio / Embeddings / Rerank
- 多模型对比（Chat 的 2/3/4 panel 并排）
- Embeddings 输出的 2D PCA 可视化（自写 SVG）
- 各模态独立的会话历史（localStorage，最近 20 条）
- View Code 弹窗：curl / Python / Node.js
- Connection 模型扩展：category + tags
- "智能默认 + 手动展开" 的连接过滤策略

### 2.2 v1 不包含（留 v2+）

- Image 编辑/inpaint（蒙版画布交互）
- Compare 模式扩展到 6 panel
- 历史持久化到后端
- "文件" 类多模态附件（仅 placeholder）
- PCA 升级到完整图表库

## 3. 数据模型变更

### 3.1 Connection 扩展

`apps/web/src/types/connection.ts`：

```ts
export type ConnectionCategory = 'chat' | 'audio' | 'embeddings' | 'rerank' | 'image';

export interface Connection {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  customHeaders: string;
  queryParams: string;
  category: ConnectionCategory;   // 新增·必填
  tags: string[];                  // 新增·可选 (默认 [])
  createdAt: string;
  updatedAt: string;
}
```

### 3.2 Contracts 共用化

把 `packages/contracts/src/e2e-test.ts` 中的 `ProbeCategorySchema` 提到新文件 `packages/contracts/src/modality.ts` 重命名为 `ModalityCategorySchema`：

```ts
export const ModalityCategorySchema = z.enum(['chat', 'audio', 'embeddings', 'rerank', 'image']);
export type ModalityCategory = z.infer<typeof ModalityCategorySchema>;
```

`e2e-test.ts` 改为 `export const ProbeCategorySchema = ModalityCategorySchema;` 别名（保留向后兼容的命名）。前端 `Connection.category` 直接用 `ModalityCategory`。

### 3.3 localStorage 迁移

`connections-store` 的 persist version 由 `1` bump 到 `2`。按 CLAUDE.md "no compat shims" 政策：旧数据被 zustand persist 自动丢弃，UI 显示空连接库提示。导出 JSON 的 `version` 字段同步 bump（旧导出文件导入时报错"版本不兼容"）。

### 3.4 Tag 预设

`ConnectionDialog` 的 tag 输入下方建议列表 = `所有现有 connection 的 tags ∪ 内置预设`：

```ts
const PRESET_TAGS = ['vLLM', 'SGLang', 'TGI', 'Ollama', 'OpenAI', 'Anthropic', '多模态', 'streaming', 'production', 'test'];
```

校验：去重 + trim + 过滤空字符串。

## 4. 路由 & 侧边栏

### 4.1 新路由（`apps/web/src/router/index.tsx`）

```
/playground                 → redirect /playground/chat
/playground/chat            → ChatPage
/playground/chat/compare    → ChatComparePage
/playground/image           → ImagePage
/playground/audio           → AudioPage   (内部 ?tab=tts|stt)
/playground/embeddings      → EmbeddingsPage
/playground/rerank          → RerankPage
```

均位于 `<ProtectedRoute>` 之下，与现有页面同级。

### 4.2 侧边栏分组

新增 group `playground` 排在 `performance` 之上：

```
▼ Playground
  💬 Chat
  🖼 Image
  🎙 Audio
  🧬 Embeddings
  ↕ Rerank
▼ Performance
  ...
```

`Compare` 不作为单独侧边栏 item — 它是 ChatPage 顶部的二级 tab。

### 4.3 i18n 命名空间

新增 `apps/web/src/locales/{en-US,zh-CN}/playground.json`，结构：

```json
{
  "title": "Playground",
  "categories": { "chat": "...", "image": "...", "audio": "...", "embeddings": "...", "rerank": "..." },
  "chat": { "system": {}, "composer": {}, "params": {}, "compare": {} },
  "image": {}, "audio": { "tts": {}, "stt": {} }, "embeddings": {}, "rerank": {},
  "viewCode": { "title", "copy", "keyPlaceholder" },
  "history": { "title", "newSession", "restore", "empty" },
  "endpoint": { "categoryFilter", "showAll", "categoryMismatch" }
}
```

`sidebar.json` 加 `groups.playground` + 5 个 items。`connections.json` 加 `category.*` + `tags.*` 相关 key。

## 5. 共用 UI 组件

### 5.1 `PlaygroundShell`

所有 sub-page 套这个壳。布局：

```
┌────────────────────────────────────────────────────────┐
│ [tabs (可选)]                  [</> 查看代码] [⊟ 折叠] │  header
├──────────────────────────────────────┬─────────────────┤
│                                      │  连接 ▾          │
│  主区 (sub-page 自定义内容)           │  ─────────────  │
│                                      │  <paramsSlot/>   │
└──────────────────────────────────────┴─────────────────┘
```

Props：

```ts
interface PlaygroundShellProps {
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  viewCodeSnippets?: { curl: string; python: string; node: string } | null;
  paramsSlot: React.ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: React.ReactNode; // 主区
}
```

折叠状态由各模态 store 持久化。

### 5.2 `CategoryEndpointSelector`

新建组件（**不改** 现有 `EndpointSelector`，避免破坏 Load Test/E2E 已有窄场景）。

行为：
- 默认下拉只列 `c.category === category` 的连接
- 列表顶部 `[显示全部 □]` toggle；勾选后所有连接列出，但 `c.category !== category` 项**置灰** + hover tooltip "category 不匹配（仍可选用）"
- 当前选中连接如不在过滤集合且 toggle 关闭：picker 顶部显示 warning chip "当前连接是 X 类，与本页 Y 不符 [清除选择]"
- 底部 "+ 新建连接" 入口预填 `category = <当前页>`

### 5.3 `ConnectionDialog` 升级

- 新增 `category` 必填 `Select`（5 选项）
- 新增 `tags` 输入：chip 风格 + Enter 添加 + 下方建议列表
- 新增校验：category 必填；tags 去重 trim

### 5.4 `ConnectionsPage` 升级

表格新增 `category` 列（彩色徽章）+ `tags` 列（chip 串）；列表头加 `[category ▾]` `[tag ▾]` 多选 chip 过滤器。

### 5.5 `ParamsPanel`

极薄包装：折叠/展开过渡 + 滚动条 + 一致 padding/字号；不强制结构。

### 5.6 `ViewCodeDialog`

```ts
interface ViewCodeDialogProps {
  snippets: { curl: string; python: string; node: string };
  open: boolean;
  onOpenChange: (b: boolean) => void;
}
```

shadcn `Tabs` × 3 + 每 tab 一个 `<pre>` + `[复制]` 按钮 + 底部小字 "API key replaced with placeholder"。

### 5.7 `HistoryStore`

每模态独立的 zustand store，key 区分（`md-playground-history-chat` 等）。

```ts
interface HistoryEntry<S> {
  id: string;
  createdAt: string;
  connectionName: string | null;
  snapshot: S;            // 模态 store 的可序列化部分
  preview: string;        // UI 展示用的一行摘要
}
```

语义：列表中**最新一条** ≡ 当前会话。即每个模态打开时，要么继承最新条目作为当前 session，要么（新用户/无历史）即 instant 创建一条空白条目作为 current。

行为：
- store 任何变更（消息、参数、连接）触发 debounce 1500ms → 更新当前条目（同一 id）的 snapshot + preview
- 用户点 `[+ 新会话]`：在列表头部 prepend 新空白条目 → 当前 session 切到这条 → 旧条目自然变成"历史"
- 列表 ≥ 20 时 LRU 淘汰最旧
- 点击非当前条目 → 弹 confirm "覆盖当前会话？" → 把目标条目的 snapshot copy 进当前条目（不删除原条目；原条目变成"历史"中的一条）

## 6. 各模态页面细节

所有页面继承 `PlaygroundShell`，主区结构如下。

### 6.1 Chat (`/playground/chat`)

**主区**：
- 顶部：`system message` 单行可编辑 textarea
- 中：消息流。每条 = `<MessageBubble>`，含 role 切换 (user/assistant) / 删除 / 编辑；assistant 渲染 markdown + code-block + 复制按钮
- 底：composer = 多行输入 + `[🖼 上传图]` `[🎙 上传音]` `[📄 文件 (placeholder)]` + `[+ 添加] [▷ 发送 / ⬛ 停止]`
- 流式：assistant 消息一边到达一边渲染；停止按钮 abort `AbortController`

**右侧参数**（连接 ▾ 之下）：Temperature / Max Tokens / Top P / Frequency Penalty / Presence Penalty / Seed / Stop Sequence / Stream toggle (默认 on)

**多模态附件**：
- 图：base64 → `image_url` content part
- 音：base64 → `input_audio` content part
- 文件：仅显示文件名（v1 不发送）

**store**：

```ts
interface ChatStore {
  selectedConnectionId: string | null;
  endpoint: EndpointValues;
  systemMessage: string;
  messages: Message[];
  params: ChatParams;
  streaming: boolean;
  rightPanelOpen: boolean;
  // actions...
}
```

**API**：`POST /api/playground/chat`

### 6.2 Chat Compare (`/playground/chat/compare`)

**顶部**：`[2 ▢▢] [3 ▢▢▢] [4 ▢▢▢▢]` panel 数切换

**下方**：N 列并排，每列 = mini ChatPage（独立 connection / params / messages / streaming）。共用 `system message` 和顶部 composer。

**发送**：composer 触发 → 并行 broadcast user message 到 N 个 panel → 各 panel 独立流式展示。

**store**：`panels: PanelState[]`（每 panel 独立的 connection、params、messages、streaming）

### 6.3 Image (`/playground/image`)

**主区**：
- 大块预览区（占 65vh 左右）：默认 placeholder "生成的图片将出现在这里"
- 底部：prompt 输入 + `[🎲 随机]` 按钮 + `[▷ 发送]`
- 生成完成后图片下方：`[下载] [复制 base64] [作为新输入]`

**右侧参数**：尺寸 (256² / 512² / 1024² / 自定义) / Seed / 随机种子 toggle / N（默认 1）

**store**：`prompt`, `params`, `result?: { url?: string, b64?: string }[]`, `loading`

**API**：`POST /api/playground/images`

### 6.4 Audio (`/playground/audio`)

内部 tabs `文本转语音 / 语音转文本`，URL `?tab=tts|stt`（默认 tts）。

#### 6.4.1 TTS

**主区**：
- 大预览区：音频 player (`<audio controls>`) 或 placeholder
- 底部：文本输入 + `自动播放 ☑` toggle + `[▷ 发送]`

**右侧参数**：声音 voice (string) / 格式 format (mp3 / wav / flac) / `▼ 高级`：任务类型 / 语言 / 说明 / Max Tokens / 参考音频上传 / 参考音频文本

**API**：`POST /api/playground/audio/tts`

#### 6.4.2 STT

**主区**：上传区（drag & drop + `[🎙 录音]`）→ audio player → `[▷ 转录]` → 文本结果（可复制）

**录音**：`MediaRecorder` API。非 https/localhost 时按钮 disabled + tooltip。权限拒绝走 toast.error。

**右侧参数**：语言 (auto / zh / en / …) / 任务类型 (transcribe / translate)

**API**：`POST /api/playground/audio/transcriptions`（multipart/form-data）

### 6.5 Embeddings (`/playground/embeddings`)

**主区上半**：编号文本行 + `[+ 添加文本] [清除] 批量输入 ☑` + `[▷ 发送]`。批量输入开启后变成单 textarea，按 `\n` split。

**主区下半**：输出区
- 子 tabs `图表 / JSON`
- 图表：自写 SVG 散点图，输入数 ≥ 3 才出图（否则显示 "≥3 条文本才能可视化"）。点 hover 显示对应文本。PCA 实现：`apps/web/src/features/playground/embeddings/pca.ts` 纯函数 `computePca2D(vectors: number[][]): [x, y][]`，用 power-iteration 求前 2 个主成分（~80 行 TS，无外部依赖；典型 ≤ 30 点 × ≤ 4096 维 < 50ms）。
- JSON：折叠 raw embeddings 数组，可复制

**右侧参数**：encoding_format (float / base64) / dimensions (可选)

**API**：`POST /api/playground/embeddings`

### 6.6 Rerank (`/playground/rerank`)

**主区**：query 单行 → 文档列表（同 Embeddings 编号行 + 批量模式）→ `[▷ 发送]` → 结果列表（按 score 降序，每条带 score 进度条 + 原始 index）

**右侧参数**：Top N (默认 3) / return_documents toggle

**API**：`POST /api/playground/rerank`（兼容 cohere 与 tei 两种 wire；通过 `pathOverride` 区分）

## 7. 后端

### 7.1 模块结构

新增 `apps/api/src/modules/playground/`：

```
playground/
├── playground.module.ts
├── playground.controller.ts
├── playground.service.ts
├── chat/
│   ├── chat.controller.ts        # POST /api/playground/chat (含 SSE 模式)
│   └── chat.service.ts
├── embeddings/  (controller + service)
├── rerank/      (controller + service)
├── images/      (controller + service)
└── audio/
    ├── tts.controller.ts          # POST /api/playground/audio/tts
    └── stt.controller.ts          # POST /api/playground/audio/transcriptions (multipart)
```

### 7.2 共用 OpenAI 客户端

把 E2E probe 现有的"构造 OpenAI 兼容请求 + 解析响应"逻辑抽到 `apps/api/src/integrations/openai-client/`：

- `buildHeaders(apiKey, customHeaders)`
- `buildUrl(apiBaseUrl, defaultPath, pathOverride)`
- 各 wire 的 builder（chat / embeddings / rerank-cohere / rerank-tei / images / tts / stt）
- 各 wire 的 response parser

E2E probe 重构使用同一套（同一 PR 内或单独 refactor PR，留 plan 决定）。

### 7.3 SSE 流式转发

Chat 当 `params.stream === true`：

```ts
@Post('chat')
async chat(@Body() body, @Res() res: Response) {
  if (body.params?.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    const upstream = await fetch(url, { ... });
    if (!upstream.body) throw ...;
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
    return;
  }
  // 非流式：原样 JSON 透传
  ...
}
```

前端用 `fetch` + `reader.read()` 解析 SSE chunk（不用 `EventSource`，因为 `EventSource` 不支持 POST + Authorization header）。

### 7.4 Contracts (`packages/contracts/src/playground.ts`)

```ts
export const PlaygroundChatRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),
  systemMessage: z.string().optional(),
  messages: z.array(ChatMessageSchema).min(1),
  params: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    presencePenalty: z.number().optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
  }).default({}),
});

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([
    z.string(),
    z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({ type: z.literal('image_url'), image_url: z.object({ url: z.string() }) }),
      z.object({ type: z.literal('input_audio'), input_audio: z.object({ data: z.string(), format: z.string() }) }),
    ])),
  ]),
});

// 类似的：PlaygroundEmbeddingsRequestSchema / Rerank / Images / TTS / STT
```

## 8. 代码生成

每模态一个 pure 函数 `genSnippets(state): { curl, python, node }`：

- `curl`：`curl -X POST $URL -H "Authorization: Bearer <YOUR_API_KEY>" -H "Content-Type: application/json" -d '<pretty json>'`
- `python`：`from openai import OpenAI; client = OpenAI(base_url=..., api_key="<YOUR_API_KEY>"); resp = client.chat.completions.create(...)`
- `node`：`import OpenAI from 'openai'; const client = new OpenAI({ baseURL: ..., apiKey: '<YOUR_API_KEY>' }); const resp = await client.chat.completions.create(...)`

API key **始终** 用 `<YOUR_API_KEY>` 占位，不输出真实 key。弹窗底部小字声明这一点。

## 9. 测试策略

| 层 | 范围 | 工具 |
|---|---|---|
| Connection store | category 必填 / 默认 tags / v1→v2 reset / 导出 version 升级 | vitest |
| 各模态 store | 增删消息 / patch params / 历史 LRU / restore 覆盖 | vitest |
| `CategoryEndpointSelector` | 默认过滤 / 显示全部 / 不匹配 warning chip / "+ 新建" 预填 | vitest + RTL |
| `ConnectionDialog` | category 必填校验 / tag chip 增删 / autocomplete 建议过滤 | vitest + RTL |
| 各 sub-page render smoke | 空态、提交按钮 disabled 条件、流式中断 | vitest + RTL（mock fetch） |
| `code-snippets` | snapshot：5 模态 × 3 语言 = 15 个 snapshot | vitest |
| 后端 playground service | URL 拼接 / header 注入 / SSE pipe / 错误透传 | vitest（mock fetch） |
| **不做** | 浏览器到真实上游的 e2e | — |

## 10. 分阶段交付

3 个 phase = 3 个 PR，从 `main` 切 `feat/playground-phase-N-<slug>` 分支。

### Phase 1 · 地基（~2-3 天）

- 提取 `ModalityCategorySchema` 到 `packages/contracts/src/modality.ts`，e2e-test 改用别名
- Connection 模型加 category + tags（含 store v1→v2、Dialog UI、表格 UI、过滤 chip）
- `CategoryEndpointSelector` 组件 + `PlaygroundShell` + `ParamsPanel` + `ViewCodeDialog` + `HistoryStore`
- 路由壳 + sidebar 分组 + i18n key 落位
- ChatPage **仅文本、非流式、不带历史** —— 跑通最小端到端
- 后端 `/api/playground/chat` 非流式
- 验收：能从空连接库新建 chat 类连接，在 ChatPage 选中，发一句话拿到 assistant 回复

### Phase 2 · Chat 完善 + 三个静态模态（~3-4 天）

- Chat 加 SSE 流式 / 多模态附件 / 停止按钮
- ImagePage + EmbeddingsPage + RerankPage 完整
- 各模态 ViewCode + History 接通
- PCA SVG 自写
- 后端 `/api/playground/{embeddings,rerank,images}` + chat SSE
- 验收：4 模态 + ViewCode + History 全部可用

### Phase 3 · Audio + Compare（~3-4 天）

- AudioPage TTS + STT（含 MediaRecorder）
- 后端 `/api/playground/audio/{tts,transcriptions}`（multipart 的 transcriptions）
- ChatComparePage 2/3/4 panel 并行
- 验收：5 模态全开 + 多模型对比

## 11. 项目约束自查

- `apps/api/tsconfig.json` 不动 `incremental` ✓
- vitest@2 / vitest@1 不统一 ✓
- 无新增顶层依赖（PCA 自写 SVG）✓
- 不动 prisma migrations / docker compose ✓
- localStorage v1→v2 直接丢旧数据（已与用户确认）✓
- conventional commits + 一 phase 一 PR ✓

## 12. 与 E2E Smoke 的关系

E2E Smoke 在 Playground 上线后**保留**，定位为互补而非替代：

| 维度 | E2E Smoke | Playground |
|---|---|---|
| 任务 | 自动化 probe，输出 pass/fail | 手动体验 + 调参 |
| 输入 | 固定 canned input | 用户自由输入 |
| 输出 | 结构化 checks（latency / JSON 形状 / MIME / 内容不为空） | 模型原始响应 |
| 协议探测 | 同 category 跑多个 wire 变体（`embeddings-openai` + `embeddings-tei` 都试） | 用户事先在 Connection 里指定 |
| 典型时机 | 部署后快速验活、CI、连接配置完成后一键验证 | prompt 工程、demo、参数调优、问题复现 |

典型互补流程：连接配错 → Playground 报错没头绪 → 切 E2E Smoke 一键看是 `tei` 还是 `openai` 形状能通 → 回去改 Connection 的 path → 再回 Playground 继续。

**未来动作**：v2 观测到使用率重叠后再考虑是否把 E2E Smoke 降级为 Playground 内的一个 `[🩺 Smoke 检查]` 二级 tab。v1 保持现状。

## 13. 开放问题（writing-plans 阶段决定）

1. **E2E probe 的 `openai-client` 抽取的 PR 切法**。两种选项：
   - (a) Phase 1 内做（reasonable，因为 Phase 1 后端就要用同一套 builder/parser；E2E 切换到新 client 是机械重构）
   - (b) 单独前置 PR `refactor/openai-client-extraction`，再做 Phase 1
   - 倾向 (b)，避免 Phase 1 PR 体积爆炸；但 plan 阶段可重新评估实际工作量。
2. **历史条目的"复制覆盖" vs "切换指针"语义**（§ 5.7）：当前 spec 选 "复制" 以避免误编辑历史条目；如果 plan 阶段评估实现复杂度后觉得"切指针 + 显式只读"更简单，可重新讨论。
