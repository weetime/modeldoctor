# 交互式 Agent 能力测试 Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Playground 新增一个 Agent tab —— 选一个模型 endpoint,给带工具的任务,实时看模型 plan→调工具→读结果→收尾 的多轮 tool-call 轨迹;工具来源=内置/用户手写(手填结果)/MCP server(自动执行+审批);可存取 Skill 预设;末尾轻量轨迹评分。

**Architecture:** 复用现有 K8s 无关的 in-process 链路。新增 `McpServer`/`Skill` 两张表(镜像 `connection` 模块,`Connection` 不动)。服务端 `AgentLoopService` 跑多轮 tool-call 循环,经新 SSE 端点 `/api/playground/agent` 逐步推轨迹事件;扩共享 openai-client 支持 `tools`/`tool` role/`tool_calls`;新 `mcp-client` 模块用 `@modelcontextprotocol/sdk` 的 Client 调外部 MCP;评分复用 `llm-judge`。前端新 Agent tab 渲染轨迹时间线。

**Tech Stack:** TypeScript(NestJS api / React web / contracts / vitest)、Prisma、`@modelcontextprotocol/sdk@1.29.0`(client 侧净新)、SSE。

**关联 spec:** `docs/superpowers/specs/2026-07-08-agent-playground-design.md`(读它了解决策与理由)。

## Global Constraints

- **McpServer 独立表,不并入 Connection**;`Connection` 逐字不动;现有只认模型的 surface 不受影响。
- **skill = 本地预设**(引用 model Connection + McpServer + inline tools),不是 Connection.kind,不是 Anthropic SKILL.md。
- **工具按"有无后端执行器"分派**:内置=服务端执行;MCP=经 mcp-client 执行、**默认每步人工批准**(`autoRunMcp` 开关免审批);用户手写=无执行器,**结果前端手填回灌**。
- **MCP 传输先只做 HTTP/SSE**(Streamable HTTP);stdio 后续。
- **打分保持轻量单轨迹 judge**(复用 `llm-judge` 的 `getDecrypted()` → 自己 fetch);不重造 τ³ 的 pass^k/path-convergence。
- **加密复用**:McpServer 的 auth token 用 `common/crypto/aes-gcm`(`encrypt/decrypt/decodeKey`)+ 共享 `CONNECTION_API_KEY_ENCRYPTION_KEY`,与 connection 一致。
- **Prisma migration**:`prisma migrate dev --create-only`(纯加表,无数据 DML);seed 不涉及。
- **on-disk 目录名单数**:`apps/api/src/modules/connection/`(不是 connections)。
- **commit 规约**:conventional prefix、显式 `git add <files>`(禁 `-A`)、body 末 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **页面规约**:Playground 页不直接渲染 PageHeader,用 `PlaygroundShell`;列表页遵 `docs/project-standards.md §5` + 镜像 `ConnectionsPage`;i18n 双语。
- **vitest 配置在 apps/api 必须 `.mts`**;apps/api tsconfig 不设 incremental / include 保持 `["src/**/*"]`。

---

## File Structure

**新建(api)**
- `apps/api/prisma/migrations/<ts>_add_mcp_server_and_skill/migration.sql` — 两张表。
- `apps/api/src/modules/mcp-server/{mcp-server.service.ts, mcp-server.controller.ts, mcp-server.module.ts, mcp-server.service.spec.ts}` — 镜像 connection CRUD。
- `apps/api/src/modules/skill/{skill.service.ts, skill.controller.ts, skill.module.ts, skill.service.spec.ts}`。
- `apps/api/src/modules/mcp-client/{mcp-client.service.ts, mcp-client.module.ts, mcp-client.service.spec.ts}` — MCP Client 封装。
- `apps/api/src/modules/playground-agent/{agent.controller.ts, agent-loop.service.ts, builtin-tools.ts, agent-judge.service.ts, playground-agent.module.ts, agent-loop.service.spec.ts, builtin-tools.spec.ts}`。

**新建(contracts)**
- `packages/contracts/src/mcp-server.ts`、`packages/contracts/src/skill.ts`、`packages/contracts/src/agent.ts`(agent 请求/SSE 事件/工具定义/verdict)。

**修改(contracts)**
- `packages/contracts/src/playground.ts` — `ChatMessageSchema` 加 `tool` role + `tool_calls`/`tool_call_id`;`ChatParamsSchema` 加 `tools`/`tool_choice`。
- `packages/contracts/src/index.ts` — 导出新 schema。

**修改(api)**
- `apps/api/src/integrations/openai-client/wires/chat.ts` — `buildPlaygroundChatBody` emit `tools`/`tool_choice`;`parsePlaygroundChatResponse` 读 `message.tool_calls`。
- `apps/api/src/app.module.ts` — 注册 4 个新模块。
- `apps/api/src/config/env.schema.ts` — 无需(复用现有加密 key)。

**新建(web)**
- `apps/web/src/features/playground/agent/{AgentPage.tsx, store.ts, queries.ts, api.ts, trace/*, AgentPage.test.tsx}`。
- `apps/web/src/features/mcp-servers/{McpServersPage.tsx, queries.ts, api.ts, McpServerSheet.tsx}` — 列表页镜像 connections。
- `apps/web/src/features/skills/{SkillsPage.tsx, queries.ts, api.ts, SkillSheet.tsx}`。

**修改(web)**
- `apps/web/src/router/index.tsx` — 加 `playground/agent`、`mcp-servers`、`skills` 路由 + 侧边栏项。
- `apps/web/src/lib/playground-stream.ts` — 复用(agent SSE 事件更丰富,复用同一 fetch-stream 原语)。
- locales `zh-CN`/`en-US`。

---

## PHASE 1 — McpServer 实体(schema + CRUD + 列表页)

### Task 1: McpServer schema + migration + contracts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`(加 `McpServer` model,`User` 关系加一行)
- Create: migration 目录(`--create-only`)
- Create: `packages/contracts/src/mcp-server.ts`;Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/mcp-server.spec.ts`

**Interfaces:**
- Produces:
  - Prisma `McpServer { id, userId, name, description?, transport, url, authTokenCipher?, headers, toolsCache?, toolsCachedAt?, enabled, createdAt, updatedAt }`,`@@unique([userId,name])`,`@@index([userId])`,`@@map("mcp_servers")`,`onDelete: Cascade`。
  - `mcpServerPublicSchema`(不含 authToken,含 `authTokenPreview?`)、`mcpServerWithSecretSchema`、`createMcpServerSchema`、`updateMcpServerSchema`、`McpServerTool`(name/description/inputSchema/annotations)。

- [ ] **Step 1: 失败测试** — `mcp-server.spec.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createMcpServerSchema, mcpServerPublicSchema } from "./mcp-server.js";
describe("mcp-server contracts", () => {
  it("create requires name + url(http)", () => {
    const v = createMcpServerSchema.parse({ name: "gw", url: "https://higress.local/mcp", transport: "http" });
    expect(v.transport).toBe("http");
  });
  it("rejects non-url", () => {
    expect(() => createMcpServerSchema.parse({ name: "x", url: "not a url" })).toThrow();
  });
  it("public shape omits authToken", () => {
    const p = mcpServerPublicSchema.parse({ id: "m1", name: "gw", url: "https://h/mcp", transport: "http", headers: "", enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect("authTokenCipher" in p).toBe(false);
  });
});
```
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/contracts exec vitest run src/mcp-server.spec.ts` → FAIL(模块缺失)。
- [ ] **Step 3: 实现 contracts** — `mcp-server.ts`(镜像 `connection.ts` 的 public/withSecret/create/update 分层;`transport: z.enum(["http"]).default("http")`;`url: z.string().url()`;`headers: z.string().default("")`;`authToken: z.string().optional()`;public 加 `authTokenPreview: z.string().optional()`;`toolsCache: z.array(mcpServerToolSchema).optional()`)。`index.ts` 加 `export * from "./mcp-server.js"`。
- [ ] **Step 4: 实现 Prisma** — schema.prisma 加 model(见 Interfaces);`User` model 加 `mcpServers McpServer[]`。scaffold migration:`pnpm -F @modeldoctor/api exec prisma migrate dev --create-only --name add_mcp_server`(只生成不应用;若共享 DB drift 报错则 STOP 上报,勿强跑)。手写/确认 `migration.sql` 为纯 `CREATE TABLE mcp_servers ...`。
- [ ] **Step 5: Run** contracts 测试 → PASS;`pnpm -F @modeldoctor/contracts build` clean;`pnpm -F @modeldoctor/api exec prisma generate` 生成含 McpServer 的 client。
- [ ] **Step 6: Commit**
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/contracts/src/mcp-server.ts packages/contracts/src/mcp-server.spec.ts packages/contracts/src/index.ts
git commit -m "feat(api): McpServer schema + contracts (separate from Connection)"
```

### Task 2: McpServer service + controller + module

**Files:**
- Create: `apps/api/src/modules/mcp-server/{mcp-server.service.ts, mcp-server.controller.ts, mcp-server.module.ts, mcp-server.service.spec.ts}`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `McpServer` Prisma model + contracts(Task 1)、`aes-gcm`(`encrypt/decrypt/decodeKey`)、`CONNECTION_API_KEY_ENCRYPTION_KEY`。
- Produces:
  - `McpServerService`:`create(userId, input)`、`list(userId)`、`findOwnedPublic(userId,id)`、`update(userId,id,input)`、`delete(userId,id)`、`getOwnedDecrypted(userId,id): Promise<{...url,headers,authToken}>`(内部,解密 authToken;`findOwnedRow` 做归属校验 mirror connection)、`cacheTools(userId,id, tools)`(存 toolsCache/toolsCachedAt)。
  - `McpServerModule` `exports: [McpServerService]`。

- [ ] **Step 1: 失败测试** — `mcp-server.service.spec.ts`:mock PrismaService + ConfigService(给一个 32-byte base64 key)。断言:`create` 用 `encrypt` 存 `authTokenCipher`、返回 public 不含明文;`getOwnedDecrypted` 用 `decrypt` 还原 authToken;`findOwnedRow` 对他人 id 抛 Forbidden;`update` 仅在传 authToken 时重新加密。(镜像现有 `connection.service.spec.ts` 的 mock 风格 —— 先读它。)
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/api exec vitest run src/modules/mcp-server` → FAIL。
- [ ] **Step 3: 实现** — service 逐样照抄 `connection.service.ts` 的加密/归属/CRUD 骨架,把 `apiKey`→`authToken`、去掉 model/serverKind/prometheus 等模型专属字段、加 `headers`/`toolsCache`。controller 照抄 `connection.controller.ts` 装饰器(`@Controller("mcp-servers")` + `@UseGuards(JwtAuthGuard)` + `@CurrentUser()` + `ZodValidationPipe`),路由:`@Post()`/`@Get()`/`@Get(":id")`/`@Patch(":id")`/`@Delete(":id")`(NO_CONTENT)。module `providers:[PrismaService, McpServerService]` `exports:[McpServerService]`。`app.module.ts` imports 加 `McpServerModule`。
- [ ] **Step 4: Run** service 测试 → PASS;`pnpm -F @modeldoctor/api build`(nest;需先 `pnpm -r build` 让 contracts dist 有新 schema)→ clean。
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/mcp-server apps/api/src/app.module.ts
git commit -m "feat(api): McpServer CRUD service + controller (mirrors connection)"
```

### Task 3: McpServer web 列表页 + queries

**Files:**
- Create: `apps/web/src/features/mcp-servers/{McpServersPage.tsx, queries.ts, api.ts, McpServerSheet.tsx}`
- Modify: `apps/web/src/router/index.tsx`(路由 + 侧边栏)、locales
- Test: `apps/web/src/features/mcp-servers/McpServersPage.test.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/mcp-servers`(Task 2)。
- Produces: `useMcpServers()`/`useCreateMcpServer()`/… React-Query hooks(镜像 `connections/queries.ts`);`McpServersPage` 列表 + `McpServerSheet` 建/改。

- [ ] **Step 1: 失败测试** — render `McpServersPage`,mock `useMcpServers` 返回一条 → 断言表格显示 name + url + 建按钮;点删走 AlertDialog。镜像现有 `ConnectionsPage` 测试。
- [ ] **Step 2: Run** `pnpm -F @modeldoctor/web exec vitest run src/features/mcp-servers` → FAIL。
- [ ] **Step 3: 实现** — `api.ts`(`mcpServerApi` mirror connection api)、`queries.ts`(KEY=["mcp-servers"],hooks)、`McpServersPage.tsx`(镜像 `ConnectionsPage`:PageHeader + 表格 + 编辑 icon + DropdownMenu(Delete under AlertDialog))、`McpServerSheet.tsx`(shadcn Sheet,字段 name/url/authToken/headers,遵表单规约)。router 加 `{ path: "mcp-servers", element: <McpServersPage/> }` + 侧边栏项 + i18n。
- [ ] **Step 4: Run** 测试 → PASS;`pnpm -F @modeldoctor/web exec tsc --noEmit` → 0;`pnpm -F @modeldoctor/web build` clean。
- [ ] **Step 5: Commit**
```bash
git add apps/web/src/features/mcp-servers apps/web/src/router/index.tsx apps/web/src/locales
git commit -m "feat(web): MCP servers list page + CRUD"
```

---

## PHASE 2 — Skill 实体(schema + CRUD + 列表页)

### Task 4: Skill schema + migration + contracts + service/controller/module

**Files:**
- Modify: `apps/api/prisma/schema.prisma`(加 `Skill`)+ migration;Create: `packages/contracts/src/skill.ts` + index 导出;Create: `apps/api/src/modules/skill/{skill.service.ts, skill.controller.ts, skill.module.ts, skill.service.spec.ts}`;Modify: `app.module.ts`
- Test: `packages/contracts/src/skill.spec.ts` + `skill.service.spec.ts`

**Interfaces:**
- Produces:
  - Prisma `Skill { id, userId, name, description?, systemPrompt?, modelConnectionId?, mcpServerIds String[], inlineTools Json?, planFirst Boolean, maxSteps Int, createdAt, updatedAt }` `@@unique([userId,name])` `@@map("skills")` Cascade。
  - `skillSchema`/`createSkillSchema`/`updateSkillSchema`(`inlineTools: z.array(toolDefSchema).optional()`,`mcpServerIds: z.array(z.string()).default([])`,`maxSteps: z.number().int().min(1).max(50).default(12)`)。
  - `SkillService` CRUD(无加密 —— skill 无 secret)+ `SkillModule exports:[SkillService]`。

- [ ] **Step 1: 失败测试** — contracts spec(create 校验 + maxSteps 边界);service spec(CRUD + 归属)。
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 实现** — Prisma model + `--create-only` migration;contracts;service/controller(`@Controller("skills")`,同装饰器)/module;`app.module.ts` 加 `SkillModule`。`toolDefSchema` 放 `packages/contracts/src/agent.ts`(Task 5 会建;此处先在 skill.ts 内联定义或提前建 agent.ts 的 toolDefSchema 部分)。
- [ ] **Step 4: Run** → PASS;`pnpm -r build` + `pnpm -F @modeldoctor/api build` clean;`prisma generate`。
- [ ] **Step 5: Commit**
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/contracts/src/skill.ts packages/contracts/src/agent.ts packages/contracts/src/index.ts apps/api/src/modules/skill apps/api/src/app.module.ts packages/contracts/src/skill.spec.ts
git commit -m "feat(api): Skill schema + CRUD (local preset referencing connection/mcp)"
```

### Task 5: Skill web 列表页

**Files:** `apps/web/src/features/skills/{SkillsPage.tsx, queries.ts, api.ts, SkillSheet.tsx}` + router + locales + test。

- [ ] 同 Task 3 结构(mirror ConnectionsPage)。SkillSheet 字段:name/systemPrompt/planFirst/maxSteps(工具/MCP 引用的编辑放 Agent playground 里"存为 skill",这里只做基本 CRUD + 展示引用)。测试 render + create;`tsc --noEmit` 0;build clean。Commit `feat(web): skills list page + CRUD`。

---

## PHASE 3 — openai-client 扩展(tool-calling 线路)

### Task 6: contracts + wire 支持 tools / tool role / tool_calls

**Files:**
- Modify: `packages/contracts/src/playground.ts`;Create: `packages/contracts/src/agent.ts`(补全)
- Modify: `apps/api/src/integrations/openai-client/wires/chat.ts`
- Test: `packages/contracts/src/playground.spec.ts`(追加)+ `apps/api/src/integrations/openai-client/wires/chat.spec.ts`(新/追加)

**Interfaces:**
- Produces:
  - `ChatMessageSchema` role 扩到 `["user","assistant","system","tool"]`,加可选 `tool_calls: ToolCall[]`(assistant)+ `tool_call_id: string`(tool)。`ToolCallSchema = { id, type:"function", function:{ name, arguments:string } }`。
  - `ToolDefSchema = { type:"function", function:{ name, description?, parameters:Record<string,unknown> } }`(agent.ts)。
  - `ChatParamsSchema` 加 `tools?: ToolDef[]`、`tool_choice?: "auto"|"none"|"required"|{...}`。
  - `buildPlaygroundChatBody`:当 `params.tools` 存在 emit `body.tools` + `body.tool_choice`。`parsePlaygroundChatResponse` 读 `choices[0].message.tool_calls`。

- [ ] **Step 1: 失败测试**:
```ts
// wires/chat.spec.ts
it("emits tools + tool_choice when present", () => {
  const body = buildPlaygroundChatBody({ model:"m", messages:[{role:"user",content:"hi"}],
    params:{ tools:[{type:"function",function:{name:"t",parameters:{}}}], tool_choice:"auto" } });
  expect(body.tools).toBeDefined(); expect(body.tool_choice).toBe("auto");
});
it("omits tools when absent (unchanged for plain chat)", () => {
  expect(buildPlaygroundChatBody({ model:"m", messages:[], params:{} }).tools).toBeUndefined();
});
```
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 实现** contracts 扩展 + wire 两行 `if (params.tools) { body.tools = params.tools; if (params.tool_choice) body.tool_choice = params.tool_choice; }`;`parsePlaygroundChatResponse` 加 `tool_calls: j.choices?.[0]?.message?.tool_calls`。
- [ ] **Step 4: Run** → PASS;`pnpm -r build` clean(确认现有 playground/chat 不回归 —— tools 缺省即旧行为)。
- [ ] **Step 5: Commit** `feat(contracts,api): tool-calling in playground chat wire (tool role, tools, tool_calls)`

---

## PHASE 4 — Agent 循环后端

### Task 7: 内置工具 + 工具执行分派

**Files:** Create `apps/api/src/modules/playground-agent/builtin-tools.ts` + `builtin-tools.spec.ts`。

**Interfaces:**
- Produces:
  - `BUILTIN_TOOLS: Record<string, { def: ToolDef; run: (args) => Promise<string> }>` —— `get_current_time`(无参,返回 ISO)、`calculator`(`{expression}` 安全求值,拒绝非数字/运算符)、`http_get`(`{url}`,**白名单 + 5s 超时 + 只读**,防 SSRF)。
  - `executeBuiltin(name, args): Promise<string>`。

- [ ] **Step 1: 失败测试**:`calculator({expression:"2+3*4"})→"14"`;`get_current_time` 返回可解析 ISO;`http_get` 对非白名单/私网地址抛错;未知工具抛错。
- [ ] **Step 2-4: 实现 + 绿。** calculator 用受限解析(只允许 `0-9 + - * / ( ) . 空格`,`Function` 前正则校验或用小型 shunting-yard);http_get 用 `fetch` + `AbortSignal.timeout(5000)` + host 白名单(env 或硬编码 example 白名单)+ 拒绝私网 IP。
- [ ] **Step 5: Commit** `feat(api): agent built-in tools (time/calculator/http_get with SSRF guard)`

### Task 8: AgentLoopService + /api/playground/agent SSE 端点

**Files:** Create `apps/api/src/modules/playground-agent/{agent-loop.service.ts, agent.controller.ts, playground-agent.module.ts, agent-loop.service.spec.ts}`;Modify `app.module.ts`。

**Interfaces:**
- Consumes: `ConnectionService.getOwnedDecrypted`、扩展后的 `buildPlaygroundChatBody`/`buildUrl`/`buildHeaders`、`executeBuiltin`(Task 7)。**MCP 执行 Task 11 接;此任务 MCP 工具走"待批准/暂不可用"占位,先只做内置 + 手写工具路径。**
- Produces:
  - `AgentLoopService.run(conn, req, emit: (event) => void): Promise<void>` —— 组 messages/tools、循环调模型(非流式逐轮,先不做 token 流式,简化;每轮完整 message 再 emit)、分派工具、回灌、直到无 tool_calls 或 maxSteps。
  - SSE 事件类型(`agent.ts` `AgentSseEvent`):`{type:"step", step:{kind:"plan"|"tool_call"|"tool_result"|"assistant"|"error", ...payload, tMs}}`、`{type:"tool_result_needed", toolCallId, name, args}`(手写工具)、`{type:"done"}`。
  - `POST /api/playground/agent`(`@Res({passthrough:false})` + 手动 SSE headers,mirror ChatController)—— 解析 body、`getOwnedDecrypted`、`res.write("data: "+JSON.stringify(event)+"\n\n")` 逐事件;客户端 `res.on("close")` → abort。
  - 手写工具:emit `tool_result_needed`,循环**暂停等待**该 tool 的结果 —— V1 简化:**手写工具走"单请求-响应对"模型**,即前端把手填结果作为**新一轮** `POST /api/playground/agent` 的续传(带已有 messages + 该 tool 结果)。即循环在遇到无执行器工具时 emit 事件并 `done`,前端补结果后再发起续跑。(避免服务端长挂等待用户输入。)

> 设计注记:手写工具的"手填结果"用**多次请求续跑**(前端维护 messages,附上 tool 结果再发)实现,而非服务端阻塞等待 —— SSE 请求短、无状态,契合现有架构。内置/MCP 工具在**同一请求内**自动执行、连续多轮。

- [ ] **Step 1: 失败测试**(agent-loop.service.spec.ts):mock 一个"模型 fetch"(注入 fetcher)先返回一个 `tool_calls:[get_current_time]`,再返回纯 assistant 文本 → 断言:执行了内置工具、把 tool 结果作为 `{role:"tool"}` 回灌、第二轮产出 assistant、emit 了 plan/tool_call/tool_result/assistant/done 事件序列;撞 `maxSteps` 时收尾。遇到手写工具(无执行器)→ emit `tool_result_needed` + `done`。
- [ ] **Step 2-4: 实现 + 绿。** 把 upstream fetch 抽成可注入依赖便于测。
- [ ] **Step 5: Commit** `feat(api): AgentLoopService + /api/playground/agent SSE (builtin + inline tools)`

---

## PHASE 5 — 前端 Agent tab + 轨迹时间线

### Task 9: Agent playground 页 + store + 轨迹渲染

**Files:** Create `apps/web/src/features/playground/agent/{AgentPage.tsx, store.ts, api.ts, trace/TraceTimeline.tsx, trace/StepCard.tsx, AgentPage.test.tsx}`;Modify router + locales。

**Interfaces:**
- Consumes: `POST /api/playground/agent`(SSE,复用 `playgroundFetchStream`)、`useMcpServers`/`useSkills`(展示/选择)、`CategoryEndpointSelector`。
- Produces: Agent tab 在 `/playground/agent`;store 持 `task/systemPrompt/planFirst/maxSteps/inlineTools/selectedMcpServerIds/autoRunMcp/steps[]/running`;`onRun` 发 SSE、按 `AgentSseEvent` 往 `steps` 追加;`TraceTimeline` 竖排 `StepCard`(plan/tool_call/tool_result/assistant),手写工具卡渲染结果输入框 → 提交触发续跑。

- [ ] **Step 1: 失败测试**:mock SSE 流(注入假 `playgroundFetchStream`)推 plan→tool_call→tool_result→assistant→done → 断言 4 张卡按序渲染;完成后 running=false。
- [ ] **Step 2-4: 实现 + 绿。** 用 `PlaygroundShell`(paramsSlot=配置区:任务框/planFirst/maxSteps/内置工具勾选/手写工具编辑/McpServer 多选/autoRunMcp/skill 下拉;children=TraceTimeline)。store 镜像 chat/store。SSE 解析:`onSseEvent(data)` → `JSON.parse` → dispatch 到 store。
- [ ] **Step 5: Commit** `feat(web): Agent playground tab with live tool-call trace timeline`

---

## PHASE 6 — MCP client 接入

### Task 10: mcp-client 模块(发现 + 调用)

**Files:** Create `apps/api/src/modules/mcp-client/{mcp-client.service.ts, mcp-client.module.ts, mcp-client.service.spec.ts}`。

**⚠️ 实现前置:确认 SDK client 导入路径。** worktree 装好依赖后(执行期会 `pnpm install`),先跑 `ls node_modules/@modelcontextprotocol/sdk/dist/esm/client/` 确认 `index.js` + `streamableHttp.js` 存在(SDK 1.29.0)。若路径不同,按实际改;**别硬信本 plan 的路径**(server 侧用的是 `server/mcp.js`/`server/streamableHttp.js`,client 侧对称但需实测)。

**Interfaces:**
- Consumes: `McpServerService.getOwnedDecrypted`(url + headers + authToken)。
- Produces:
  - `McpClientService.discoverTools(server): Promise<McpServerTool[]>` —— `new Client({name,version})` + `new StreamableHTTPClientTransport(new URL(url), { requestInit:{ headers } })` + `connect` + `listTools()` → 归一化 name/description/inputSchema/annotations;`close`。
  - `McpClientService.callTool(server, name, args): Promise<string>` —— `callTool({name, arguments})` → 归一化 content(text parts 拼接 / JSON.stringify)。短生命周期(每次建/拆连接)。
  - `McpClientModule exports:[McpClientService]`。

- [ ] **Step 1: 失败测试**:mock SDK `Client`(注入工厂),`discoverTools` 归一化 listTools 返回;`callTool` 拼接 text content;鉴权 header 透传;连接结束 close。
- [ ] **Step 2-4: 实现 + 绿。** 把 `Client`/transport 构造抽成可注入工厂便于 mock。
- [ ] **Step 5: Commit** `feat(api): MCP client service (discover + call external MCP tools over HTTP)`

### Task 11: 循环接 MCP + 审批门控 + McpServer 详情"发现工具"

**Files:** Modify `agent-loop.service.ts`(注入 `McpClientService` + `McpServerService`)、`playground-agent.module.ts`(imports McpClientModule/McpServerModule);Modify `mcp-server.controller.ts`(加 `@Post(":id/discover")` → `McpClientService.discoverTools` + `cacheTools`);前端 Task 9 的 StepCard 加 MCP 审批按钮 + McpServersPage 加"发现工具"。

**Interfaces:**
- Produces:
  - 循环里工具分派:name 前缀 `mcp__<serverId>__<tool>` → 路由到 `McpClientService.callTool`。默认 emit `{type:"tool_approval", toolCallId, server, name, args}` 并**在同请求内等待前端 approve**(SSE 双向不便 → V1 用与手写工具相同的"续跑"模型:emit approval-needed + done,前端 approve 后带决定续传);`autoRunMcp=true` 时跳过审批直接执行、同请求连续多轮。
  - `POST /api/mcp-servers/:id/discover` → 返回工具清单 + 更新缓存。

- [ ] **Step 1: 失败测试**:agent-loop mock McpClientService,`autoRunMcp=true` → MCP 工具被 callTool 执行 + 结果回灌;`autoRunMcp=false` → emit tool_approval + done(不执行)。mcp-server controller e2e/单测:discover 调 client + 写缓存。
- [ ] **Step 2-4: 实现 + 绿 + `pnpm -r build`。**
- [ ] **Step 5: Commit** `feat(api,web): wire MCP tools into agent loop with approval gating + discover`

---

## PHASE 7 — Skill 应用/存为

### Task 12: Agent playground 接 Skill(应用 + 存为)+ McpServer 多选

**Files:** Modify `apps/web/src/features/playground/agent/*`(skill 下拉:应用=把 skill 的 systemPrompt/mcpServerIds/inlineTools/planFirst/maxSteps 灌进 store;"存为 skill"=用当前 store 配置 `POST /api/skills`);Modify `skill.service.ts` 若需按引用校验。

- [ ] **Step 1: 失败测试**:选一个 skill → store 被灌满对应字段;点"存为" → 以当前配置调 createSkill。
- [ ] **Step 2-5: 实现 + 绿 + commit** `feat(web): apply/save skill presets in agent playground`

---

## PHASE 8 — 轻量轨迹评分

### Task 13: AgentJudgeService + verdict 卡

**Files:** Create `apps/api/src/modules/playground-agent/agent-judge.service.ts` + spec;Modify `agent-loop.service.ts`(收尾触发)+ `playground-agent.module.ts`(imports LlmJudgeModule);前端 StepCard/TraceTimeline 加 verdict 卡。

**Interfaces:**
- Consumes: `LlmJudgeService.getDecrypted()`(默认 provider)→ 自己 fetch(无内置 completion helper)。
- Produces: `AgentJudgeService.judge(trajectory): Promise<{ taskCompleted:boolean, toolUseCorrect:boolean, extraSteps:number, oneLineVerdict:string }>` —— 组一个 judge prompt(把 task + 轨迹步骤摘要喂进去),严格 JSON 返回;失败降级为 null(不阻塞)。循环 `done` 前 emit `{type:"verdict", ...}`。

- [ ] **Step 1: 失败测试**:mock getDecrypted 返回一个 provider + mock fetch 返回 judge JSON → 断言解析出 verdict 结构;judge 失败(非 JSON)→ 返回 null 不抛。
- [ ] **Step 2-5: 实现 + 绿 + commit** `feat(api,web): lightweight trajectory judge verdict card`

### Task 14: 手动端到端冒烟(验证)

**Files:** none。用 verify skill。前置:真实支持 tool-calling 的模型 Connection + 一个真 MCP server(或本仓库 `/api/mcp` 自带 server,配一个 mcp-server 指向它 + bearer)。

- [ ] 选模型 → 建一个 mcp-server(指向 Higress/HiMarket 或自带 `/api/mcp`)→ discover 工具 → Agent tab 给带工具任务 → 看轨迹(内置自动执行 / MCP 审批 / 手写手填)→ 看引擎指标 → 看 verdict 卡。回归:普通 chat playground 不受影响。记录结果,不 commit。

---

## Self-Review

**1. Spec coverage:** §3 数据模型→T1/T4;§4.1 循环→T8;§4.2 工具分派→T7(内置)+T8(手写)+T11(MCP);§4.3 wire 扩展→T6;§4.4 MCP client→T10/T11;§4.5 judge→T13;§4.6 前端→T9(+T12 skill,+T11 审批,+T13 verdict);§5 安全→T7(SSRF)+T11(审批)+T1/T2(加密);§6 分阶段=8 phase;§8 不做项无对应任务(正确)。McpServer/Skill 列表页→T3/T5。**无缺口。**

**2. Placeholder scan:** 无 TBD。T10 的"实测 SDK 路径"、T1/T4 的"drift 报错则 STOP"是对具名对象的核对/护栏指令,非占位。

**3. Type consistency:** `ToolDef`/`ToolCall`/`AgentSseEvent` 在 agent.ts 定义(T5/T6),T8/T9/T11/T13 一致消费;`McpServerService.getOwnedDecrypted` 形状(url/headers/authToken)T2 产出、T10/T11 消费一致;工具名前缀 `mcp__<serverId>__<tool>` 在 T8(分派)↔T11(路由)一致;SSE 事件 `type` 值(step/tool_result_needed/tool_approval/verdict/done)T8↔T9↔T11↔T13 一致;`buildPlaygroundChatBody` 的 `tools`/`tool_choice`(T6)↔ 循环调用(T8)一致。

**关键设计注记(闭环):** 手写工具的"手填结果"与 MCP 的"审批"都用**多请求续跑**模型(前端维护 messages/决定,附上再发),而非服务端阻塞等待用户输入 —— 契合现有短 SSE 请求、无状态架构;内置 + 已批准的 MCP 工具在**同一请求内**连续自动多轮。这是全案最容易做错的地方,已在 T8/T11 明确。
