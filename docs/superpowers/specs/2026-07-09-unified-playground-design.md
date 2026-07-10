# 统一 Playground(Chat + Agent 合并)— 设计文档

- 日期:2026-07-09
- 分支:`feat/agent-playground`(合并工作在同分支延续,或另开 `feat/unified-playground`)
- 关联:PR #352(Agent playground)、issue #353(OTel)

## 1. 目标与定位

把 **Chat playground** 与 **Agent playground** 合并成**一个** Playground:一个多模态输入框 + 一个 `工具/MCP/skills` 可选配置区 + 一个自适应输出区(纯对话流式气泡 ↔ agent 执行轨迹)。对齐业内主流 —— **一条 typed 事件流,把 token 增量、tool-call、多步循环同流交织**(OpenAI Responses/Agents SDK、Vercel AI SDK Data Stream Protocol 都是这么做的)。

**评测靶子的区分保留在"维度/输出视图"层,不再是两个割裂菜单**:关工具 = 测生成/对话质量;开工具 = 测 agent 能力(规划/工具/多步 + verdict)。

**为什么走"真合并"(方案②)而非"两后端 UI 路由"(方案①)**:业内标准是单条 typed 事件流;我们的 `AgentSseEvent` 已经是 typed 流,只需**扩展**(加 `text_delta` + `callModel` 流式化),chat 即可收编成"关工具"的同端点调用。一次到位、无 UX 倒退、消灭双后端重复。

## 2. 现状(合并起点)

已共享:`playgroundFetchStream`、`PlaygroundShell`、`CategoryEndpointSelector`、history 工厂、`buildPlaygroundChatBody`、`parsePlaygroundChatResponse`、`getOwnedDecrypted`、`ChatMessage` 契约、`ToolDef` 原语。

分歧待合:两 store、composer(chat 多模态 vs agent 纯文本 task)、输出(`MessageList` 纯文本 vs `TraceTimeline` markdown)、两请求契约,以及**核心差异**:chat 后端哑管道透传 `delta.content`(实时打字);agent 后端非流式逐轮发整条 `AgentStep`。

## 3. 架构:统一 typed 事件流

### 3.1 统一事件协议(扩展 `AgentSseEvent`)
新增/明确以下事件(`packages/contracts/src/agent.ts`):
- **`{type:"text_delta", delta: string}`** —— 逐 token 助手文本增量。前端把它拼进"当前助手气泡/assistant 卡"。
- `{type:"step", step:{kind:"tool_call"|"tool_result"|"plan"|"error", ...}}` —— 保留(工具调用/结果/计划/错误)。`assistant` 文本不再靠整条 `step` 传,改由 `text_delta` 流式 + 一个 `{type:"assistant_end"}` 边界标记收尾当前气泡。
- `{type:"assistant_end"}` —— 当前助手文本气泡结束(下一步要么工具调用、要么 done)。
- 保留:`tool_result_needed` / `tool_approval` / `verdict` / `done{messages?}`。

一条流内的典型序列(agent 模式,一轮有工具):
`text_delta*`(模型思考/说明文本)→ `assistant_end` → `tool_call` → `tool_result` → (下一轮)`text_delta*` → `assistant_end` → `done`。
纯对话模式(关工具):`text_delta*` → `assistant_end` → `verdict?`(可关) → `done`。

### 3.2 `callModel` 流式化 + tool_calls 分片累积
`agent-loop.service.ts` 的 `callModel` 从非流式改为**流式**:
- 请求 `stream:true`,读上游 SSE;逐 chunk:
  - `choices[0].delta.content` → `emit(text_delta)` 并累积成本轮 assistant 文本;
  - `choices[0].delta.tool_calls[i]` → **按 index 累积**(id/name/arguments 分片拼接)成完整 `tool_calls`(这正是 OpenAI/Vercel 标准做法);
  - `finish_reason` 到达 → 收尾:emit `assistant_end`;返回 `{content, tool_calls}` 给循环继续分派。
- 循环其余逻辑不变(processToolCalls、resume、verdict、maxSteps、truncateToolResult)。
- **planFirst / tool_choice:"none" 依旧生效**(流式下 tool_choice 一样传)。

### 3.3 chat 收编到统一端点
- 统一端点 **`POST /api/playground/agent`**(或更名 `/api/playground/run`)。**关工具**的请求 = `tools/mcp/builtin` 全空 + `autoRunMcp` 无意义 → 循环第一轮无 tool_calls → 纯 `text_delta`→`assistant_end`→`done`。等价于流式单发 chat。
- 旧 `POST /api/playground/chat` + `chat.service.runStream` + `pipeUpstreamSseToResponse`:合并落地后**弃用**(保留一版做回归对照,最终删)。`chat.controller` 的 compare 模式(`/chat/compare`)单独评估:compare 走批量非流式对比,不在本次合并范围,暂留。

### 3.4 多模态 task
- `AgentRunRequest.task` 放宽:`z.union([z.string().min(1), z.array(ChatMessageContentPartSchema).min(1)])`(或新增 `taskContent?: ContentPart[]`,二选一,spec 定为**放宽 task**)。
- `buildInitialMessages`:`messages.push({role:"user", content: req.task})` —— content 直接接受 string | ContentPart[],无需改动逻辑,只放宽类型。
- 多模态仅对**视觉/音频模型**有效(纯文本模型传图会被上游拒 —— 能力问题,非本特性 bug;前端可按连接能力提示,V1 不做门控)。

## 4. 前端合并

### 4.1 一个页面 + 一个 store
- 新 `apps/web/src/features/playground/run/`(或复用 `agent/` 改名)。合并 store:`selectedConnectionId, input(system+task 多模态), params(采样), toolsEnabled, builtinTools, inlineTools, selectedMcpServerIds, autoRunMcp, planFirst, maxSteps, timeline: TimelineItem[], running, error...`。
- `TimelineItem` 统一表示对话/轨迹:`{kind:"assistant_text", content}`(由 text_delta 累积)| `tool_call | tool_result | plan | error | user_message | verdict | pending_*`。**一套渲染**:assistant_text 用 markdown 气泡;tool_* 用轨迹卡。关工具时时间线里就只有 user/assistant 气泡 = 看起来就是 chat;开工具时穿插工具卡 = agent 轨迹。

### 4.2 复用 chat 的多模态 composer
- 复用/抽象 `MessageComposer`(附件 image/audio/file → `buildContentParts`)+ system message。作为统一输入框。工具/MCP/skills 选择器作为可选配置区(现 `AgentComposerControls`)。`工具` 开关控制 toolsEnabled(空工具 = chat 模式)。

### 4.3 SSE 分发
`onSseEvent`:`text_delta`→追加当前 assistant_text item;`assistant_end`→封口;`tool_call/tool_result/plan/error`→push 轨迹卡;`tool_result_needed/tool_approval`→pending;`verdict`→verdict 卡;`done`→存 continuationMessages + running=false。复用现有 `playgroundFetchStream`。

### 4.4 输出渲染统一
- `MessageList` 的多模态渲染(img/audio)+ `TraceMarkdown` 的 markdown + `StepCard/PlanStrip/TraceTimeline` 合并成一套 `Timeline`。补齐 chat 侧缺的 markdown 渲染(现 MessageList 纯文本)。

### 4.5 history 合并
- 一个 history store,snapshot = 合并输入配置 + timeline + verdict。附件走现有 IDB blob 持久化(agent 之前跳过,合并后需补 —— chat 的 `persistAttachments`/`rehydrate` 逻辑复用)。

## 5. 分阶段(一个 PR,commit 分阶段)

1. **contracts**:统一事件协议(加 `text_delta`/`assistant_end`)+ 放宽 `task` 多模态 + `AgentRunRequest` 补 `params`(采样)。
2. **callModel 流式化** + tool_calls 分片累积(后端核心,重测 agent-loop 全用例:tool_calls 分片、planFirst、resume、截断、verdict 不回归)。
3. **循环发 text_delta/assistant_end**;端点纯对话路径(关工具)验证等价流式 chat。
4. **前端合并**:统一 store + timeline + 多模态 composer + SSE 分发 + 输出渲染。
5. **history 合并**(含附件 blob)。
6. **收尾**:弃用/删 `/api/playground/chat` + chat 前端;router/sidebar 收成一个 Playground 入口(或保留两入口指向同页 + 预置 toolsEnabled)。compare 模式单列评估。

## 6. 测试
- contracts:新事件 schema、放宽 task 多模态 parse。
- callModel 流式:mock 流式上游,断言 text_delta 顺序 + tool_calls 分片按 index 拼全 + finish_reason 收尾。
- agent-loop 全回归(现 19 用例)+ 新纯对话(关工具)用例:只出 text_delta→assistant_end→done。
- 前端:关工具 = 气泡流式;开工具 = 轨迹;多模态附件渲染;history 往返含附件。
- 手动 e2e:真实端点跑 chat(关工具,看打字流式)+ agent(开工具,看轨迹)同页切换。

## 7. 本次不做 / 保留
- **chat/compare**(并排对比)暂留独立,不进本次合并(批量非流式,评测形态不同)。
- OTel(issue #353)独立推进,不在本次。
- 多模态能力门控(按模型能力禁图)—— V1 不做,只在能力不支持时透传上游报错。
- image/audio/embeddings/rerank 等其它 modality playground **不动**(它们不是对话/agent 形态)。

## 8. 风险
- **`callModel` 流式化触及被反复评审的循环核心** —— 分片 tool_calls 累积是最易错处(按 index、id/name 只在首片、arguments 累加),必须重测全用例 + 加分片单测。
- 弃用 `/chat` 端点前,确保统一端点在关工具下**完全等价**(流式打字、usage、错误)—— 灰度:先前端切统一端点、旧端点保留一版,验证后再删。
- 多模态 + history blob 往返、大 tool 结果截断、判官对多模态 content 的处理需覆盖。
