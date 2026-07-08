# 交互式 Agent 能力测试 Playground — 设计文档

- 日期:2026-07-08
- 分支:`feat/agent-playground`
- 范围:在 Playground 新增一个 **Agent** tab —— 选一个模型 endpoint,给一个带工具的任务,**实时看模型 plan → 调工具 → 读结果 → 收尾** 的多轮 tool-call 轨迹,叠引擎侧指标,末尾出一张轻量能力评分卡。工具来源:内置 demo 工具、用户手写工具(结果手填)、**MCP server**(自动执行,带审批)。可存/取 **Skill** 预设。**不动** τ³(它是离线 batch 打分,本特性是交互单跑,互补不重叠)。

## 1. 问题与定位

ModelDoctor 现在的 Playground 全是**单发代理**(chat/image/audio…):一句进、一句出,**零 tool-calling、零多轮循环、只有 MCP server 没 client**。所以"这个引擎上的这个模型会不会做 agent(规划、选工具、多步、纠错)"**在产品里没法交互回答** —— 只能靠 τ³ 跑离线 batch 拿聚合分。

业内交互式 agent 测试已收敛成一个形状(Dify/Langflow/Chainlit/HiMarket 体验中心):**挂工具/MCP → 给任务 → 模型自跑 tool-call 循环 → 看逐步轨迹**。但它们**要么只"看"不打分(playground 类),要么只"打分"不交互(Inspect/DeepEval/tau²/BFCL 类)**,没人把「交互驱动 + 逐步轨迹 + 引擎可观测 + 轻量打分」缝成闭环。HiMarket/HiCoding 是**市场 + 试用/CoWork**,不做逐步轨迹剖析,也不做能力打分。

**ModelDoctor 的独有杠杆**:私有化多引擎推理 + 可观测底座。把交互 tool-call 轨迹接到引擎侧指标(每步 TTFT/tokens/tool 延迟),再叠一张轻量评分卡 —— 填的正是"自托管、剖开看 + 打分"这个市场真空。

## 2. 已定决策(brainstorm 结论)

| 决策点 | 结论 | 理由 |
|---|---|---|
| 建 vs 用 HiMarket | **在 ModelDoctor 里建**,但 MCP/skill 尽量接 Higress/HiMarket 现成资产 | HiMarket = 市场/试用,不做轨迹剖析+引擎可观测+打分;两者互补。别重造市场。 |
| 地基 | **服务端多轮 tool-call 循环 + 轨迹时间线** | 现状单发,循环是净新,一切挂它上。 |
| MCP server 存储 | **独立 `McpServer` 表/模块,不并进 Connection** | Connection 一堆模型专属字段 MCP 用不上;并入 = god-table + 现有栈全要补 `kind` 过滤(串味税)。独立表纯增、零 ripple、更贴 HiMarket 的资产分型。复用 `encrypt/decrypt` 函数即可,不需共表。 |
| Connection | **不动**,仍只管模型 endpoint(被测对象) | 零风险。 |
| skill | **本地预设**,引用 model Connection + McpServer + inline 工具;**不是** Connection.kind、**不是** Anthropic SKILL.md | 它引用外部资产,自己不是 endpoint;SKILL.md(文件夹+代码执行 runtime)是另一个大得多的独立项。 |
| 用户手写工具执行 | **结果手填**(同 OpenAI/Anthropic playground) | Phase 内绕开"执行任意用户代码"的安全面;真自动执行从 MCP 起。 |
| MCP 执行安全 | **默认每步人工批准 + 「自动跑」开关**;传输先 **HTTP/SSE** | MCP 是"模型自选、对你环境真执行"的第一处,不能裸奔;stdio 留后。 |
| 打分 | **轻量单轨迹 judge**(复用 llm-judge),出一张结论卡;**不**重造 τ³ pass^k/path-convergence | 交互单跑严谨打分本就糊;可复现基准归 τ³ batch。 |

## 3. 数据模型(新增两张表,Connection 不动)

Prisma migration 用 `prisma migrate dev --create-only`(见 CLAUDE.md);seed 不涉及。

### 3.1 `McpServer`(新)
```
id, userId, name, description?
transport   String   // "http" (=Streamable HTTP / SSE);先只做 http
url         String   // MCP server 端点
authTokenCipher String? // 复用 CONNECTION_API_KEY_ENCRYPTION_KEY + common/crypto/aes-gcm
headers     Json?    // 额外 header(如 Higress 网关鉴权)
toolsCache  Json?    // 上次 discover 到的工具清单(name/desc/inputSchema/annotations)
toolsCachedAt DateTime?
enabled     Boolean @default(true)
createdAt, updatedAt
@@index([userId])
```
Higress/HiMarket 关联:`url` 直接填网关上注册的 MCP server 地址 + `headers` 带网关鉴权即可 —— 无需专门字段。

### 3.2 `Skill`(新)
```
id, userId, name, description?
systemPrompt String?
modelConnectionId String?   // 引用 Connection(可空:应用时再选)
mcpServerIds String[]       // 引用 McpServer
inlineTools  Json?          // 用户手写工具 schema 数组
planFirst    Boolean @default(false)
maxSteps     Int @default(12)
createdAt, updatedAt
@@index([userId])
```
Skill = 一键把 agent 配置装好的本地存档;引用资产、不复制。

## 4. 架构

### 4.1 服务端多轮 tool-call 循环(核心)

新模块 `apps/api/src/modules/playground-agent/`。新端点 `POST /api/playground/agent`(SSE),body:
```ts
{ connectionId, task, systemPrompt?, planFirst?, maxSteps?,
  inlineTools?: ToolDef[],           // 只有 schema、无执行器
  mcpServerIds?: string[],           // 自动执行(带审批)
  builtinTools?: string[],           // 选内置 demo 工具
  autoRunMcp?: boolean }             // MCP 是否免审批自动跑
```
循环(服务端,`AgentLoopService`):
1. 组 messages:`[system?, (plan 指令?), user(task)]`;组 `tools` = 内置 + inline + 各 McpServer 的工具(打平成 OpenAI function 定义,MCP 工具名加前缀 `mcp__<server>__<tool>` 防撞)。
2. 调模型(复用 §4.3 扩展后的 openai-client;流式)。SSE 把 `delta.content` 与 `delta.tool_calls` 逐步推给前端(轨迹卡)。
3. 模型给出 tool_calls → 按工具**分派执行**(§4.2)→ 把每个结果作为 `{role:"tool", tool_call_id, content}` 追加 → 回到 2。
4. 模型不再要工具 / 撞 `maxSteps` / 用户中止 → 收尾;可选触发 §4.5 评分。
每一步(model 请求、每个 tool 调用)都发一个 SSE `step` 事件带类型(`plan|tool_call|tool_result|assistant|verdict|error`)+ 计时,前端据此长轨迹。

### 4.2 工具执行分派 —— 按"有没有后端执行器"统一
- **内置 demo 工具**(`get_current_time` / `http_get` / `calculator`):服务端直接执行。`http_get` 限制到白名单/超时,防 SSRF。
- **MCP 工具**:经 §4.4 的 MCP client 调对应 McpServer。默认发一个 `tool_approval` SSE 事件**等前端批准**(除非 `autoRunMcp`);批准后执行、回结果。
- **用户手写工具**(无执行器):发 `tool_result_needed` 事件 → 前端弹输入框让用户填 JSON 结果 → 回传 → 作为 tool 结果继续。

### 4.3 复用并扩展共享 openai-client(不 fork)
`packages/contracts/src/playground.ts`:`ChatMessageSchema` 加 `tool` 角色 + `tool_calls`/`tool_call_id`;新增 `ToolDef`。`ChatParamsSchema` 或新 `AgentParamsSchema` 加 `tools`/`tool_choice`。
`apps/api/src/integrations/openai-client/wires/chat.ts`:`buildPlaygroundChatBody` 支持 emit `tools`/`tool_choice`。SSE 解析路径(`sse.ts`)加 `delta.tool_calls` 累积(分片 tool_calls 要按 index 拼)。

### 4.4 MCP client(净新)
新 `apps/api/src/modules/mcp-client/`,用已有依赖 `@modelcontextprotocol/sdk` 的 **Client + Streamable HTTP client transport**(仓库现只用 server 侧)。能力:
- `discoverTools(mcpServer)` → 连接 + `listTools()` → 存 `toolsCache`;
- `callTool(mcpServer, name, args)` → `callTool()` → 归一化结果为文本/JSON。
- 连接短生命周期(每次调用建/拆)或带缓存池;鉴权用 McpServer 的 `authTokenCipher` 解密后走 header。
McpServer 详情页有「发现工具」按钮(刷新缓存 + 展示工具/标注)。

### 4.5 轻量轨迹评分(复用 llm-judge)
循环结束,`AgentJudgeService` 用 `apps/api/src/modules/llm-judge/`(默认 provider)对整条轨迹跑一次 judge,产出结论卡:`{ taskCompleted: bool, toolUseCorrect: bool, extraSteps: int, oneLineVerdict: string }`。发 `verdict` SSE 事件。**这是"能力测试"的落点**;严谨可复现打分仍归 τ³。

### 4.6 前端(`apps/web/src/features/playground/agent/`)
- 新 tab,复用 `PlaygroundShell` + `CategoryEndpointSelector`(选 model Connection)。
- **左/参数区**:任务框、`planFirst` 开关、`maxSteps`、工具区(内置勾选 + 手写工具编辑器 + **McpServer 多选**(自己的 picker)+ `autoRunMcp` 开关)、Skill 下拉(应用/存为)。
- **中间轨迹时间线**:`🧠plan / 🔧tool_call(名+参数)/ 📥result / 💬answer / ✅verdict` 竖排卡片,SSE 边跑边长;MCP 工具卡有「批准/拒绝」按钮;手写工具卡有结果输入框。
- **右侧栏**:每步指标 + 小结(工具调用数/轮数/是否兜圈)。指标分两层:**基线**(循环自测的每步墙钟耗时 + 模型响应里的 token usage —— 无依赖,必做);**富化(可选)**:若被测 Connection 绑了 Prometheus datasource,叠该引擎侧的 TTFT/吞吐(复用 `engine-metrics` 模块)—— 这是私有化多引擎可观测的差异化,但不阻塞主流程。
- zustand store 镜像 `chat/store.ts`;history 复用现有 IndexedDB drawer。
- McpServer / Skill 各有列表页(镜像 connections 列表页约定)。

## 5. 安全模型

- **MCP 工具执行默认人工批准**(每步 approve/deny),`autoRunMcp` 让用户显式打开免审批。
- MCP 工具若带 `annotations.readOnlyHint` 等标注,前端标出读/写,写操作即使 `autoRunMcp` 也可选强制审批(V1 简单版:只区分展示)。
- `http_get` 内置工具限白名单 + 超时,防 SSRF。
- McpServer auth token 加密存储,解密只在服务端调用时,绝不回前端。

## 6. 分阶段(一个 PR,commit 分阶段)

1. `McpServer` schema + 模块(CRUD/加密/列表页/picker)。
2. `Skill` schema + 模块(CRUD/列表页)。
3. openai-client 扩展(tool role / tools / delta.tool_calls)+ contracts。
4. `AgentLoopService` + `/api/playground/agent` SSE + 内置工具 + inline 工具(手填)。
5. 前端 Agent tab:配置区 + 轨迹时间线 + 引擎指标(消费 3/4)。
6. MCP client 模块 + 接入循环(发现/执行/审批)+ 前端审批 UI。
7. Skill 应用/存为 + McpServer 多选接入。
8. 轻量轨迹 judge + 结论卡。

每阶段独立可测;若中途要停,前几阶段是可用子集(3–5 已是"内置/手写工具的交互 agent tester")。

## 7. 测试

- **contracts/wires**(vitest):tool role/tools 序列化;分片 delta.tool_calls 按 index 拼接。
- **AgentLoopService**(vitest):mock 模型返回 tool_calls → 断言执行分派 + tool 结果回灌 + maxSteps 收尾 + 无 tool_calls 收尾;三类工具各一条路径。
- **MCP client**(vitest):mock SDK Client,discoverTools/callTool 归一化 + 鉴权 header;审批门控(未批准不执行)。
- **McpServer/Skill 模块**(vitest + e2e):CRUD + 归属 + 加密往返。
- **web**(vitest):轨迹卡按 SSE 事件渲染;MCP 卡审批按钮;手写工具结果输入回灌;verdict 卡。
- **手动 e2e**:选真实支持 tool-calling 的模型 + 挂一个真 MCP server(或 ModelDoctor 自带的 `/api/mcp`)→ 跑带工具任务 → 看轨迹 + 审批 + 结论。

## 8. 本期不做(YAGNI / 后续)

- **严谨 agentic 打分**(pass^k / path-convergence / 可复现任务集)→ 归 τ³ batch。
- **Anthropic SKILL.md**(文件夹 + 渐进披露 + 代码执行 runtime)→ 独立大项。
- **MCP stdio 传输** / MCP 工具的完整读写沙箱 → 后续。
- **skills/MCP 市场 UI**(浏览/订阅)→ 接 HiMarket,不自建。
- **多 agent / agent 编排**(Dify agentflow 那种)→ 不做,我们是"测试器"不是"搭建平台"。
- Connection 加 `kind` / typed connection → 明确否决,用独立 McpServer 表替代。
