# Playground Phase 3 设计方案

**日期**：2026-04-30
**作者**：weetime（与 Claude 协同 brainstorming）
**状态**：approved — 待 writing-plans 拆解
**依赖**：
- Phase 1（PR 已合并）：Connection 模型扩展、PlaygroundShell、CategoryEndpointSelector、HistoryStore 工厂、ChatPage 非流式
- Phase 2（PR #28 已合并）：Chat SSE 流式 + 停止 + ViewCode + History；Image/Embeddings/Rerank 完整；contracts ChatMessageContentPart（多模态）；openai-client 抽取到 `wires/{chat,embeddings,rerank,images}`
- 父 spec：[`docs/superpowers/specs/2026-04-29-playground-design.md`](./2026-04-29-playground-design.md) §10 Phase 3 + §6.1（多模态 chat）+ §6.4（Audio）
- 长期分支：`feat/regression-suite`（per CLAUDE.md memory，多 phase 共用，不切子分支）

## 1. 范围

Phase 3 交付三块功能，合并为一个 PR：

1. **AudioPage**（`/playground/audio?tab=tts|stt`）：TTS + STT 两个 tab，含 MediaRecorder 录音
2. **ChatComparePage**（`/playground/chat/compare`）：2/3/4 panel 并排对比
3. **多模态 chat 附件**（image / audio / file placeholder）—— Phase 2 故意延后的项目

完成后 5 个模态全开 + Compare + 多模态 = Playground v1 功能完整。

### 1.1 不在 Phase 3 范围（推 v2）

- TTS 参考音频（voice cloning）—— v1 的 advanced panel 仅显示 disabled 字段 + tooltip 提示
- Compare 扩展到 6+ panel（v1 上限 4）
- Compare 历史持久化
- chat 历史 snapshot 中保留多模态附件 base64
- 多模态附件中 file kind 实际发送到上游

## 2. 关键设计决策（brainstorming 对齐结果）

| 决策点 | 选择 | 主要理由 |
|---|---|---|
| 多模态 chat 是否纳入 Phase 3 | **纳入** | Phase 2 已铺好 contracts + history preview，Compare 也需要 MessageList 支持 ContentPart[]，一次落地 |
| Compare 的 store 形态 | **单 zustand store + `panels: PanelState[]`** | 避免重构 Phase 2 已稳定的 `useChatStore` 单例；actions 加 panelIndex 是合理代价 |
| STT 上传传输 | **端到端 native multipart** | proxy 类 Playground 业内主流（GPUStack / ChatGPT / Google AI Studio）；上游协议本身就是 multipart，base64-in-JSON 反而是无意义的双向 transcode |
| TTS 请求 | **JSON in / JSON out（audioBase64 + format）** | 文本进 JSON，binary 出包成 base64 给浏览器 `<audio>` 喂数据，与 ASR probe 同形 |
| 录音格式 | **MediaRecorder 原生 blob 直传** | Whisper / vLLM / SGLang 都接受 webm/mp4，client-side 转 WAV 是没必要的复杂度 |
| AudioPage history | **存 inputs，不存 audioBase64** | binary 进 localStorage 易爆配额；user restore 后重发即可 |
| Compare history | **不做** | 主流 Compare 工具（OpenRouter / LMSys Direct Chat）都不持久化；snapshot × 4 panel + 多模态会 OOM |
| Compare 布局持久化 | **持久化 panelCount + 各 panel 的 connectionId/params + sharedSystemMessage（不含 messages）** | 主流 Compare 工具的 standard 行为：刷新后用户不用重选 4 个连接 |
| Chat history 多模态处理 | **序列化时 strip 附件 base64**，UI 加 "📎 attachment not saved in history" 标记 | 保 history snapshot lean；附件 binary 是 ephemeral，不适合长期存 |
| 多模态附件配额 | **单 turn ≤ 5 个，每个 ≤ 10MB** | 在 16MB JSON body limit 之内有余量；超额前端 toast 拦下 |
| STT 上传上限 | **multer FileInterceptor `fileSize: 25MB`** | 与 OpenAI Whisper 一致 |
| `@types/multer` | **加到 `apps/api/devDependencies`** | typing-only ~10KB，不在"新引顶层运行时依赖"硬约束之内 |

## 3. 后端

### 3.1 Contracts（`packages/contracts/src/playground.ts` 新增）

```ts
// ─── Audio TTS ──────────────────────────────────────────────────────────
export const PlaygroundTtsRequestSchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),  // 默认 /v1/audio/speech
  input: z.string().min(1),
  voice: z.string().min(1).default("alloy"),
  format: z.enum(["mp3", "wav", "flac", "opus", "aac", "pcm"]).default("mp3"),
  speed: z.number().min(0.25).max(4.0).optional(),
});
export type PlaygroundTtsRequest = z.infer<typeof PlaygroundTtsRequestSchema>;

export const PlaygroundTtsResponseSchema = z.object({
  success: z.boolean(),
  audioBase64: z.string().optional(),
  format: z.string().optional(),       // 上游实际容器（嗅探）
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundTtsResponse = z.infer<typeof PlaygroundTtsResponseSchema>;

// ─── Audio STT (Transcriptions) ─────────────────────────────────────────
// file 不进 zod，由 multer 提供。schema 仅校验 form fields。
export const PlaygroundTranscriptionsBodySchema = z.object({
  apiBaseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  customHeaders: z.string().optional(),
  queryParams: z.string().optional(),
  pathOverride: z.string().optional(),  // 默认 /v1/audio/transcriptions
  language: z.string().optional(),
  task: z.enum(["transcribe", "translate"]).default("transcribe"),
  prompt: z.string().optional(),
  temperature: z.number().min(0).max(1).optional(),
});
export type PlaygroundTranscriptionsBody = z.infer<typeof PlaygroundTranscriptionsBodySchema>;

export const PlaygroundTranscriptionsResponseSchema = z.object({
  success: z.boolean(),
  text: z.string().optional(),
  error: z.string().optional(),
  latencyMs: z.number(),
});
export type PlaygroundTranscriptionsResponse = z.infer<typeof PlaygroundTranscriptionsResponseSchema>;
```

### 3.2 OpenAI-client wire（`apps/api/src/integrations/openai-client/wires/audio.ts` 新建）

四个纯函数：

```ts
export function buildTtsBody(input: { model; input; voice; format; speed }): Record<string, unknown>;

export async function parseTtsResponse(res: Response): Promise<{ audioBase64: string; format: string; bytes: number }>;
//   读 arrayBuffer → 用 probes/utils/wav.ts 的 detectAudioFormat 嗅探 → toString("base64")
//   if bytes > 20 * 1024 * 1024 → throw "audio too large (X MB)"

export function buildTranscriptionsFormData(input: {
  file: { buffer: Buffer; originalname: string; mimetype: string };
  model: string;
  language?: string;
  task?: "transcribe" | "translate";
  prompt?: string;
  temperature?: number;
}): FormData;
//   form.append("file", new Blob([buffer slice], { type: mimetype }), originalname)
//   其他字段 form.append("model", model) 等
//   form.append("language", lang) 仅当 lang truthy

export function parseTranscriptionsResponse(json: unknown): { text: string };
```

`apps/api/src/integrations/openai-client/index.ts` 加 `export * from "./wires/audio.js";`。

### 3.3 NestJS 模块（`apps/api/src/modules/playground/`）

按现有 flat 风格，不嵌套子目录：

```
audio.controller.ts
audio.controller.spec.ts
audio.service.ts
audio.service.spec.ts
playground.module.ts        # 注册 AudioController + AudioService
```

`audio.controller.ts`：

```ts
@ApiTags("playground")
@Controller("playground/audio")
export class AudioController {
  constructor(private readonly svc: AudioService) {}

  @Post("tts")
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(PlaygroundTtsRequestSchema))
  tts(@Body() body: PlaygroundTtsRequest): Promise<PlaygroundTtsResponse> {
    return this.svc.runTts(body);
  }

  @Post("transcriptions")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  transcriptions(
    @UploadedFile() file: Express.Multer.File,
    @Body() rawBody: unknown,
  ): Promise<PlaygroundTranscriptionsResponse> {
    if (!file) throw new BadRequestException("missing 'file' part in multipart body");
    const body = PlaygroundTranscriptionsBodySchema.parse(rawBody);
    return this.svc.runTranscriptions({ file, body });
  }
}
```

注意：transcriptions 不能用 `@UsePipes(ZodValidationPipe)`，因为 multipart body 是 form fields + file，需手动 zod parse。

### 3.4 service 行为约束

- 错误规范化：upstream 非 2xx → `{ success: false, error: "status=<code> body=<truncated 500 字节>", latencyMs }`，与 chat/embeddings 一致
- TTS audio 嗅探：复用 `apps/api/src/integrations/utils/wav.ts` 的 `detectAudioFormat`
- TTS audio size guard：> 20MB 拒绝包成 base64（避免 base64 编码后 26MB+ JSON 撑爆 16MB body limit）
- runTranscriptions：调 `buildTranscriptionsFormData` → `fetch(targetUrl, { method: "POST", headers: { Authorization, ...customHeaders }, body: form })`——**不设 Content-Type**，让 fetch 自动派 multipart boundary

### 3.5 typing

加 `@types/multer` 到 `apps/api/devDependencies`，`Express.Multer.File` 类型即可使用。

## 4. 前端：多模态 chat 附件

### 4.1 Attachment 数据结构（`apps/web/src/features/playground/chat/attachments.ts` 新建）

```ts
export type AttachedFile =
  | { kind: "image"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "audio"; dataUrl: string; mimeType: string; sizeBytes: number; name: string }
  | { kind: "file";  name: string; sizeBytes: number };

export const ATTACHMENT_LIMITS = {
  maxCount: 5,
  maxSizeBytes: 10 * 1024 * 1024,
};

export function buildContentParts(
  text: string,
  attachments: AttachedFile[],
): string | ChatMessageContentPart[];

export async function readFileAsAttachment(
  file: File,
  kind: AttachedFile["kind"],
): Promise<AttachedFile>;
```

`buildContentParts` 行为：
- 无附件 → 返回 string（保持向后兼容）
- 有附件 → 返回 `ChatMessageContentPart[]`：text part + 每个 attachment 的对应 part
- `kind: "file"` 静默跳过（v1 不发送）
- audio：`dataUrl.split(",", 2)[1]` 取纯 base64，`mimeType.split("/")[1].split(";")[0]` 取格式（`audio/webm;codecs=opus` → `webm`）

### 4.2 `MessageComposer` 升级

local state：

```ts
const [draft, setDraft] = useState("");
const [attachments, setAttachments] = useState<AttachedFile[]>([]);
```

UI 加：
- 三个 attach 按钮（文件 picker `<input type="file" hidden>`）：image / audio / file
- 校验：`attachments.length >= 5` 拦下 toast；单个 size > 10MB 拦下 toast
- chip 区域：image → thumbnail；audio → 文件名 + ▶ 试听小按钮；file → 文件名 + 灰色 "(not sent)" 标
- send 时 `onSend(text, attachments)`，发送后清空两者
- Compare 复用同一组件——sharedDraft + sharedAttachments 都是 composer local state，不进 store

props 签名：

```ts
onSend: (text: string, attachments: AttachedFile[]) => void;
```

### 4.3 `MessageList` 升级

content 是 string → markdown render（不变）；content 是 ContentPart[] → 分支 render：
- text part → markdown
- image_url → `<img src={url} className="max-h-64 rounded" alt="" />`
- input_audio → `<audio controls src={data:audio/${format};base64,${data}} />`

### 4.4 ChatPage 调整

`onSend` 扩展 `attachments`，调 `buildContentParts(text, attachments)` 构造 user message 的 content。其他逻辑（流式、abort、history、错误处理）不变。

### 4.5 History snapshot sanitizer

ChatPage 内新增 `sanitizeChatSnapshot(snap)` 函数，在 `scheduleAutoSave` 调用前调用：
- string content 不动
- ContentPart[] content：filter 出 text parts，drop 掉 image/audio 的 base64
- 若 dropped count > 0：把 text parts 内容 join 后追加 `"\n\n📎 ${droppedCount} attachment(s) not saved in history"`，整体 collapse 回 string content
- preview 函数已经在 Phase 2 处理 `[multimodal]` 占位，不动

### 4.6 ViewCodeDialog snippet 截短

`apps/web/src/features/playground/code-snippets/chat.ts` 加 `shortenForSnippet(messages)` 在 snippet 生成前调用：
- `image_url.url` 以 `data:` 开头 → `<head 30 字节> + "<BASE64_IMAGE_DATA_TRUNCATED>"`
- `input_audio.data` → `"<BASE64_AUDIO_DATA_TRUNCATED>"`

ViewCodeDialog 底部小字加："Multimodal payloads truncated for readability — replace `<BASE64_..._TRUNCATED>` with actual base64."

## 5. 前端：AudioPage

### 5.1 文件布局

```
apps/web/src/features/playground/audio/
├── AudioPage.tsx
├── TtsTab.tsx
├── SttTab.tsx
├── RecorderControls.tsx
├── TtsParams.tsx
├── SttParams.tsx
├── store.ts
├── store.test.ts
├── history.ts
├── AudioPage.test.tsx
├── TtsTab.test.tsx
├── SttTab.test.tsx
└── RecorderControls.test.tsx
```

并新增 `apps/web/src/features/playground/code-snippets/audio.ts`（TTS + STT 各一组 curl/python/node）。

### 5.2 Store

单 store（共用 `selectedConnectionId`）：

```ts
interface AudioStoreState {
  selectedConnectionId: string | null;
  tts: {
    input: string;
    voice: string;
    format: "mp3" | "wav" | "flac" | "opus" | "aac" | "pcm";
    speed: number | undefined;
    autoPlay: boolean;
    result: { audioBase64: string; format: string } | null;
    sending: boolean;
    error: string | null;
  };
  stt: {
    fileName: string | null;       // Blob 不可序列化，元数据进 store，blob 在 SttTab ref
    fileSize: number | null;
    fileMimeType: string | null;
    language: string;              // "" = auto
    task: "transcribe" | "translate";
    prompt: string;
    temperature: number | undefined;
    result: string | null;
    sending: boolean;
    error: string | null;
  };
  // actions: setSelected, patchTts, patchStt, setTtsResult, setSttResult, setSttFileMeta,
  //          setTtsSending, setSttSending, setTtsError, setSttError, resetTts, resetStt
}
```

`activeTab` 由 URL `?tab=` 单向驱动，不进 store（保证刷新/分享 deeplink 一致）。

### 5.3 TtsTab

主区：上半大卡片 `<audio controls>`（无结果时 placeholder）；下半 textarea + autoPlay toggle + Send 按钮。

Send 流程：
```ts
api.post<PlaygroundTtsResponse>("/api/playground/audio/tts", body)
  .then((res) => {
    if (res.success && res.audioBase64) {
      setTtsResult({ audioBase64: res.audioBase64, format: res.format ?? tts.format });
      if (tts.autoPlay) audioRef.current?.play().catch(() => {/* 浏览器 user-gesture 限制，吞 */});
    } else setTtsError(res.error ?? "unknown");
  });
```

右侧 paramsSlot：voice (input) / format (select) / speed (slider 0.25-4.0)；高级折叠 panel 内含三个 disabled 字段 + tooltip "Voice cloning — Phase 4"。

### 5.4 SttTab

结构：
1. 上：upload zone（drag & drop + click-to-pick） + `[🎙 Record]`（RecorderControls）。已选/已录后切到 `<audio controls>` + 文件名 + size + `[✕ 移除]`
2. 中：`[▷ Transcribe]` 按钮，disabled 条件 = 没文件 / sending
3. 下：转录结果 card，含 `[📋 Copy]` + `[✕ Clear]`

Blob 在 SttTab 的 `useRef<Blob | null>` 持有，不进 store。Send：

```ts
const form = new FormData();
form.append("file", blobRef.current, fileName);
form.append("apiBaseUrl", conn.apiBaseUrl);
form.append("apiKey", conn.apiKey);
form.append("model", conn.model);
if (conn.customHeaders) form.append("customHeaders", conn.customHeaders);
if (conn.queryParams) form.append("queryParams", conn.queryParams);
if (stt.language) form.append("language", stt.language);
form.append("task", stt.task);
if (stt.prompt) form.append("prompt", stt.prompt);
if (stt.temperature !== undefined) form.append("temperature", String(stt.temperature));

const res = await playgroundFetchMultipart<PlaygroundTranscriptionsResponse>({
  path: "/api/playground/audio/transcriptions",
  form,
});
```

新建 `apps/web/src/lib/playground-multipart.ts`：

```ts
export async function playgroundFetchMultipart<T>(opts: {
  path: string;
  form: FormData;
  signal?: AbortSignal;
}): Promise<T>;
//   fetch(opts.path, { method: "POST", body: opts.form, signal: opts.signal })
//   不设 Content-Type，让 fetch 自动派 multipart boundary
//   非 2xx → throw new ApiError(...)
```

### 5.5 RecorderControls

```tsx
function RecorderControls({ onComplete }: { onComplete: (blob, mimeType, durationMs) => void }) {
  // 1) 安全上下文校验：window.isSecureContext && navigator.mediaDevices?.getUserMedia
  //    若否：按钮 disabled + tooltip "Recording requires HTTPS or localhost"
  // 2) 状态：idle | requesting | recording | error
  // 3) start：
  //    getUserMedia({ audio: true }) → 拒绝 toast.error；同意 → new MediaRecorder(stream, { mimeType: pickSupportedMime() })
  //    chunks 收集，stop 触发 onstop:
  //      blob = new Blob(chunks, { type: recorder.mimeType })
  //      onComplete(blob, recorder.mimeType, durationMs)
  //      stream.getTracks().forEach(t => t.stop())  // 释放麦克风
  // 4) UI：idle "🎙 Record"；recording 红色 "■ Stop (00:12)" + 实时计时
  // 5) pickSupportedMime：
  //    MediaRecorder.isTypeSupported 优先 audio/webm > audio/mp4 > "" (default)
}
```

### 5.6 AudioHistorySnapshot

```ts
interface AudioHistorySnapshot {
  selectedConnectionId: string | null;
  tts: { input: string; voice: string; format: string; speed?: number; autoPlay: boolean };
  stt: {
    language: string;
    task: "transcribe" | "translate";
    prompt: string;
    temperature?: number;
    fileName: string | null;
    resultText: string | null;
  };
  activeTab: "tts" | "stt";
}
```

`useAudioHistoryStore = createHistoryStore<AudioHistorySnapshot>({ name: "md-playground-history-audio", blank, preview })`。

`preview` 优先级：tts.input（前缀 🔊）> stt.resultText（前缀 🎤）> stt.fileName（前缀 📎）。

### 5.7 路由 + 侧边栏开锁

- `apps/web/src/router/index.tsx`：把 `playground/audio` 的 `<ComingSoonRoute>` 替换为 `<AudioPage />`
- `apps/web/src/components/sidebar/sidebar-config.tsx`：删除 `playgroundAudio` item 的 `comingSoon: true`

### 5.8 i18n

新增 `audio.*` 到 `playground.json`（en + zh）：

```json
{
  "audio": {
    "title": "Audio",
    "tabs": { "tts": "TTS", "stt": "STT" },
    "tts": {
      "inputPlaceholder": "Enter text to synthesize...",
      "params": { "voice": "Voice", "format": "Format", "speed": "Speed", "advanced": "Advanced" },
      "advancedV2Note": "Voice cloning (reference audio + text) — Phase 4"
    },
    "stt": {
      "uploadPlaceholder": "Drag & drop audio or click to upload",
      "recorder": {
        "start": "Record", "stop": "Stop",
        "requiresHttps": "Recording requires HTTPS or localhost",
        "permissionDenied": "Microphone permission denied"
      },
      "transcribe": "Transcribe",
      "params": { "language": "Language", "task": "Task", "prompt": "Prompt" }
    }
  }
}
```

## 6. 前端：ChatComparePage

### 6.1 文件布局

```
apps/web/src/features/playground/chat-compare/
├── ChatComparePage.tsx
├── ChatPanel.tsx
├── PanelCountSwitcher.tsx
├── ChatModeTabs.tsx          # "Single | Compare" 复用进 ChatPage 顶部
├── store.ts
├── store.test.ts
└── ChatComparePage.test.tsx
```

### 6.2 Store

```ts
interface PanelState {
  // 持久化
  selectedConnectionId: string | null;
  params: ChatParams;
  // ephemeral（rehydrate 时重置）
  messages: ChatMessage[];
  sending: boolean;
  streaming: boolean;
  abortController: AbortController | null;
  error: string | null;
}

interface CompareStoreState {
  panelCount: 2 | 3 | 4;             // 持久化
  panels: PanelState[];              // 部分持久化（见 partialize）
  sharedSystemMessage: string;        // 持久化

  setPanelCount: (n: 2 | 3 | 4) => void;
  setSharedSystemMessage: (s: string) => void;
  setPanelConnection: (i: number, id: string | null) => void;
  patchPanelParams: (i: number, p: Partial<ChatParams>) => void;
  appendMessageToPanel: (i: number, m: ChatMessage) => void;
  appendAssistantTokenToPanel: (i: number, tok: string) => void;
  clearPanelMessages: (i: number) => void;
  clearAllMessages: () => void;
  setPanelSending: (i: number, b: boolean) => void;
  setPanelStreaming: (i: number, b: boolean) => void;
  setPanelAbortController: (i: number, ac: AbortController | null) => void;
  setPanelError: (i: number, e: string | null) => void;
  resetPanel: (i: number) => void;
  abortAll: () => void;
}
```

zustand `persist` 中间件：

```ts
{
  name: "md-playground-chat-compare-layout",
  version: 1,
  partialize: (s) => ({
    panelCount: s.panelCount,
    sharedSystemMessage: s.sharedSystemMessage,
    panels: s.panels.map((p) => ({
      selectedConnectionId: p.selectedConnectionId,
      params: p.params,
    })),
  }),
  merge: (persisted, current) => ({
    ...current,
    ...(persisted as Partial<CompareStoreState>),
    panels: ((persisted as { panels?: Array<Pick<PanelState, "selectedConnectionId" | "params">> })?.panels ?? current.panels)
      .map((p) => ({
        ...p,
        messages: [],
        sending: false,
        streaming: false,
        abortController: null,
        error: null,
      })),
  }),
}
```

`setPanelCount`：grow 时 push blank PanelState；shrink 时 slice 到 n（并 abort 被裁掉的 panel 的 streaming）。

### 6.3 Send 流程（broadcast）

ChatComparePage 顶层挂共用 `<MessageComposer onSend={onSend}>`：

```ts
const onSend = (text: string, attachments: AttachedFile[]) => {
  const compare = useCompareStore.getState();
  const content = buildContentParts(text, attachments);
  const userMsg: ChatMessage = { role: "user", content };

  compare.panels.forEach((panel, i) => {
    const conn = panel.selectedConnectionId
      ? useConnectionsStore.getState().get(panel.selectedConnectionId)
      : null;
    if (!conn) {
      compare.setPanelError(i, t("chat.compare.errors.noConnection"));
      return;
    }
    compare.setPanelError(i, null);
    compare.appendMessageToPanel(i, userMsg);
    compare.setPanelSending(i, true);

    const messagesForRequest: ChatMessage[] = [
      ...(compare.sharedSystemMessage.trim()
        ? [{ role: "system" as const, content: compare.sharedSystemMessage.trim() }]
        : []),
      ...useCompareStore.getState().panels[i].messages,
    ];

    const body: PlaygroundChatRequest = {
      apiBaseUrl: conn.apiBaseUrl,
      apiKey: conn.apiKey,
      model: conn.model,
      customHeaders: conn.customHeaders || undefined,
      queryParams: conn.queryParams || undefined,
      messages: messagesForRequest,
      params: panel.params,
    };

    if (panel.params.stream) {
      const ac = new AbortController();
      compare.setPanelStreaming(i, true);
      compare.setPanelAbortController(i, ac);
      playgroundFetchStream({
        path: "/api/playground/chat",
        body,
        signal: ac.signal,
        onSseEvent: (data) => {
          if (data === "[DONE]") return;
          const evt = JSON.parse(data);
          const tok = evt.choices?.[0]?.delta?.content;
          if (tok) useCompareStore.getState().appendAssistantTokenToPanel(i, tok);
        },
      })
        .catch((e) => {
          if (!(e instanceof DOMException && e.name === "AbortError")) {
            compare.setPanelError(i, e.message ?? "stream failed");
          }
        })
        .finally(() => {
          const s = useCompareStore.getState();
          s.setPanelStreaming(i, false);
          s.setPanelAbortController(i, null);
          s.setPanelSending(i, false);
        });
    } else {
      api.post<PlaygroundChatResponse>("/api/playground/chat", body)
        .then((res) => {
          if (res.success) compare.appendMessageToPanel(i, { role: "assistant", content: res.content ?? "" });
          else compare.setPanelError(i, res.error ?? "unknown");
        })
        .catch((e) => compare.setPanelError(i, e.message ?? "network"))
        .finally(() => compare.setPanelSending(i, false));
    }
  });
};
```

每 panel 独立 lifecycle，互不阻塞。

### 6.4 ChatPanel UI

```
┌─────────────────────────────────────────┐
│ [Connection ▾]   [⚙ params]   [✕ clear] │
├─────────────────────────────────────────┤
│  MessageList（复用 §4.3 升级版本）       │
│  per-panel error chip                    │
├─────────────────────────────────────────┤
│  if streaming: [■ Stop]                  │
│  if !streaming && lastMessage: model · ms│
└─────────────────────────────────────────┘
```

复用：`<CategoryEndpointSelector category="chat">`、`<ChatParams>`（在 popover 内紧凑展示）、`<MessageList>`。

### 6.5 ChatComparePage 主布局

```
PlaygroundShell (右栏 paramsSlot 不用，因为每 panel 自带连接器)
├── ChatModeTabs (Single | Compare)
├── PanelCountSwitcher [2] [3] [4]
├── <details> sharedSystemMessage textarea </details>
├── grid of N ChatPanel (gridTemplateColumns: repeat(N, minmax(0, 1fr)))
└── <MessageComposer onSend={broadcastOnSend}> + [Stop All] (if any panel streaming)
```

- 4 panel 需至少 1280px viewport；窄屏 `overflow-x-auto`，不优化窄屏体验（v1）
- 不挂 HistoryDrawer（Q4b）
- PlaygroundShell 的 paramsSlot 在 Compare 模式传 `null`（因每 panel 自带 selector），右栏整个折叠

### 6.6 ChatModeTabs 接入 ChatPage

`apps/web/src/features/playground/chat/ChatPage.tsx` 顶部（PlaygroundShell 之内、PageHeader 之上）挂 `<ChatModeTabs />`。Compare 页同位置也挂同一个组件。

### 6.7 路由 + i18n + 侧边栏

- 路由：`apps/web/src/router/index.tsx` 加 `{ path: "playground/chat/compare", element: <ChatComparePage /> }`
- 侧边栏：**不动**（spec § 4.2 — Compare 不是单独 sidebar item）
- i18n key（`chat.compare.*`）：`title / subtitle / panelCount / sendN / stopAll / clearAll / errors.noConnection / modeTabs.{single,compare}`

### 6.8 多模态 + Compare

共享 MessageComposer 接附件后构造 `content: ContentPart[]`，N 个 panel 共用同一份 content parts（plain object 引用，无 mutation）。某 panel 连的不是 vision 模型 → 上游报错 → per-panel error 显示，其他 panel 不受影响——这正是 Compare 的诊断价值。

## 7. 集成接线点（实现时的 checklist）

| 改动 | 文件 |
|---|---|
| 注册 AudioController + AudioService | `apps/api/src/modules/playground/playground.module.ts` |
| 导出 audio wire | `apps/api/src/integrations/openai-client/index.ts` |
| 路由 `/playground/chat/compare` + 替换 audio ComingSoon | `apps/web/src/router/index.tsx` |
| 侧边栏去 `comingSoon: true`（仅 audio） | `apps/web/src/components/sidebar/sidebar-config.tsx` |
| ChatModeTabs 挂在 ChatPage 顶部 | `apps/web/src/features/playground/chat/ChatPage.tsx` |
| i18n 新 key | `apps/web/src/locales/{en-US,zh-CN}/playground.json` |
| Multipart helper | `apps/web/src/lib/playground-multipart.ts`（新文件） |
| `@types/multer` devDep | `apps/api/package.json` |

## 8. 测试矩阵

| 层 | 文件 | 关键 case |
|---|---|---|
| contracts | `packages/contracts/src/playground.test.ts`（增量） | TTS schema default voice/format；Transcriptions schema default task；invalid format 拒绝 |
| api wire | `apps/api/src/integrations/openai-client/wires/audio.spec.ts` | buildTtsBody 字段映射 / parseTtsResponse 嗅探 wav vs mp3 / buildTranscriptionsFormData 含 file+model+language / parseTranscriptionsResponse |
| api service | `apps/api/src/modules/playground/audio.service.spec.ts` | runTts happy + 上游 4xx + 音频 > 20MB 拒绝；runTranscriptions happy + 上游错误透传 |
| api controller | `apps/api/src/modules/playground/audio.controller.spec.ts` | FileInterceptor 拒绝无 file；form fields zod 校验失败；25MB 路径（用 1MB sample 测） |
| web lib | `apps/web/src/lib/playground-multipart.test.ts` | fetch 不带 Content-Type；abort 抛 AbortError |
| web multimodal | `apps/web/src/features/playground/chat/attachments.test.ts` | buildContentParts 4 组合 + readFileAsAttachment（jsdom FileReader） |
| web composer | `apps/web/src/features/playground/chat/MessageComposer.test.tsx`（增量） | 附件超 5 / 单个超 10MB toast 拦下；attach + send 后清空 |
| web message list | `apps/web/src/features/playground/chat/MessageList.test.tsx`（增量） | 渲染 ContentPart[] 三种 part |
| web chat history | `apps/web/src/features/playground/chat/ChatPage.test.tsx`（增量） | sanitizeChatSnapshot 去 base64 + 加 dropped marker |
| web code-snippets chat | `apps/web/src/features/playground/code-snippets/__snapshots__/chat.snap`（增量） | multimodal chat 截短 snapshot |
| web audio store | `apps/web/src/features/playground/audio/store.test.ts` | tts/stt slice 增删改 + setTtsResult/setSttResult |
| web RecorderControls | `apps/web/src/features/playground/audio/RecorderControls.test.tsx` | mock getUserMedia + MediaRecorder；secure context disabled / 权限拒绝 / 录完调 onComplete + 释放 tracks |
| web TtsTab | `apps/web/src/features/playground/audio/TtsTab.test.tsx` | mock fetch send → setResult → autoPlay 触发 audio.play |
| web SttTab | `apps/web/src/features/playground/audio/SttTab.test.tsx` | upload + transcribe → setResult；mock RecorderControls 触发 onComplete |
| web AudioPage | `apps/web/src/features/playground/audio/AudioPage.test.tsx` | URL ?tab= 切换 + history restore 跨 tab |
| web code-snippets audio | `apps/web/src/features/playground/code-snippets/__snapshots__/audio.snap`（新） | TTS + STT × 3 语言 = 6 snapshot |
| web compare store | `apps/web/src/features/playground/chat-compare/store.test.ts` | setPanelCount 2↔4；broadcast actions index 隔离；partialize 序列化 + rehydrate ephemeral 清零；abortAll |
| web ChatComparePage | `apps/web/src/features/playground/chat-compare/ChatComparePage.test.tsx` | 默认 2 panel render；切 4 panel；Send broadcast N 次；no-connection panel 显示错误；StopAll |
| web ChatPanel | `apps/web/src/features/playground/chat-compare/ChatPanel.test.tsx`（与上合并 OK） | 清空 ✕ 仅清这个 panel |

预期新测试 ~50 个，加 Phase 2 的 521 个 → 总数约 570。

## 9. PR / commit 计划

Phase 3 = 一个 PR，标题 `feat(playground): Phase 3 — Audio + Compare + multimodal chat attachments`。

| # | commit | 改动 |
|---|---|---|
| 0 | （无 commit）merge `origin/main` FF 到 `feat/regression-suite` | git 操作 |
| 1 | `feat(contracts/playground): add TTS + Transcriptions schemas` | packages/contracts |
| 2 | `feat(api/openai-client): add audio wire (TTS + Transcriptions)` | wires/audio.ts + spec |
| 3 | `feat(api/playground/audio): controller + service` | audio.controller/service + spec + module 注册 |
| 4 | `build(api): add @types/multer devDep` | package.json + lockfile |
| 5 | `feat(web/lib): playgroundFetchMultipart helper` | lib + test |
| 6 | `feat(web/playground/chat): multimodal attachments (image/audio/file)` | attachments.ts + Composer + MessageList + 测试 |
| 7 | `feat(web/playground/chat): sanitize attachments out of history snapshots` | ChatPage sanitizer + 测试 |
| 8 | `feat(web/playground/code-snippets): truncate multimodal payloads` | code-snippets + snapshot |
| 9 | `feat(web/playground/audio): AudioStore + AudioHistorySnapshot` | store + history + 测试 |
| 10 | `feat(web/playground/audio): RecorderControls (MediaRecorder + secure context)` | RecorderControls + 测试 |
| 11 | `feat(web/playground/audio): TtsTab` | TtsTab + TtsParams + 测试 |
| 12 | `feat(web/playground/audio): SttTab` | SttTab + SttParams + 测试 |
| 13 | `feat(web/playground/audio): AudioPage shell + tabs + i18n` | AudioPage + locales + 测试 |
| 14 | `feat(web/playground/code-snippets): audio TTS + STT snippets` | code-snippets/audio.ts + snapshot |
| 15 | `feat(web/router): unlock /playground/audio + add /playground/chat/compare` | router + sidebar 去 comingSoon |
| 16 | `feat(web/playground/chat-compare): store with persisted layout` | store + 测试 |
| 17 | `feat(web/playground/chat-compare): ChatPanel` | ChatPanel + 测试 |
| 18 | `feat(web/playground/chat-compare): ChatComparePage + PanelCountSwitcher + ChatModeTabs` | 页面 + 测试 |
| 19 | `feat(web/playground/chat): mount ChatModeTabs at top of ChatPage` | ChatPage 顶栏接入 |

每 commit body 末尾带 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`，全部用 `git add <files>` 显式加。

## 10. 项目硬约束自查

| 约束 | 自查 |
|---|---|
| 不动 `apps/api/tsconfig.json` `incremental` | ✓ |
| vitest@2 (api) / vitest@1 (web) 不统一 | ✓ |
| 不引新顶层运行时 dep | ✓（multer 已是传递依赖；`@types/multer` 是 devDep） |
| 不动 prisma migrations / 共享 DB | ✓（Phase 3 全部本地状态） |
| 不动 docker compose | ✓ |
| 长期分支 `feat/regression-suite` 不切子分支 | ✓（per memory） |
| Phase 3 第 1 步 merge `origin/main` 回来 | ✓（commit-0） |
| localStorage 改动需 bump version？ | Compare 是新 store（version: 1 起步）；audio 是新 history store（与 chat/embeddings 同形态，version: 1）；chat history snapshot **形态没变**（messages 仍是 ChatMessage[]，sanitizer 在写入侧），不 bump |
| Conventional commits + 一逻辑一 commit + 显式 git add + Co-Authored-By trailer | ✓（§9 表） |
| 推 `feat/*` 自动授权 | ✓ |
| `gh pr create` 自动授权 | ✓ |
| Pre-production 不写 compat shim | ✓（无 schema migration） |

## 11. 验收标准

Phase 3 PR 合并到 main 之前必须满足：

1. **5 模态全开 + Compare 可用**：从空连接库新建 audio 类连接 → AudioPage 选中 → 输入文本 → TTS 生成音频可播放；上传/录音 → STT 转录文本；ChatComparePage 切 4 panel → 选 4 个连接 → 发一句话 → 4 个 panel 并行流式
2. **多模态 chat 端到端**：ChatPage 选 vision 类连接 → 上传图片 → 发送 → 上游接收并响应 → 渲染 ContentPart[] 消息流
3. **History 行为正确**：AudioPage history restore 后 inputs 完整 + result 字段空（需重发）；ChatPage history 中含附件的 turn restore 后看到 "📎 N attachment(s) not saved" 标记；Compare 刷新后 panelCount + connection + params 保留，messages 清空
4. **录音权限边界**：非 https 环境下录音按钮 disabled + tooltip；权限拒绝 toast.error
5. **测试全绿**：vitest 全部 pass（约 570 个），无 flaky；biome lint / format / type-check 全 pass
6. **手动冒烟**：本地 dev server 起，覆盖上面 1–4 各一遍（不同 panel 数 × 不同模态 × 不同附件类型 × 录音权限拒绝场景），无 console error

## 12. 开放问题（writing-plans 阶段决定）

1. **commit 切法的细粒度**：§9 列了 19 个 commit。若某些（如 #4 `@types/multer` 单独 commit）感觉太细，writing-plans 阶段可合并。原则：保持"一逻辑一 commit"，但同 PR 内可以折叠 trivial diff。
2. **AudioPage 的 history restore UX**：目前设计是 restore inputs 但 result 字段空。如果用户希望 restore 后保留"上次结果文本"（仅 STT.resultText 显示，TTS 因不存音频无法 restore 结果）的视觉感，writing-plans 阶段可加 read-only 显示行为。
3. **Compare 的 ChatModeTabs UX**：当前设计 ChatPage 和 Compare 都顶部挂同一组件。是否需要 Compare 的 tab 在 active 时高亮额外信息（如 "Compare (4 panels)"）—— writing-plans 阶段决定。
4. **ASR probe 是否同步迁到新 wire**：`apps/api/src/integrations/probes/asr.ts` 的 FormData 构造逻辑和新 `wires/audio.ts` 的 `buildTranscriptionsFormData` 是同一份。Phase 3 的 PR 内是否顺手把 probe 改用新 wire（refactor），还是留到后续 PR—— writing-plans 阶段评估改动外溢面后决定。我倾向**留到后续**，避免 Phase 3 PR 体积进一步膨胀。
