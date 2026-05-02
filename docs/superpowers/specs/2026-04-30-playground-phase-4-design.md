> **Status: ✅ Completed · historical record.** 本文是提交时的设计/计划快照；其中字段名、目录路径、env 名、API 路由为当时状态，重构后已演进。**当前实现请以代码与 `CLAUDE.md` 为准；本文正文不再修改，仅作归档。**

# Playground Phase 4 — 100% Completion

**日期**：2026-04-30
**分支**：`feat/regression-suite`
**前置条件**：第一步 `git fetch origin && git merge origin/main` 把 PR #29 合回来
**目标**：把 Playground 收尾到"用户视角无任何半成品 / 占位符 / disabled UI"。完成后 v2 backlog 清零，sidebar 上"Playground"组的 5 个页面全部端到端 100% 可用。
**范围切法**：用户选择 δ —— 9 项一锅出，单一 Phase 4 PR；commit 粒度按 9 个 item 各自分开 + 共享基建独立 commit。

## 1. 范围

### 1.1 v1 已交付（无需改动 / 引用基线）

5 个 modality 端到端可用 + history + code generation + Compare（仅 chat）。详见 `2026-04-29-playground-design.md` 与 `2026-04-30-playground-phase-3-design.md`。

### 1.2 Phase 4 包含（9 项 + 2 项共享基建）

**真 feature 缺失（v2 列出但未写）**：

- **F1** TTS 声音克隆（reference audio + reference text）
- **F2** Image inpaint / mask 编辑
- **F3** Compare 扩展到 6 / 8 panel

**Polish（功能在但未闭环）**：

- **P1** 多模态 chat `file` kind 真发上游
- **P2** Audio history 恢复 TTS result audio
- **P3** Compare history 持久化 messages
- **P4** Chat history 多模态附件持久化

**Cosmetic（产品定位决定要做）**：

- **C1** Embeddings PCA → ECharts；建立全站 chart wrapper 基建
- **C2** Code snippet base64 截断 UX 重做

**共享基建**（先于 9 项落地，被多项依赖）：

- **I1** IndexedDB-based history-store util（被 P2 / P3 / P4 共用）
- **I2** `<Chart>` wrapper 组件（被 C1 + 未来 5 个 observability 页面共用）

### 1.3 Phase 4 不包含（明确推迟）

- sidebar 上 Soak / Streaming TTFT / Regression / Health Monitor / History 5 个 ComingSoon 页面（独立 phase）
- v1 spec § 12 "Smoke 降级为 Playground sub-tab"（等使用率数据再决定）
- Image inpaint 的 mask 笔触历史撤销（只做单步 Undo + Reset，不做无限 history stack）
- Compare panel 上限超过 8

## 2. 共享基建

### 2.1 I1 — `history-store.ts` IndexedDB util

**位置**：`apps/web/src/lib/history-store.ts`

**依赖**：新增 `idb` 包（~3 KB gzipped，wraps IndexedDB with promise API），加到 `apps/web/package.json` dependencies。

**API**：

```ts
export interface HistoryStore<T> {
  list(): Promise<HistoryEntry<T>[]>;          // 按 createdAt 倒序
  get(id: string): Promise<HistoryEntry<T> | null>;
  put(entry: HistoryEntry<T>): Promise<void>;  // upsert
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface HistoryEntry<T> {
  id: string;            // uuid
  createdAt: number;     // Date.now()
  label?: string;
  payload: T;
  blobs?: Record<string, Blob>;  // 大附件单独 IDB store
}

export function createHistoryStore<T>(opts: {
  dbName: 'modeldoctor-playground';
  storeName: 'chat' | 'compare' | 'audio' | 'image' | 'embeddings' | 'rerank';
  maxEntries?: number;   // 默认 50；超过 LRU evict
  maxBytesPerEntry?: number;  // 默认 25 MB（拒收过大 entry，提示用户）
}): HistoryStore<T>;
```

**Schema**：

- 一个 IDB database `modeldoctor-playground`（version 1）
- 6 个 object store（每 modality 一个）+ 一个 `blobs` store 存附件 Blob，用 `entryId+key` 复合主键
- 不写迁移：旧 localStorage 历史按"no compat shim"政策直接丢弃；首次进入 Playground 任何页面时 toast 一次性提示"History storage upgraded — previous local history was reset"

**LRU eviction**：put 时若 count > maxEntries，按 createdAt 升序删旧；blob store 联动删。

**测试**（`history-store.test.ts`）：使用 `fake-indexeddb` 包；put → list 顺序 / get / delete / LRU eviction / blob 关联删除 / 超 maxBytesPerEntry 抛错。

### 2.2 I2 — `<Chart>` wrapper

**位置**：`apps/web/src/components/charts/Chart.tsx` + 同目录 `theme.ts`、`index.ts`

**依赖**：新增 `echarts` (~330 KB gzipped tree-shaken) + `echarts-for-react` (~3 KB)，加到 `apps/web/package.json`。**Tree-shaking 严格**：只 import 用到的 chart kind（scatter / line / bar / heatmap）+ tooltip / grid / dataZoom / title 模块，不用 `echarts/index`。

**API**：

```tsx
type ChartKind = 'scatter' | 'line' | 'bar' | 'heatmap';

interface ChartProps<K extends ChartKind> {
  kind: K;
  data: ChartDataFor<K>;          // 见下
  options?: Partial<EChartsOption>; // 透传额外 ECharts 配置
  theme?: 'auto' | 'light' | 'dark';  // 默认 auto，跟全站 theme
  height?: number | string;        // 默认 360
  loading?: boolean;
  empty?: boolean | string;        // true 显示默认 empty；string 自定义文案
  ariaLabel: string;               // 必填，无障碍
}

// kind=scatter
type ScatterPoint = { x: number; y: number; label?: string; color?: string };
type ChartDataFor<'scatter'> = { points: ScatterPoint[]; xLabel?: string; yLabel?: string };

// kind=line / bar
type Series = { name: string; data: Array<[number | string, number]>; color?: string };
type ChartDataFor<'line' | 'bar'> = { series: Series[]; xLabel?: string; yLabel?: string };

// kind=heatmap
type Cell = { x: number | string; y: number | string; value: number };
type ChartDataFor<'heatmap'> = { cells: Cell[]; xLabels: string[]; yLabels: string[] };
```

**Theme adapter**：`theme.ts` 暴露 `lightTheme` / `darkTheme` 两份 ECharts theme JSON，色板对齐 Tailwind 主色（primary `oklch(...)`、muted、destructive）。组件根据 `useTheme()` 切换。

**Loading / empty**：内置 skeleton 与 empty state，避免每个页面重写。

**测试**（`Chart.test.tsx`）：scatter / line / bar / heatmap 各一个 render snapshot；loading / empty 分支；theme 切换断言色板。

## 3. F1 — TTS 声音克隆

### 3.1 协议

`POST /api/playground/audio/tts` body 扩展（JSON，不切 multipart）：

```ts
PlaygroundTtsRequest extends {
  // existing: model, input, voice, response_format, speed
  reference_audio_base64?: string;  // 'data:audio/wav;base64,...' 完整 data URL
  reference_text?: string;          // 可选，部分 server (GPT-SoVITS) 需要参考文本
}
```

backend 对 reference_audio_base64 做：

- 校验 data URL 前缀 `data:audio/(wav|mp3|webm|ogg|flac);base64,`
- 解 base64 byte 长度 ≤ 20 MB（TTS body 整体已有 20 MB 限制，但 reference 单字段还要 ≤15 MB 留出余量给其他字段）
- 不重新编码，原样转发到 upstream（GPT-SoVITS / F5-TTS / IndexTTS / vLLM-TTS 都接受同字段）

**Contracts diff**：`packages/contracts/src/playground.ts` 的 `PlaygroundTtsRequestSchema` 加两个 optional 字段。

### 3.2 前端

`apps/web/src/features/playground/audio/TtsTab.tsx`：

- 解锁现有 disabled 的 Reference Audio + Reference Text 字段
- Reference Audio：文件选择器（accept `audio/wav,audio/mp3,audio/webm,audio/ogg,audio/flac`），15 MB 上限，选中后立即转 base64 存 state，UI 显示 filename + 时长 + 大小
- Reference Text：单行 textarea，placeholder "Optional — the transcript of the reference audio"
- 提交时把两字段加入 request body
- i18n：删除 `audio.tts.advancedV2Note`，改为新 key `audio.tts.referenceAudioHint` / `audio.tts.referenceTextHint`

**测试**：选文件 → state 含 base64；超大文件 → 错误提示；空 reference_audio 也允许提交（向后兼容现有 v1 流程）。

### 3.3 Code snippets

`code-snippets/audio.ts` 的 TTS 生成器加 reference_audio_base64 / reference_text 输出（base64 走新 truncation rework，见 C2）。Snapshot 更新 6 份（curl/python/node × 含/不含 reference）。

## 4. F2 — Image inpaint / mask 编辑

### 4.1 协议

新 endpoint：`POST /api/playground/images/edit` —— **multipart**，因 mask 是二进制 PNG。

```ts
// multipart fields:
//   image:    Blob (PNG / JPEG / WebP, ≤4 MB)
//   mask:     Blob (PNG with alpha channel, 同尺寸, ≤2 MB) — 必须 PNG，因为只有 PNG 携带 alpha
//   prompt:   string (≤4000 chars)
//   model:    string
//   n:        number (1-4)
//   size:     '256x256' | '512x512' | '1024x1024'
//   apiBaseUrl, apiKey, customHeaders, queryParams (传 Connection 信息)
```

返回 200 `PlaygroundImagesResponse`（复用现有 schema：`{ images: Array<{ url? | b64_json? }>, latencyMs }`）。

**Contracts diff**：`PlaygroundImagesEditMultipartFieldsSchema`（仅 schema 化非 file 字段，file 部分由 NestJS `FileFieldsInterceptor` 处理）。

**Backend**：

- 新 `images.controller.ts` 路由 `@Post('edit') @UseInterceptors(FileFieldsInterceptor([{name:'image',maxCount:1},{name:'mask',maxCount:1}]))`
- `ImagesService.edit()` 调用新 wire `edit()` in `wires/images.ts`，构造 multipart form post 到 `${apiBaseUrl}/images/edits`（OpenAI 标准 endpoint）
- multer 单字段 5 MB 上限（image 4 MB + mask 2 MB 都在内）

### 4.2 前端

新增 `apps/web/src/features/playground/image/InpaintMode.tsx` + `MaskPainter.tsx`。`ImagePage.tsx` 顶部加 mode 切换 tab：**Generate** / **Edit (Inpaint)**。

**InpaintMode 流程**：

1. 用户 drop / 选一张图 → 预览
2. `<MaskPainter image={url} brushSize={N} onMaskChange={(blob)=>...} />` 在原图上覆盖一层 canvas，鼠标按下拖动 → 在 canvas 上画半透明红色 stroke（视觉上是 mask 区域）
3. Mask canvas 内部维护一张同尺寸的 PNG：用户笔刷区域 alpha=0（透明 = inpaint），其余 alpha=255（黑色不透明 = 保留）
4. Toolbar：brush size slider（10-100 px）、Reset（清空 mask）、Undo（最近一笔，单步即可）
5. 输入 prompt + 选 model + n + size → Submit
6. 提交 multipart form 到 `/api/playground/images/edit`
7. 结果显示在右侧（复用现有 `ImageGrid` 组件）

**MaskPainter 实现细节**：

- 两张 stacked canvas：底层 image，顶层 mask
- mask canvas 的 strokeStyle 初始是 `rgba(255,0,0,0.4)` 让用户看见，导出时把它转换成"alpha=0 in masked area, alpha=255 elsewhere" 的 PNG
- Undo 用 `getImageData` 在每次 mouseup 时入栈（最多 1 步）
- 导出：`canvas.toBlob(blob => ..., 'image/png')`

**i18n**：新 key 树 `image.inpaint.*`：mode 切换、brush size、reset、undo、提示语等。

**测试**（`MaskPainter.test.tsx`）：用 jsdom 不能完全测 canvas，所以只测 React props / event wiring；笔刷绘制在 e2e Playwright 里加 1 个冒烟。

### 4.3 i18n & 路由

复用现有 `/playground/image` 路由 + 路由内 `?mode=generate|edit` 控制 tab。

## 5. F3 — Compare 扩展到 6 / 8 panel

### 5.1 改动

`apps/web/src/features/playground/chat-compare/store.ts`：

```ts
export type PanelCount = 2 | 3 | 4 | 6 | 8;
```

`setPanelCount(n)` 逻辑保持不变（增长补 blankPanel，收缩 slice）。Persist version bump 到 `2`，旧持久化数据按 no-compat-shim 直接丢弃。

`ChatComparePage.tsx`：panel grid 改 CSS：

```css
/* 之前：硬编码 grid-cols-2/3/4 by panelCount */
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 0.75rem;
}
```

panel selector 下拉值改 `[2,3,4,6,8]`。`ChatModeTabs` 不变。

### 5.2 P3 配套（详见 § 7）

panel 数变化和 message 持久化是同一个 store —— P3 改完后 panelCount 变化时自动重新 partition stored messages。

### 5.3 测试

更新 `chat-compare/store.test.ts` 添加 panelCount=6 / 8 的 grow/shrink case；page-level 测试增加 6/8 panel render snapshot。

## 6. P1 — 多模态 chat `file` kind 真发上游

### 6.1 协议

OpenAI 2025 新版 `input_file` content part：

```ts
type InputFilePart = {
  type: 'input_file';
  file: {
    filename: string;
    file_data: string;  // 'data:application/pdf;base64,...'
  };
};
```

**白名单 mime**：

- `application/pdf`
- `text/plain`
- `application/json`
- `text/markdown` / `text/x-markdown`

**单文件上限**：8 MB（base64 后 ~10.7 MB，留余量给 chat body 整体 25 MB 上限）。

### 6.2 前端

`MessageComposer.tsx` 文件附件流程修改：

- 选文件后立即校验 mime（白名单）+ 大小（≤8 MB）→ 失败弹 toast
- 通过校验后 reader.readAsDataURL → state attachments append `{ kind: 'file', filename, mime, dataUrl, sizeBytes }`
- 渲染：保留现有"文件"chip（filename + 大小），**移除** "(not sent)" 标记

`ChatPage.tsx`（以及 `chat-compare/ChatPanel.tsx`）发送时，把 `kind === 'file'` 的 attachment 编码为 `input_file` content part 加入 `messages[i].content`。

**Contracts diff**：`packages/contracts/src/playground.ts` 的 `ChatMessageContentPartSchema` 加入新的 `input_file` discriminator：

```ts
const InputFilePartSchema = z.object({
  type: z.literal('input_file'),
  file: z.object({
    filename: z.string().max(256),
    file_data: z.string().regex(/^data:(application\/pdf|text\/plain|application\/json|text\/markdown|text\/x-markdown);base64,/),
  }),
});
ChatMessageContentPartSchema = z.discriminatedUnion('type', [
  TextPartSchema, ImageUrlPartSchema, InputAudioPartSchema, InputFilePartSchema,
]);
```

### 6.3 Code snippets

`code-snippets/chat.ts` 的 file part 不再被丢弃，输出真实 `input_file` JSON（base64 走 C2 truncation rework）。snapshot 更新（含 file 的 chat 6 份新 snapshot）。

### 6.4 测试

- `MessageComposer.test.tsx`：拒非白名单 mime；超 8 MB 报错；通过校验后 attachment 正确入队
- `ChatPage.test.tsx`：含 file attachment 的提交 body 含 `input_file` part
- 新 snapshot：含 file 的 code snippets

## 7. P2 / P3 / P4 — 历史持久化（共用 I1 IndexedDB）

### 7.1 P4 — Chat history 多模态附件持久化

`apps/web/src/features/playground/history/` 下原有的 chat snapshot util 改为读写 I1 store。

`HistoryEntry<ChatSnapshot>` 的 `payload` 存 message 文本 + content part 的元数据；**附件 binary 存 `entry.blobs[partKey]`**：

```ts
ChatSnapshot {
  systemMessage: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: ChatMessageContentPart[];  // 不含 base64 大字段
    attachmentRefs?: Record<string, { kind, filename, mime }>;  // 用 partKey 索引到 blobs
  }>;
  connectionId: string;
  params: ChatParams;
}
```

序列化：把 image_url / input_audio / input_file 的 base64 部分 strip 出来转成 Blob 存 `entry.blobs[`msg{i}.part{j}`]`，content part 保留元数据 + 占位的 ref id。

恢复：list/get 时把 `blobs` 读回来转成 data URL 重新插回 content part。

UI：history list / preview 不再显示"📎 N attachment(s) not saved"，而是真实显示缩略图 / audio player / 文件名。

### 7.2 P3 — Compare history 持久化 messages

`chat-compare/store.ts` 的 `partialize` 不再丢 `panels[i].messages`。message 走 I1 store —— 因为 compare 经常很大（最多 8 panel × 几十轮对话），所以 compare history 是**显式快照**：

- ChatComparePage 顶栏新增 "Save snapshot" 按钮 → 把当前 panels 状态（含 messages 与 attachment blobs）写入 I1 store name=`compare`
- 顶栏 dropdown "History" 列出已保存快照（按 createdAt 倒序）→ 选中恢复 panels + connections + params + messages
- 区分"工作中状态"（zustand persist localStorage 仍然只存 layout 不存 messages，避免 LS 爆）vs "用户主动 snapshot"（IndexedDB 全量）
- panelCount 变化时不动已保存的 snapshot；恢复 snapshot 时按 snapshot 自身的 panelCount 把 store 切过去

### 7.3 P2 — Audio history TTS result audio recovery

audio history 当前只存 inputs。改为：

- 提交 TTS 成功后把 result audio 的 base64 转 Blob 存 `entry.blobs.tts_result`
- history list 每行加 ▶️ 按钮，点击播放 result audio（用 `URL.createObjectURL(blob)`）
- restore 时把 inputs 恢复 + result audio 重新挂到 audio player

STT result 仍然只存 text（小，跟 inputs 一起 payload）。

### 7.4 测试

- `history-store.test.ts`：基础 CRUD + LRU + blobs 联动删除
- `chat-history.test.ts`：含 image / audio / file attachment 的 round-trip（save → load → 确认 base64 完整恢复）
- `compare-history.test.ts`：snapshot 保存与恢复，含 panelCount 切换
- `audio-history.test.ts`：TTS result blob save/load/play

## 8. C1 — Embeddings PCA → ECharts

### 8.1 改动

`apps/web/src/features/playground/embeddings/`：

- 删除自写 `pca.ts` 中的 SVG render 部分（保留 PCA 算法）
- 新文件 `EmbeddingsScatter.tsx` 使用 I2 `<Chart kind="scatter">`：

```tsx
<Chart
  kind="scatter"
  ariaLabel={t('embeddings.scatter.aria')}
  data={{
    points: pcaResults.map((r, i) => ({
      x: r.x,
      y: r.y,
      label: inputs[i].slice(0, 40),
    })),
    xLabel: 'PC1',
    yLabel: 'PC2',
  }}
  height={420}
  options={{
    tooltip: {
      formatter: (params) => `${params.data.label}<br/>(${params.data.x.toFixed(3)}, ${params.data.y.toFixed(3)})`,
    },
  }}
/>
```

- 完整功能：tooltip 显示文本截断、双击 zoom、轮缩放（`dataZoom: [{type:'inside'}, {type:'inside',orientation:'vertical'}]`）、theme 自动跟随
- `pca.ts` 测试不变（纯算法）；新增 `EmbeddingsScatter.test.tsx` smoke

### 8.2 ECharts 体积监控

PR 描述里报 `pnpm -F @modeldoctor/web build` 后 `dist/assets/*.js` 总尺寸 diff，确认 echarts 树摇有效（增量应该 < 400 KB gzipped；如果 > 800 KB 说明引到了完整 echarts，要修 import）。

## 9. C2 — Code snippet base64 截断 UX 重做

### 9.1 改动

`code-snippets/chat.ts` + `audio.ts`：删除 `<BASE64_..._TRUNCATED>` 占位逻辑。新生成器同时输出**两个字符串**：

```ts
interface CodeSnippetResult {
  curlFull: string;    // 含完整 base64
  curlReadable: string;  // base64 用 `data:image/png;base64,AAAA...{N more KB truncated}` 格式
  pythonFull, pythonReadable, nodeFull, nodeReadable: string;
}
```

ViewCodeDialog UI：

- 顶部加红/黄 banner："⚠️ Snippet contains N KB of base64 data" — 仅在 base64 字段 > 1 KB 时显示
- 三 tab 切 curl/python/node；每 tab 内有 toggle："Readable view (truncated)" ↔ "Full data (copy-ready)"，默认 Readable
- 复制按钮文字根据当前 view 变："Copy readable" / "Copy full data"

### 9.2 测试

- snapshot 改成保存两份（readable + full）
- ViewCodeDialog 新增 toggle / banner / 复制行为测试

## 10. Backend / Contracts diff 总览

| 文件 | 改动 |
|---|---|
| `packages/contracts/src/playground.ts` | `PlaygroundTtsRequestSchema` 加 `reference_audio_base64` / `reference_text` (F1)；新 `InputFilePartSchema` + `ChatMessageContentPartSchema` 加 discriminator 项 (P1)；`PlaygroundImagesEditMultipartFieldsSchema` 新增 (F2)；类型 export 同步更新 |
| `apps/api/src/modules/playground/audio.service.ts` | TTS 路径透传新字段 (F1) |
| `apps/api/src/modules/playground/audio.controller.ts` | 校验 reference_audio_base64 大小 / mime (F1) |
| `apps/api/src/modules/playground/images.controller.ts` | 新 `@Post('edit')` 路由 + multer FileFieldsInterceptor (F2) |
| `apps/api/src/modules/playground/images.service.ts` | 新 `edit()` 方法 (F2) |
| `apps/api/src/integrations/openai-client/wires/images.ts` | 新 `edit` wire 函数 (F2) |
| `apps/api/src/integrations/openai-client/wires/audio.ts` | TTS body builder 加 reference_audio_base64 / reference_text 透传 (F1) |
| 不动 | chat / embeddings / rerank service & wire 全部不动 |

## 11. 前端文件 diff 总览

| 文件 | 改动 | 关联 item |
|---|---|---|
| **新增** `apps/web/src/lib/history-store.ts` + `.test.ts` | I1 IDB util | I1 |
| **新增** `apps/web/src/components/charts/Chart.tsx` + `theme.ts` + `index.ts` + `Chart.test.tsx` | I2 ECharts wrapper | I2 |
| **改** `apps/web/src/features/playground/audio/TtsTab.tsx` | 解锁 reference 字段 | F1 |
| **改** `apps/web/src/features/playground/audio/SttTab.tsx`（不变，列出确认） | — | — |
| **新增** `apps/web/src/features/playground/image/InpaintMode.tsx` + `MaskPainter.tsx` + 测试 | inpaint mode | F2 |
| **改** `apps/web/src/features/playground/image/ImagePage.tsx` | mode tab 切换 | F2 |
| **改** `apps/web/src/features/playground/chat-compare/store.ts` | PanelCount 加 6/8；message 持久化集成 I1 | F3 + P3 |
| **改** `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx` | grid auto-fit；Save snapshot / History dropdown | F3 + P3 |
| **改** `apps/web/src/features/playground/chat/MessageComposer.tsx` | file kind 校验；移除"(not sent)" | P1 |
| **改** `apps/web/src/features/playground/chat/ChatPage.tsx` | file content part 发送；history I1 集成 | P1 + P4 |
| **改** `apps/web/src/features/playground/audio/history.ts` | 改用 I1；TTS blob 持久化 | P2 |
| **改** `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx` | 用新 EmbeddingsScatter | C1 |
| **新增** `apps/web/src/features/playground/embeddings/EmbeddingsScatter.tsx` + 测试 | ECharts scatter | C1 |
| **改** `apps/web/src/features/playground/code-snippets/chat.ts` + `audio.ts` | 双格式输出 + file part 真生成 | C2 + P1 + F1 |
| **改** `apps/web/src/features/playground/ViewCodeDialog.tsx` | banner + toggle + 双复制 | C2 |
| **改** `apps/web/src/i18n/locales/{en-US,zh-CN}/playground.json` | 删 Phase 4 占位；加 inpaint / file / reference / snapshot / chart 新 key | 多 |

## 12. Sidebar / 导航不动

5 个 ComingSoon (Soak / Streaming TTFT / Regression / Health Monitor / History) 不在本 phase 范围。Phase 4 完成后会有完整 chart 基建可被它们直接复用。

## 13. 测试策略

| 类型 | 范围 |
|---|---|
| 单元测试（vitest） | 全部新增 / 改动文件按现有 pattern 配套测试。期望 web 测试新增 ~25 例，api 测试新增 ~8 例 |
| Snapshot | code-snippet snapshot 全量重生（chat 含 file × 3 lang × 2 view = 6 新；audio 含 reference × 3 lang × 2 view = 6 新；不含的 chat/audio 现有 snapshot 跑 readable view 路径） |
| 集成（vitest + supertest） | `images.controller.spec.ts` 新增 edit 路由 happy path + 4xx；`audio.controller.spec.ts` 新增 reference_audio_base64 校验 |
| Playwright e2e | 现有 playground 冒烟扩展：image inpaint round trip（mock upstream）；compare 6 panel render；chat 含 file attachment 提交 |
| 手测项（用户来做） | TTS voice cloning 真上游（GPT-SoVITS / F5-TTS 任一）；STT 真上游；Image inpaint 真上游 OpenAI / DALL-E |
| 测试通过基线 | Phase 3 是 613 全绿；Phase 4 完成后期望 ~660+ |

## 14. Migration / Rollout

按 CLAUDE.md "no compat shims"：

- localStorage 旧 history 全部丢弃；用户首次进 Playground 任一页面看到一次性 toast
- compare store persist version 1 → 2，旧数据丢弃
- 不写迁移代码，不写降级路径
- 不动 Prisma migrations（Playground 不入库）

## 15. 风险与开放问题

| # | 风险 | 缓解 |
|---|---|---|
| R1 | ECharts 增量 ~330 KB gzipped 可能超用户预期 | PR 描述强制报 bundle diff；若超 400 KB 修 import 路径 |
| R2 | IDB 浏览器隔私模式可能被禁用 | history-store 检测失败时降级为内存 store + UI 提示 "history disabled in private mode" |
| R3 | Voice cloning 上游 server 字段约定可能不一致（GPT-SoVITS 用 `ref_audio` / F5-TTS 用 `reference_audio` / vLLM-TTS 用 `reference_audio_base64`） | 选用 `reference_audio_base64` 作为 ModelDoctor 的内部 canonical 字段名（OpenAI 扩展提案里出现频率最高的形式）；body 透传到 upstream 后字段映射是 upstream / 它的 OpenAI-compat shim 的责任。**Phase 4 不为字段名做适配层**；如实际不通就在 PR 后续补 hotfix（已知实测点之一） |
| R4 | OpenAI input_file part 部分本地 OpenAI-compat server (vLLM 0.6 之前 / TGI / Ollama) 不识别 → 上游 4xx | 不在前端 client-side 区分，让 4xx 自然冒出来；UI 错误提示 "This server does not support file inputs" 通用文案。这是 server 兼容性问题不是我们的 bug |
| R5 | PR 体积大（按 δ 选择，9 项一锅） | commit 粒度 = 11（2 共享基建 + 9 个 item），PR 描述按 commit 顺序写小标题，方便 reviewer 一段段看 |

## 16. 提交计划（commit 顺序）

按依赖顺序：

1. `chore: merge origin/main into feat/regression-suite`
2. `build(web): add idb + echarts + echarts-for-react deps`
3. `feat(web/lib): IndexedDB history-store util` (I1)
4. `feat(web/components/charts): Chart wrapper + ECharts theme` (I2)
5. `feat(web/playground/embeddings): migrate PCA to ECharts scatter` (C1)
6. `feat(web/playground/code-snippets): readable/full base64 view + ViewCodeDialog toggle` (C2)
7. `feat(playground/audio): TTS voice cloning (reference audio + reference text)` (F1)
8. `feat(web/playground/audio): persist TTS result audio in IDB history` (P2)
9. `feat(playground/chat): file attachment real upload via input_file part` (P1)
10. `feat(web/playground/chat): persist chat history attachments in IDB` (P4)
11. `feat(playground/image): inpaint mode (mask painter + /images/edit)` (F2)
12. `feat(web/playground/chat-compare): extend to 6/8 panel + auto-fit grid` (F3)
13. `feat(web/playground/chat-compare): snapshot save/restore via IDB` (P3)
14. `chore: update i18n strings + remove Phase 4 placeholders`

PR title: `feat(playground): Phase 4 — 100% completion (voice cloning, inpaint, charts, history persistence, file attachments, 6/8-panel compare)`

## 17. 完成标准 (DoD)

- [ ] 所有现有测试 + 新增测试全绿
- [ ] `pnpm -F @modeldoctor/web type-check` 0 error
- [ ] `pnpm -F @modeldoctor/api lint` 0 error
- [ ] Playwright 冒烟通过（5 modality + Compare + Inpaint）
- [ ] 手测：用户验证 TTS clone / STT / Image inpaint 真上游
- [ ] PR 描述报 bundle diff（确认 ECharts < 400 KB gzipped 增量）
- [ ] sidebar 上 Playground 5 个 sub-page 没有任何 disabled / placeholder / "Phase 4" / "(not sent)" 字样
- [ ] v2 backlog 清零
