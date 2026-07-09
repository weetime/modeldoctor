# 统一 Playground(Chat + Agent 合并)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Chat 与 Agent playground 合并成一个 Playground:一个多模态输入 + 可选工具/MCP/skills + 自适应输出(流式对话气泡 ↔ agent 轨迹),后端统一成一条 typed 事件流。

**Architecture:** 扩展现有 `AgentSseEvent` 加 `text_delta`/`assistant_end`;把 `AgentLoopService.callModel` 从非流式改为**流式**并从 delta **按 index 累积 tool_calls**;循环边流式发 `text_delta` 边发 step 事件。关工具的请求 = 纯 `text_delta→assistant_end→done` = 等价流式 chat,于是 chat 收编到统一端点。`task` 放宽为多模态。前端合并成一 store + 一套 Timeline 渲染,复用 chat 的多模态 composer。

**Tech Stack:** TypeScript(NestJS api / React web / contracts / vitest)、SSE 流式、`ChatMessage`/`ToolDef` 契约。

**关联 spec:** `docs/superpowers/specs/2026-07-09-unified-playground-design.md`(读它了解决策与理由)。

## Global Constraints

- **统一事件流**:一条 SSE 承载 `text_delta`(逐 token)+ `assistant_end` + `step`(tool_call/tool_result/plan/error)+ `tool_result_needed`/`tool_approval`/`verdict`/`done`。对齐业内主流(OpenAI Agents SDK / Vercel AI SDK)。
- **tool_calls 分片累积**:流式下 `delta.tool_calls[i]` 按 `index` 累积——`id`/`function.name` 只在首片出现、`function.arguments` 逐片拼接。这是全案最易错处,必须有独立单测。
- **关工具 = 等价流式 chat**:tools/mcp/builtin 全空 → 循环一轮无 tool_calls → 纯 `text_delta→assistant_end→(verdict?)→done`。不得回归 chat 的实时打字。
- **多模态**:`AgentRunRequest.task` 放宽为 `string | ChatMessageContentPart[]`;`buildInitialMessages` 直接透传给 `{role:"user", content}`。仅视觉/音频模型有效,V1 不做能力门控。
- **planFirst 保留**:第一轮 `tool_choice:"none"` 强制计划(流式下一样传)。
- **不回归**:agent-loop 现有 19 用例全绿;`truncateToolResult`(8000 char 上限)、resume/续跑、审批门控、判官 verdict、SSRF、多轮无双执行 —— 全部保持。
- **不做**:chat/compare(独立)、OTel(issue #353)、image/audio/embeddings/rerank 其它 modality、多模态能力门控。
- **commit 规约**:conventional prefix、显式 `git add <files>`(禁 `-A`)、body 末 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。vitest 在 apps/api 用 `.mts`;i18n 双语;biome 干净;`no-hardcoded-zh`(源码零 CJK,注释也要英文)。
- **灰度删旧**:统一端点在关工具下验证等价后,才弃用 `POST /api/playground/chat` + `chat.service.runStream` + chat 前端。

---

## File Structure

**contracts(修改)**
- `packages/contracts/src/agent.ts` — `AgentSseEvent` 加 `text_delta`/`assistant_end`。
- `packages/contracts/src/agent-run.ts` — `task` 放宽多模态;加 `params`(采样)。

**api(修改)**
- `apps/api/src/modules/playground-agent/streaming.ts`(新)— `accumulateToolCalls` + `readStreamingChatCompletion`(纯逻辑,可测)。
- `apps/api/src/modules/playground-agent/agent-loop.service.ts` — `callModel` 改流式;循环发 `text_delta`/`assistant_end`。
- `apps/api/src/modules/playground-agent/agent.controller.ts` — 无变动(emit 已通用)。

**web(新增/合并)** — 在 `apps/web/src/features/playground/agent/` 就地演进(合并后即"统一 Playground",避免大改路径;收尾再决定改名)
- `store.ts` — 合并态(input 多模态 + params + toolsEnabled + timeline)。
- `timeline.ts`(新)— `TimelineItem` 类型 + 从 SSE 事件归约。
- `RunPage.tsx`(由 `AgentPage.tsx` 演进)— 复用 chat `MessageComposer` + 配置区 + Timeline。
- 复用 `../chat/MessageComposer.tsx`、`../chat/attachments.ts`(`buildContentParts`)、`trace/*`、`../chat/MessageList` 的多模态渲染片段。

**收尾(删)**
- `apps/api/src/modules/playground/chat.controller.ts` + `chat.service.ts`(灰度后)、`apps/web/src/features/playground/chat/ChatPage.tsx`(灰度后)、router/sidebar 收一个入口。

---

## PHASE 1 — 契约:统一事件协议 + 多模态 task

### Task 1: contracts — text_delta/assistant_end + 多模态 task + params

**Files:**
- Modify: `packages/contracts/src/agent.ts`(`AgentSseEventSchema`)、`packages/contracts/src/agent-run.ts`(`AgentRunRequestSchema`)
- Test: `packages/contracts/src/agent.spec.ts`(追加)、`packages/contracts/src/agent-run.spec.ts`(追加/新建)

**Interfaces:**
- Produces:
  - `AgentSseEvent` 新增两支:`{ type:"text_delta", delta: string }` 和 `{ type:"assistant_end" }`。
  - `AgentRunRequest.task`: `z.union([z.string().min(1), z.array(chatMessageContentPartSchema).min(1)])`(从 `playground.ts` 导入 `ChatMessageContentPartSchema`——注意 agent-run.ts 已是独立模块正为避免循环,确认从 `./playground.js` 导入不引入循环:playground.ts 不 import agent-run.ts,单向安全)。
  - `AgentRunRequest.params?`: `chatParamsSchema.pick({temperature:true,maxTokens:true,topP:true,frequencyPenalty:true,presencePenalty:true,seed:true,stop:true}).partial().optional()`(采样参数;不含 tools/tool_choice/stream——那些 agent 另有字段/内部控制)。

- [ ] **Step 1: 失败测试** — agent.spec:`AgentSseEventSchema.parse({type:"text_delta", delta:"hi"})` 通过;`parse({type:"assistant_end"})` 通过。agent-run.spec:`AgentRunRequestSchema.parse({connectionId, task:"x"})` 通过;`parse({connectionId, task:[{type:"text",text:"hi"},{type:"image_url",image_url:{url:"data:image/png;base64,AA=="}}]})` 通过;`parse({connectionId, task:""})` 抛(min1);`parse({connectionId, task:"x", params:{temperature:0.5}})` 通过。
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/contracts exec vitest run src/agent.spec.ts src/agent-run.spec.ts` → FAIL。
- [ ] **Step 3: 实现** 两支事件加进 `AgentSseEventSchema` 的 discriminated union;`task` 改 union;`params` 加 pick。import `ChatMessageContentPartSchema`/`chatParamsSchema` from `./playground.js`。
- [ ] **Step 4: Run** → PASS;`pnpm -F @modeldoctor/contracts build` clean;确认无循环导入(build 不报 TDZ)。
- [ ] **Step 5: Commit** `feat(contracts): unified playground stream events (text_delta/assistant_end) + multimodal task`

---

## PHASE 2 — 后端流式核心

### Task 2: 流式读取 + tool_calls 分片累积(纯逻辑,重点单测)

**Files:**
- Create: `apps/api/src/modules/playground-agent/streaming.ts` + `streaming.spec.ts`

**Interfaces:**
- Produces:
  - `accumulateToolCallDelta(acc: StreamingToolCall[], delta: ToolCallDelta): void` —— 按 `delta.index` 累积:该 index 不存在则新建 `{id, type:"function", function:{name, arguments}}`;存在则 `id`/`name` 若 delta 提供则覆盖(通常仅首片有)、`arguments` 字符串**追加拼接**。
  - `readStreamingChatCompletion(upstream: Response, onTextDelta: (s:string)=>void): Promise<{ content: string; tool_calls: ToolCall[] }>` —— 读 SSE 逐行 `data:`,`[DONE]` 结束;每 chunk:`choices[0].delta.content` → 累积 content + `onTextDelta`;`choices[0].delta.tool_calls[]` → `accumulateToolCallDelta`。返回完整 content + 拼全的 tool_calls(空则 `[]`)。
  - 类型 `StreamingToolCall`/`ToolCallDelta`(本模块内定义;`ToolCall` 用 contracts 的)。

- [ ] **Step 1: 失败测试** — streaming.spec:
  - `accumulateToolCallDelta`:喂三片 `{index:0,id:"c1",function:{name:"f",arguments:"{\"a\":"}}`、`{index:0,function:{arguments:"1}"}}`、`{index:1,id:"c2",function:{name:"g",arguments:"{}"}}` → 得 `[{id:"c1",function:{name:"f",arguments:"{\"a\":1}"}},{id:"c2",function:{name:"g",arguments:"{}"}}]`。
  - `readStreamingChatCompletion`:构造一个假 `Response`(body 是 `ReadableStream` 吐 `data: {choices:[{delta:{content:"He"}}]}\n\n`、`data: {choices:[{delta:{content:"llo"}}]}\n\n`、`data: [DONE]\n\n`)→ onTextDelta 收到 "He","llo";返回 `{content:"Hello", tool_calls:[]}`。
  - 另一条:delta 里带分片 tool_calls → 返回拼全的 tool_calls + content ""。
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/api exec vitest run src/modules/playground-agent/streaming.spec.ts` → FAIL。
- [ ] **Step 3: 实现** streaming.ts。SSE 读取参考 `apps/web/src/lib/playground-stream.ts` 的 `\n\n` 切分 + `data:` 前缀逻辑(服务端用 `upstream.body!.getReader()` + `TextDecoder`,缓冲跨 chunk 半行)。
- [ ] **Step 4: Run** → PASS。
- [ ] **Step 5: Commit** `feat(api): streaming SSE reader + tool_calls delta accumulation`

### Task 3: callModel 流式化 + 循环发 text_delta/assistant_end

**Files:**
- Modify: `apps/api/src/modules/playground-agent/agent-loop.service.ts`(`callModel` + `run` 循环体)
- Test: `apps/api/src/modules/playground-agent/agent-loop.service.spec.ts`(现有 mock `svc.callModel`;新增流式行为需要新的注入方式——见下)

**Interfaces:**
- Consumes: `streaming.ts`(Task 2)、`buildPlaygroundChatBody`(加 `stream:true`)。
- Produces:
  - `callModel(conn, body, signal, onTextDelta?)` —— 请求 `stream:true`,用 `readStreamingChatCompletion(upstream, onTextDelta ?? noop)` 返回 `{content, tool_calls}`(签名保持返回 `ParsedPlaygroundChatResponse` 兼容:`{content, usage:undefined, tool_calls}`)。usage 流式下可选,置 undefined。
  - `run` 循环:调 `this.callModel(conn, body, signal, (d)=>emit({type:"text_delta", delta:d}))`;拿到 parsed 后 `emit({type:"assistant_end"})`(当本轮有文本时);**不再** emit 整条 `{kind:"assistant"}` step(文本已由 text_delta 流出)。plan 轮:仍按现逻辑 emit `{kind:"plan", content}`(计划短、要进 pinned strip,保持整条;流式文本用 text_delta 也 emit 但 plan 的 pinned 展示以 plan step 为准——实现取:plan 轮不发 text_delta,只发 plan step,避免与 pinned strip 重复;非 plan 轮发 text_delta+assistant_end)。

  > 实现注记(reconcile plan vs 流式):plan 轮(`isPlanTurn`)传给 callModel 的 onTextDelta 用 noop(不流式到前端),拿到完整 content 后 emit 一条 `{kind:"plan"}` step。非 plan 轮才走 text_delta 流式。这样 pinned Plan 条不重复,普通助手文本实时打字。

- [ ] **Step 1: 失败测试** — 现有测试把 `svc.callModel` 整个替换成 mock(返回 `{content, tool_calls}`),不经流式路径,**仍然有效**(callModel 是注入点)。新增:一条测试注入一个 mock `callModel`,断言循环在拿到 parsed 后 emit 了 `assistant_end`,且当 `onTextDelta` 被调用时会 emit `text_delta`(mock callModel 主动调用传入的 onTextDelta 几次 → 断言 events 里有对应 text_delta)。另加纯对话用例:mock callModel 返回 `{content:"hi", tool_calls:undefined}` 且调用 onTextDelta("hi") → events = `[text_delta("hi"), assistant_end, (verdict?), done]`,`callModel` 1 次。
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/api exec vitest run src/modules/playground-agent/agent-loop.service.spec.ts` → 先跑现有 19 用例确认不回归(callModel 仍是注入点),再 FAIL 于新用例。
- [ ] **Step 3: 实现** callModel 流式 + 循环 text_delta/assistant_end + plan 轮 noop。现有把整条 assistant step 的分支移除(改为 assistant_end 边界)。**保留** plan/tool_call/tool_result/error step、resume、maxSteps、verdict、truncate。
- [ ] **Step 4: Run** → 全绿(19 现有 + 新用例)。`pnpm -r build` + `pnpm -F @modeldoctor/api build` clean。
- [ ] **Step 5: Commit** `feat(api): stream assistant text as text_delta; agent loop emits assistant_end`

---

## PHASE 3 — chat 收编到统一端点(等价性验证)

### Task 4: 关工具路径 = 等价流式 chat(后端验证)

**Files:**
- Test: `apps/api/src/modules/playground-agent/agent-loop.service.spec.ts`(追加)
- (可选)Modify: `agent-run.ts`——确认关工具(无 tools/mcp/builtin/inlineTools)时 `run` 不发任何 tool/step,只 text_delta→assistant_end→done。

**Interfaces:**
- Consumes: Task 3 的流式 run。
- Produces: 断言"无工具请求"的事件序列纯净(无 tool_call、无 plan(除非 planFirst));verdict 仅当判官配置且完成——纯对话默认可关 verdict(见下决策)。

- [ ] **Step 1: 失败测试** — mock callModel 返回单轮 `{content:"answer", tool_calls:undefined}` + onTextDelta("answer");`run(conn, baseReq({}) /*无任何工具*/, emit)` → 事件 = `[text_delta, assistant_end, done]`(纯对话,无 verdict——除非有判官)。断言 `callModel` 1 次、无 `step` 事件。
- [ ] **Step 2-4: 实现/确认 + 绿。** 若纯对话仍触发 verdict(判官已配)导致噪音:决定纯对话(零工具)**跳过 verdict**(verdict 是 agent 能力评分,纯对话无意义)——在 `maybeEmitVerdict` 前加 `if (toolsWereAvailable)` 门控。加测试覆盖。
- [ ] **Step 5: Commit** `test(api): tools-off run is an equivalent streaming chat (text_delta only); skip verdict when no tools`

---

## PHASE 4 — 前端合并

### Task 5: 合并 store + TimelineItem 归约

**Files:**
- Create: `apps/web/src/features/playground/agent/timeline.ts` + `timeline.test.ts`
- Modify: `apps/web/src/features/playground/agent/store.ts`

**Interfaces:**
- Produces:
  - `TimelineItem` 联合:`{kind:"assistant_text", content:string}` | `{kind:"tool_call"|"tool_result"|"plan"|"error", step:AgentStep}` | `{kind:"verdict", verdict:AgentVerdict}`(pending 卡仍走独立 store 字段)。
  - `reduceEvent(items: TimelineItem[], evt: AgentSseEvent): TimelineItem[]` —— `text_delta`→若末项是 open 的 assistant_text 则追加,否则新建;`assistant_end`→封口当前 assistant_text(标记 closed);`step`→push 对应 item(plan/tool_call/tool_result/error);`verdict`→push;其余(pending/done)不进 timeline(store 另存)。
  - store 加:`input`(多模态 draft)、`params`(采样)、`toolsEnabled:boolean`、`timeline: TimelineItem[]`、`appendEvent(evt)`(内部调 reduceEvent)。保留 tools/mcp/skill/pending/continuation 字段。

- [ ] **Step 1: 失败测试** — timeline.test:一串事件 `text_delta("He")`,`text_delta("llo")`,`assistant_end`,`step(tool_call)`,`step(tool_result)`,`text_delta("done")`,`assistant_end`,`verdict` → reduce 出 `[assistant_text("Hello"), tool_call, tool_result, assistant_text("done"), verdict]`。
- [ ] **Step 2-4: 实现 + 绿。**
- [ ] **Step 5: Commit** `feat(web): unified timeline reducer + merged playground store`

### Task 6: 复用多模态 composer + 配置区

**Files:** Modify `apps/web/src/features/playground/agent/RunPage.tsx`(由 AgentPage 演进);复用 `../chat/MessageComposer` + `../chat/attachments`。

**Interfaces:**
- Consumes: `MessageComposer`(props:`onSend(text, attachments)`、system message 等)、`buildContentParts`、合并 store。
- Produces: 输入区 = `MessageComposer`(system + 多模态附件);其下 `AgentComposerControls`(工具/MCP/skill,前加一个 `工具` 总开关 → `toolsEnabled`);`onSend` 构造 `AgentRunRequest`:`task = buildContentParts(text, attachments)`、按 toolsEnabled 决定是否带 tools/mcp/builtin。

- [ ] **Step 1: 失败测试** — RunPage.test:关工具(toolsEnabled=false)时 onSend 发的 body 无 `builtinTools`/`mcpServerIds`(或空);开工具时带上。附件 → task 变成 ContentPart[]。
- [ ] **Step 2-5: 实现 + 绿 + commit** `feat(web): multimodal composer + tools toggle in unified playground`

### Task 7: SSE 分发 + 统一 Timeline 渲染

**Files:** Modify RunPage + `trace/` 渲染;新/改 `Timeline` 组件消费 `TimelineItem[]`。

**Interfaces:**
- Consumes: `runAgentSse`(现有)、`reduceEvent`(Task 5)、`TraceMarkdown`/`StepCard`/`PlanStrip`。
- Produces: `onSseEvent` → `store.appendEvent(evt)` + pending/done/verdict 副作用;`Timeline` 渲染 `assistant_text`(markdown 气泡)、tool_* 卡、plan pinned、verdict 卡。关工具时 timeline 只有 assistant_text = chat 观感;开工具穿插工具卡 = agent 轨迹。

- [ ] **Step 1: 失败测试** — 注入假流:关工具 `text_delta*→assistant_end→done` → 只渲染一个流式增长的助手气泡;开工具 `text_delta→assistant_end→tool_call→tool_result→text_delta→assistant_end→verdict→done` → 气泡+工具卡+气泡+verdict 按序。
- [ ] **Step 2-5: 实现 + 绿 + commit** `feat(web): unified timeline rendering (streaming bubbles ↔ trace cards)`

### Task 8: 页面装配 + 入口收敛

**Files:** router/index.tsx、sidebar-config.tsx、locales。

- [ ] 路由 `playground/chat` 与 `playground/agent` 收敛:保留一个 `playground/run`(或复用 `/agent`)指向统一页;`/chat` 暂重定向到统一页(灰度)。sidebar 收一个 "Playground" 入口(或两入口指向同页 + 预置 toolsEnabled——按 spec §7 待你定,计划默认:一个入口)。i18n。测试 render + 路由。Commit `feat(web): single unified playground entry`。

---

## PHASE 5 — history 合并(含附件)

### Task 9: 统一 history + 附件 blob 持久化

**Files:** Modify `agent/history.ts`;复用 chat 的 `persistAttachments`/`rehydrate`(`../history/persistAttachments.ts`)。

**Interfaces:**
- Produces: `UnifiedHistorySnapshot` = 输入(多模态,附件走 idb:// 哨兵)+ params + tools 配置 + timeline + verdict。auto-save 前 `persistAttachments`;restore 后 rehydrate。

- [ ] **Step 1: 失败测试** — history round-trip:含图片附件的输入 save→newSession→restore,附件哨兵/blob 正确往返;timeline 恢复。
- [ ] **Step 2-5: 实现 + 绿 + commit** `feat(web): unified playground history with attachment blobs`

---

## PHASE 6 — 收尾:灰度删旧

### Task 10: 弃用 /chat 端点 + chat 前端

**Files:** 删 `apps/api/src/modules/playground/chat.controller.ts` + `chat.service.ts`(+ 从 `playground.module.ts` 摘除);删 `apps/web/src/features/playground/chat/ChatPage.tsx`(compare 保留);router/sidebar 清理。

- [ ] **前置门槛**:Task 4 + 手动 e2e(Task 11)确认统一端点关工具**完全等价**(流式打字/usage/错误)后才删。删后跑全量 build + api/web 测试 + e2e。
- [ ] Commit `refactor: remove legacy /api/playground/chat (superseded by unified endpoint)`。

### Task 11: 手动 e2e(验证)

- [ ] 真实端点:关工具跑对话(看 token 流式打字)、开工具跑 agent(camp/vast,看轨迹 + 审批 + verdict)、多模态附件(视觉模型可选)、同页切换工具开关、history 往返。回归:image/audio/embeddings/rerank/chat-compare 不受影响。记录,不 commit。

---

## Self-Review

**1. Spec 覆盖:** §3.1 事件协议→T1;§3.2 callModel 流式+累积→T2/T3;§3.3 chat 收编→T4/T10;§3.4 多模态 task→T1/T6;§4.1 store+timeline→T5;§4.2 composer→T6;§4.3 SSE 分发→T7;§4.4 渲染→T7;§4.5 history→T9;§5 分阶段=6 phase;§6 测试散落各任务+T11;§7 不做项无对应任务(正确);§8 风险→T2(累积单测)/T4(等价)/T10(灰度门槛)。**无缺口。**

**2. 占位扫描:** 无 TBD。T3 的"plan 轮 noop 不流式"、T4 的"零工具跳 verdict"、T10 的"前置门槛"是具名决策/护栏,非占位。

**3. 类型一致:** `text_delta`/`assistant_end`(T1)↔ callModel/循环 emit(T3)↔ reduceEvent(T5)↔ 渲染(T7)一致;`AgentRunRequest.task` 多模态(T1)↔ onSend `buildContentParts`(T6)↔ buildInitialMessages 透传一致;`accumulateToolCallDelta`/`readStreamingChatCompletion`(T2)↔ callModel(T3)一致;`TimelineItem`(T5)↔ Timeline 渲染(T7)一致。

**关键护栏(最易错):** tool_calls 分片按 index 累积(T2 独立单测)、plan 轮不与 pinned strip 重复(T3 noop)、关工具等价流式 chat 且跳 verdict(T4)、删 /chat 前先验等价(T10 门槛)。
