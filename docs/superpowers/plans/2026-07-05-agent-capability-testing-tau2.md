# Agent 能力测试(τ²-bench 集成)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ModelDoctor 里以「新 `agent` 场景 + 新 `tau2` 工具」接入 benchmark-runner,对已注册 Connection 跑 τ²-bench 多轮工具调用评测,产出故事化报告(完成率/pass^k + 对话回放 + 失败归因)+ 可配门禁。

**Architecture:** 复用现有 benchmark 执行链路(K8s Job → MinIO)。每 domain 一次 `tau2 run`,结果 `results.json` 落 MinIO;tau2 镜像内的 Python 脚本用 tau2 自带 `compute_metrics` 算指标 + 确定性失败归因 → 写 `summary.json`;TS 侧 `parseFinalReport` 只读 `summary.json` + 依 `params.gate` 算门禁。复用 `Benchmark` 表(`scenario='agent'`),零新表、零 Prisma migration。

**Tech Stack:** TypeScript(pnpm workspace:tool-adapters / contracts / api / web)、Zod、Prisma(仅 seed)、NestJS、React + React Query + shadcn、Vitest;Python 3.12(tau2 镜像 + benchmark-runner,uv/ruff/pytest)。

**关联 spec:** `docs/superpowers/specs/2026-07-05-agent-capability-testing-tau2-design.md`(读它了解决策与理由)。

## Global Constraints

- **tool-adapter 接口冻结**:`packages/tool-adapters/src/core/interface.ts` 的 `ToolAdapter` 不改结构;新增工具 = 新文件夹 + 在 `registry.ts` 注册。允许的机械扩展:`ToolName` union、`ToolReport` union、`BuildCommandPlan` 增可选字段(需在 changelog 记一笔,像 `tokenizerHfId` 那样)。
- **Python 版本**:tau2 需 `>=3.12,<3.14`。tau2 镜像基于 **3.12**;现有其他 runner 镜像(3.11)不动。benchmark-runner 的 pytest 若要 import tau2,dev 环境需 3.12。
- **密钥只走 secretEnv,绝不进持久化 argv**:被测 endpoint key + user-sim provider key 通过 `secretEnv` 注入,argv 里用哨兵占位(见 Task 4 的通用哨兵)。
- **官方模板经 seed.ts**:三档模板追加到 `apps/api/prisma/seed.ts` 的 `BENCHMARK_TEMPLATES`,每行经 `tau2ParamsSchema` 校验后 `upsert`;schema-picker 加 `tau2` 分支。**不在 migration 写 INSERT**。
- **零 Prisma migration**:复用 `Benchmark`(`scenario`/`tool` 是 String 列)。本计划不新增列。
- **commit 规约**:conventional prefix、`git add <files>`(禁 `-A`)、一逻辑一 commit、body 末 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- **页面规约**:所有路由页首行 `PageHeader`;detail/create 带 breadcrumbs;图表走 dataviz skill 的配色系统(见 `docs/project-standards.md`)。
- **tau2 结果 schema(已从源码落实,勿再猜)**:`Results{info, tasks, simulations[]}`;`SimulationRun{id, task_id, trial, termination_reason, reward_info}`;`RewardInfo{reward(float,1.0=pass 判定用 tau2 的 is_successful:|reward-1|<=1e-6), db_check{db_match}, action_checks[]{action_match, tool_type(read/write)}, communicate_checks[]{met}}`;`TerminationReason ∈ {user_stop, agent_stop, max_steps, timeout, too_many_errors, agent_error, user_error, infrastructure_error, context_window_exceeded, unexpected_error}`。text run 默认写 `data/simulations/<save_to>/results.json`(monolithic JSON)。
- **tau2 CLI(已核实)**:`tau2 run --domain <d> --num-trials K --num-tasks N --agent-llm <m> --agent-llm-args '<json>' --user-llm <m> --user-llm-args '<json>' --save-to <name> --max-concurrency M --auto-resume`。`--*-llm-args` 是 `json.loads` dict,透传 LiteLLM → 放 `{"api_base","api_key","temperature"}`;model 名用 `openai/<model>` 前缀走 LiteLLM openai-compatible。

---

## File Structure

**新建**
- `packages/tool-adapters/src/tau2/schema.ts` — `tau2ParamsSchema` / `tau2ReportSchema` / `tau2ParamDefaults` + 类型。
- `packages/tool-adapters/src/tau2/build-command.ts` — `buildCommand` + `getMaxDurationSeconds` + `parseProgress`。
- `packages/tool-adapters/src/tau2/gate.ts` — 纯函数 `computeGate(summary, gateParams, baseline)`。
- `packages/tool-adapters/src/tau2/runtime.ts` — 组装 `tau2Adapter`(实现 `ToolAdapter`)+ `tau2ReadMetric`(恒 null)+ `parseFinalReport`。
- `packages/tool-adapters/src/tau2/index.ts` — re-export。
- `packages/tool-adapters/src/tau2/*.spec.ts` — 单测。
- `apps/benchmark-runner/tau2/md_tau2_summarize.py` — 摘要脚本(shipped 进 tau2 镜像)。
- `apps/benchmark-runner/tau2/summarize_lib.py` — 纯函数(`bucket_failure` / `aggregate_overall` / `build_summary`)供测试。
- `apps/benchmark-runner/tests/test_tau2_summarize.py` — pytest。
- `apps/benchmark-runner/images/tau2.Dockerfile` — 镜像。
- `apps/web/src/features/benchmarks/reports/AgentReport.tsx` — 报告容器。
- `apps/web/src/features/benchmarks/reports/agent/{CompletionBars,ConversationReplay,FailureAttribution}.tsx` — 三块。
- `apps/web/src/features/benchmarks/reports/agent/queries.ts` — 拉 trajectory 的 React Query hook。
- `apps/web/src/features/benchmarks/reports/agent/*.test.tsx` — 组件测。

**修改**
- `packages/contracts/src/benchmark.ts` — `benchmarkToolSchema` 加 `"tau2"`;`scenarioIdSchema` 加 `"agent"`。
- `packages/tool-adapters/src/scenarios.ts` — `ScenarioId`/`scenarioIdSchema` 加 `"agent"`;`SCENARIOS.agent`;`reportComponent` union 加 `"AgentReport"`。
- `packages/tool-adapters/src/core/interface.ts` — `ToolName` 加 `"tau2"`;`ToolReport` 加 `tau2` 分支;`BuildCommandPlan` 加可选 `userSimulator`。
- `packages/tool-adapters/src/core/registry.ts` — 注册 `tau2Adapter`。
- `packages/tool-adapters/src/index.ts` + `schemas-entry.ts` — 导出 tau2 schema/adapter。
- `apps/benchmark-runner/runner/main.py` — 通用命名哨兵 `__MD_SECRET_<NAME>__`。
- `apps/api/src/modules/benchmark/k8s/runner-images.ts` — `imageForTool('tau2')`。
- `apps/api/src/modules/benchmark/benchmark.service.ts` — agent 场景:解析 default `LlmJudgeProvider` 为 user-sim,注入 `plan.userSimulator`。
- `apps/api/prisma/seed.ts` — 三档模板 + schema-picker `tau2` 分支。
- `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` — `scenario='agent'` → `<AgentReport>`。
- `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx` — agent 场景表单。
- 侧边栏/路由 — agent 场景列表页入口(沿用现有 scenario 列表 shell)。

---

## Task 1: 场景 / 工具枚举打通

**Files:**
- Modify: `packages/contracts/src/benchmark.ts:16` (`benchmarkToolSchema`), scenario enum
- Modify: `packages/tool-adapters/src/scenarios.ts` (`ScenarioId`, `scenarioIdSchema`, `SCENARIOS`, `reportComponent` union)
- Modify: `packages/tool-adapters/src/core/interface.ts` (`ToolName`)
- Test: `packages/tool-adapters/src/scenarios.spec.ts` (existing — extend)

**Interfaces:**
- Produces: `ScenarioId` now includes `"agent"`; `SCENARIOS.agent.reportComponent === "AgentReport"`; `SCENARIOS.agent.tools === ["tau2"]`; `ToolName` includes `"tau2"`.

- [ ] **Step 1: Write the failing test** — append to `scenarios.spec.ts`:

```ts
it("registers the agent scenario bound to tau2 with AgentReport", () => {
  expect(SCENARIOS.agent).toBeDefined();
  expect(SCENARIOS.agent.tools).toEqual(["tau2"]);
  expect(SCENARIOS.agent.reportComponent).toBe("AgentReport");
});
it("scenarioIdSchema accepts agent", () => {
  expect(scenarioIdSchema.parse("agent")).toBe("agent");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @modeldoctor/tool-adapters test -- scenarios`
Expected: FAIL (`SCENARIOS.agent` undefined / enum rejects "agent").

- [ ] **Step 3: Implement**

In `packages/contracts/src/benchmark.ts`:
```ts
export const benchmarkToolSchema = z.enum(["guidellm", "vegeta", "evalscope", "aiperf", "tau2"]);
```
Add `"agent"` to the contracts `scenarioIdSchema` enum in the same file (mirror the existing enum values).

In `packages/tool-adapters/src/core/interface.ts`:
```ts
export type ToolName = "guidellm" | "vegeta" | "evalscope" | "aiperf" | "tau2";
```

In `packages/tool-adapters/src/scenarios.ts` — extend the type/enum and add the entry:
```ts
export type ScenarioId = "inference" | "capacity" | "gateway" | "lb-strategy" | "engine-kv-cache" | "agent";

export const scenarioIdSchema = z.enum([
  "inference", "capacity", "gateway", "lb-strategy", "engine-kv-cache", "agent",
]);

// in ScenarioConfig.reportComponent union add:  | "AgentReport"

// in SCENARIOS add:
agent: {
  label: "Agent 能力评测",
  description: "τ²-bench 多轮工具调用:航空/零售/电信客服场景,测 agent 守政策 + 正确调用领域工具的能力(完成率 / pass^k)。",
  tools: ["tau2"],
  paramsConstraints: {},
  reportComponent: "AgentReport",
},
```

- [ ] **Step 4: Run test** — `pnpm -F @modeldoctor/tool-adapters test -- scenarios` → PASS. (`assertScenariosInvariant` will fail at import until Task 3 registers the adapter; if the spec calls it, skip that assertion until Task 3 or land Task 1+2+3 together. Prefer: keep Task 1 test narrow to the two `it()` above, which don't call the invariant.)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/benchmark.ts packages/tool-adapters/src/scenarios.ts packages/tool-adapters/src/core/interface.ts packages/tool-adapters/src/scenarios.spec.ts
git commit -m "feat(tool-adapters): register agent scenario + tau2 tool enums"
```

---

## Task 2: tau2 params / report schema

**Files:**
- Create: `packages/tool-adapters/src/tau2/schema.ts`
- Test: `packages/tool-adapters/src/tau2/schema.spec.ts`

**Interfaces:**
- Produces:
  - `tau2DomainSchema = z.enum(["airline","retail","telecom"])`
  - `tau2ParamsSchema` → `Tau2Params`
  - `tau2ReportSchema` → `Tau2Report`(= `summary.json` 形状)
  - `tau2ParamDefaults: Tau2Params`

- [ ] **Step 1: Write the failing test** — `schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tau2ParamsSchema, tau2ReportSchema, tau2ParamDefaults } from "./schema.js";

describe("tau2ParamsSchema", () => {
  it("accepts a standard config", () => {
    const p = tau2ParamsSchema.parse({
      domains: ["airline", "retail", "telecom"],
      numTasksPerDomain: 20, numTrials: 3, gate: { mode: "off" },
    });
    expect(p.numTrials).toBe(3);
  });
  it("accepts numTasksPerDomain null (full set)", () => {
    expect(tau2ParamsSchema.parse({ ...tau2ParamDefaults, numTasksPerDomain: null }).numTasksPerDomain).toBeNull();
  });
  it("rejects empty domains", () => {
    expect(() => tau2ParamsSchema.parse({ ...tau2ParamDefaults, domains: [] })).toThrow();
  });
  it("rejects numTrials > 8", () => {
    expect(() => tau2ParamsSchema.parse({ ...tau2ParamDefaults, numTrials: 9 })).toThrow();
  });
  it("perDomainFloor gate parses", () => {
    const p = tau2ParamsSchema.parse({ ...tau2ParamDefaults,
      gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } } });
    expect(p.gate.mode).toBe("perDomainFloor");
  });
});
describe("tau2ReportSchema", () => {
  it("parses a summary.json shape", () => {
    const r = tau2ReportSchema.parse({
      kind: "agent-tau2", userSimModel: "deepseek-v3", numTrials: 3,
      overall: { pass1: 0.4, passK: 0.3, tasks: 60 },
      perDomain: { airline: { pass1: 0.38, passK: 0.3, tasks: 20 } },
      attribution: { wrong_action: 0.5, other: 0.5 },
      highlights: { successSimId: "s1", successDomain: "airline", failureSimId: "s2", failureDomain: "retail" },
    });
    expect(r.overall.tasks).toBe(60);
  });
});
```

- [ ] **Step 2: Run** — `pnpm -F @modeldoctor/tool-adapters test -- tau2/schema` → FAIL (module missing).

- [ ] **Step 3: Implement** `schema.ts`:

```ts
import { z } from "zod";

export const tau2DomainSchema = z.enum(["airline", "retail", "telecom"]);
export type Tau2Domain = z.infer<typeof tau2DomainSchema>;

export const tau2GateSchema = z.object({
  mode: z.enum(["off", "perDomainFloor", "baselineRegression"]).default("off"),
  perDomainFloor: z.record(tau2DomainSchema, z.number().min(0).max(1)).optional(),
  baselineRegressionPp: z.number().min(0).max(100).optional(),
}).default({ mode: "off" });

export const tau2ParamsSchema = z.object({
  domains: z.array(tau2DomainSchema).min(1),
  numTasksPerDomain: z.number().int().positive().nullable(),
  numTrials: z.number().int().min(1).max(8),
  maxSteps: z.number().int().min(1).max(200).default(50),
  maxConcurrency: z.number().int().min(1).max(16).default(4),
  userSimProviderId: z.string().optional(),
  gate: tau2GateSchema,
});
export type Tau2Params = z.infer<typeof tau2ParamsSchema>;

export const tau2ParamDefaults: Tau2Params = {
  domains: ["airline", "retail", "telecom"],
  numTasksPerDomain: 20, numTrials: 3, maxSteps: 50, maxConcurrency: 4,
  gate: { mode: "off" },
};

const perDomainMetricsSchema = z.object({
  pass1: z.number(), passK: z.number(), tasks: z.number().int(),
  avgReward: z.number().optional(), infraErrors: z.number().int().optional(),
});
export const tau2ReportSchema = z.object({
  kind: z.literal("agent-tau2"),
  userSimModel: z.string(),
  numTrials: z.number().int(),
  overall: perDomainMetricsSchema,
  perDomain: z.record(tau2DomainSchema, perDomainMetricsSchema),
  attribution: z.record(z.string(), z.number()),
  highlights: z.object({
    successSimId: z.string().nullable(), successDomain: z.string().nullable(),
    failureSimId: z.string().nullable(), failureDomain: z.string().nullable(),
  }),
  gate: z.object({
    mode: z.string(),
    result: z.enum(["PASSED", "WARNING", "FAILED"]).nullable(),
    detail: z.string().optional(),
  }).optional(),
});
export type Tau2Report = z.infer<typeof tau2ReportSchema>;
```

- [ ] **Step 4: Run** — `pnpm -F @modeldoctor/tool-adapters test -- tau2/schema` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/tau2/schema.ts packages/tool-adapters/src/tau2/schema.spec.ts
git commit -m "feat(tool-adapters): tau2 params + report zod schemas"
```

---

## Task 3: runner 通用命名哨兵(双密钥去 argv 泄漏)

**Files:**
- Modify: `apps/benchmark-runner/runner/main.py` (add named-secret substitution alongside `OPENAI_API_KEY_SENTINEL`)
- Test: `apps/benchmark-runner/tests/test_named_secret.py`

**Interfaces:**
- Produces: argv token `__MD_SECRET_<NAME>__` → replaced by `os.environ["<NAME>"]` just before spawn. Existing `__MD_OPENAI_API_KEY__` behavior untouched.

- [ ] **Step 1: Write the failing test** — `tests/test_named_secret.py`:

```python
import os
from runner.main import _inject_named_secrets

def test_replaces_named_secret_tokens(monkeypatch):
    monkeypatch.setenv("AGENT_KEY", "sk-agent")
    monkeypatch.setenv("USER_KEY", "sk-user")
    argv = ["/bin/sh", "-c", 'tau2 ... {"api_key":"__MD_SECRET_AGENT_KEY__"} ... {"api_key":"__MD_SECRET_USER_KEY__"}']
    out = _inject_named_secrets(argv)
    assert "sk-agent" in out[2] and "sk-user" in out[2]
    assert "__MD_SECRET_" not in out[2]

def test_missing_env_leaves_token(monkeypatch):
    monkeypatch.delenv("NOPE", raising=False)
    argv = ["echo", "__MD_SECRET_NOPE__"]
    assert _inject_named_secrets(argv) == ["echo", "__MD_SECRET_NOPE__"]
```

- [ ] **Step 2: Run** — `cd apps/benchmark-runner && uv run pytest tests/test_named_secret.py -v` → FAIL (function missing).

- [ ] **Step 3: Implement** — add to `runner/main.py`:

```python
import re
_NAMED_SECRET_RE = re.compile(r"__MD_SECRET_([A-Z0-9_]+)__")

def _inject_named_secrets(argv: list[str]) -> list[str]:
    """Replace __MD_SECRET_<NAME>__ tokens with os.environ[<NAME>].

    Generalizes the single OPENAI_API_KEY sentinel so a tool needing
    multiple distinct secrets in argv (e.g. tau2's agent + user endpoint
    keys inside --*-llm-args JSON) can keep every key out of the persisted
    MD_ARGV / K8s manifest. Unknown env names are left as-is.
    """
    def sub(m: re.Match) -> str:
        val = os.environ.get(m.group(1))
        return val if val is not None else m.group(0)
    return [_NAMED_SECRET_RE.sub(sub, a) for a in argv]
```
Then in `main()`, right after the existing `argv = _inject_api_key_sentinel(argv)` line, add:
```python
    argv = _inject_named_secrets(argv)
```
(Keep it before `log.info("running: %s", " ".join(_redacted(argv)))` — and extend `_redacted` to also mask any residual `api_key":"sk-` substrings so the log never prints a swapped key. Add to `_redacted`: mask `api_key` values via `re.sub(r'("api_key"\s*:\s*")[^"]+', r"\1***", a)`.)

- [ ] **Step 4: Run** — `uv run pytest tests/test_named_secret.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/benchmark-runner/runner/main.py apps/benchmark-runner/tests/test_named_secret.py
git commit -m "feat(benchmark-runner): generic named-secret argv sentinel"
```

---

## Task 4: tau2 buildCommand + progress + duration

**Files:**
- Create: `packages/tool-adapters/src/tau2/build-command.ts`
- Modify: `packages/tool-adapters/src/core/interface.ts` (`BuildCommandPlan.userSimulator?`)
- Test: `packages/tool-adapters/src/tau2/build-command.spec.ts`

**Interfaces:**
- Consumes: `BuildCommandPlan` (+ new optional `userSimulator: { baseUrl: string; model: string; apiKey: string } | null`), `Tau2Params`.
- Produces:
  - `buildTau2Command(plan): BuildCommandResult`
  - `tau2ParseProgress(line): ProgressEvent | null`
  - `tau2MaxDurationSeconds(params): number`
  - Output file aliases: `summary` → `md_out/summary.json`; per domain `results_<domain>` → `data/simulations/<runId>_<domain>/results.json`.

- [ ] **Step 1: Add the optional plan field** — in `interface.ts` `BuildCommandPlan`, after `connection`, add (with a changelog-style doc comment like `tokenizerHfId`):

```ts
  /**
   * Agent-scenario only (tau2): the user-simulator endpoint (a resolved
   * LlmJudgeProvider). Null for all non-agent tools. apiKey is plaintext
   * post-decryption — same trust boundary as connection.apiKey; adapters
   * MUST route it via secretEnv, never argv. Interface evolution (like
   * tokenizerHfId): a cross-cutting optional capability, documented here.
   */
  userSimulator?: { baseUrl: string; model: string; apiKey: string } | null;
```

- [ ] **Step 2: Write the failing test** — `build-command.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildTau2Command, tau2MaxDurationSeconds } from "./build-command.js";
import { tau2ParamDefaults } from "./schema.js";

const plan = {
  runId: "run123",
  params: { ...tau2ParamDefaults, domains: ["airline", "retail"], numTasksPerDomain: 5, numTrials: 2 },
  connection: { baseUrl: "http://agent.svc/v1", apiKey: "sk-agent", model: "qwen3-8b",
    customHeaders: "", queryParams: "", tokenizerHfId: null, prometheusDatasource: null },
  userSimulator: { baseUrl: "http://judge.svc/v1", model: "deepseek-v3", apiKey: "sk-user" },
} as const;

describe("buildTau2Command", () => {
  const r = buildTau2Command(plan as any);
  it("shells out via /bin/sh -c", () => {
    expect(r.argv[0]).toBe("/bin/sh");
    expect(r.argv[1]).toBe("-c");
  });
  it("runs tau2 once per domain with openai/ prefix + num flags", () => {
    const s = r.argv[2];
    expect(s).toContain("--domain airline");
    expect(s).toContain("--domain retail");
    expect(s).toContain("--agent-llm openai/qwen3-8b");
    expect(s).toContain("--user-llm openai/deepseek-v3");
    expect(s).toContain("--num-tasks 5");
    expect(s).toContain("--num-trials 2");
    expect(s).toContain("--auto-resume");
  });
  it("puts api_base in llm-args and keys only as named-secret sentinels", () => {
    const s = r.argv[2];
    expect(s).toContain('"api_base": "http://agent.svc/v1"');
    expect(s).toContain('"api_base": "http://judge.svc/v1"');
    expect(s).toContain("__MD_SECRET_MD_AGENT_KEY__");
    expect(s).toContain("__MD_SECRET_MD_USER_KEY__");
    expect(s).not.toContain("sk-agent");
    expect(s).not.toContain("sk-user");
  });
  it("passes keys via secretEnv, never argv", () => {
    expect(r.secretEnv.MD_AGENT_KEY).toBe("sk-agent");
    expect(r.secretEnv.MD_USER_KEY).toBe("sk-user");
  });
  it("calls the summarizer with runId + domains", () => {
    expect(r.argv[2]).toContain("md_tau2_summarize.py");
    expect(r.argv[2]).toContain("--run-id run123");
    expect(r.argv[2]).toContain("--domains airline,retail");
  });
  it("declares summary + per-domain results output files", () => {
    expect(r.outputFiles.summary).toBe("md_out/summary.json");
    expect(r.outputFiles.results_airline).toBe("data/simulations/run123_airline/results.json");
    expect(r.outputFiles.results_retail).toBe("data/simulations/run123_retail/results.json");
  });
});

describe("tau2MaxDurationSeconds", () => {
  it("scales with domains × tasks × trials", () => {
    const full = tau2MaxDurationSeconds({ ...tau2ParamDefaults, domains: ["airline","retail","telecom"], numTasksPerDomain: null, numTrials: 4 });
    const smoke = tau2MaxDurationSeconds({ ...tau2ParamDefaults, domains: ["airline"], numTasksPerDomain: 5, numTrials: 1 });
    expect(full).toBeGreaterThan(smoke);
    expect(smoke).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run** — `pnpm -F @modeldoctor/tool-adapters test -- tau2/build-command` → FAIL.

- [ ] **Step 4: Implement** `build-command.ts`:

```ts
import type { BuildCommandPlan, BuildCommandResult, ProgressEvent } from "../core/interface.js";
import { tau2ParamsSchema, type Tau2Domain, type Tau2Params } from "./schema.js";

// Full task-set sizes (from tau2 source data/tau2/domains). Used only for
// duration estimation when numTasksPerDomain is null (full set).
const FULL_TASK_COUNT: Record<Tau2Domain, number> = { airline: 50, retail: 114, telecom: 114 };
const SECONDS_PER_EPISODE = 90; // generous per multi-turn episode upper bound

function llmArgs(apiBase: string, keyEnvName: string): string {
  // JSON dict passed to tau2 --*-llm-args (json.loads). api_key is a named-
  // secret sentinel; runner swaps in os.environ[keyEnvName] before spawn.
  return JSON.stringify({ api_base: apiBase, api_key: `__MD_SECRET_${keyEnvName}__`, temperature: 0.0 });
}

export function buildTau2Command(plan: BuildCommandPlan): BuildCommandResult {
  const params = tau2ParamsSchema.parse(plan.params) as Tau2Params;
  const { runId, connection, userSimulator } = plan;
  if (!userSimulator) throw new Error("tau2 requires a resolved userSimulator endpoint");

  const agentArgs = llmArgs(connection.baseUrl, "MD_AGENT_KEY");
  const userArgs = llmArgs(userSimulator.baseUrl, "MD_USER_KEY");
  const numTasksFlag = params.numTasksPerDomain != null ? ` --num-tasks ${params.numTasksPerDomain}` : "";

  const perDomain = params.domains.map((d) => {
    // single-quote the JSON for the shell; JSON has no single quotes.
    return [
      "tau2 run",
      `--domain ${d}`,
      `--agent-llm openai/${connection.model}`,
      `--agent-llm-args '${agentArgs}'`,
      `--user-llm openai/${userSimulator.model}`,
      `--user-llm-args '${userArgs}'`,
      `--num-trials ${params.numTrials}`,
      numTasksFlag.trim(),
      `--max-steps ${params.maxSteps}`,
      `--max-concurrency ${params.maxConcurrency}`,
      `--save-to ${runId}_${d}`,
      "--auto-resume",
    ].filter(Boolean).join(" ");
  });

  const summarize = `python /app/tau2/md_tau2_summarize.py --run-id ${runId} --domains ${params.domains.join(",")} --num-trials ${params.numTrials} --user-sim-model ${userSimulator.model} --out md_out/summary.json`;
  const script = [...perDomain, summarize].join(" && ");

  const outputFiles: Record<string, string> = { summary: "md_out/summary.json" };
  for (const d of params.domains) outputFiles[`results_${d}`] = `data/simulations/${runId}_${d}/results.json`;

  return {
    argv: ["/bin/sh", "-c", script],
    env: {},
    secretEnv: { MD_AGENT_KEY: connection.apiKey, MD_USER_KEY: userSimulator.apiKey },
    outputFiles,
  };
}

export function tau2MaxDurationSeconds(params: unknown): number {
  const p = tau2ParamsSchema.parse(params) as Tau2Params;
  const totalTasks = p.domains.reduce(
    (sum, d) => sum + (p.numTasksPerDomain ?? FULL_TASK_COUNT[d]), 0);
  return totalTasks * p.numTrials * SECONDS_PER_EPISODE;
}

export function tau2ParseProgress(line: string): ProgressEvent | null {
  // tau2 prints task progress; surface a coarse log line. A tighter percent
  // parser can be tuned in Task 13 against real stdout.
  const m = line.match(/(\d+)\s*\/\s*(\d+)\s+tasks?/i);
  if (m) {
    const [, done, total] = m;
    const pct = Math.round((Number(done) / Number(total)) * 100);
    return { kind: "progress", pct, message: `${done}/${total} tasks` };
  }
  return null;
}
```

- [ ] **Step 5: Run** — `pnpm -F @modeldoctor/tool-adapters test -- tau2/build-command` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tool-adapters/src/tau2/build-command.ts packages/tool-adapters/src/tau2/build-command.spec.ts packages/tool-adapters/src/core/interface.ts
git commit -m "feat(tool-adapters): tau2 buildCommand with dual-endpoint secret injection"
```

---

## Task 5: 门禁纯函数 `computeGate`

**Files:**
- Create: `packages/tool-adapters/src/tau2/gate.ts`
- Test: `packages/tool-adapters/src/tau2/gate.spec.ts`

**Interfaces:**
- Consumes: `Tau2Report` (from Task 2), `Tau2Params["gate"]`.
- Produces: `computeGate(report: Tau2Report, gate: Tau2Params["gate"], baselineOverallPass1: number | null): { mode: string; result: "PASSED"|"WARNING"|"FAILED"|null; detail?: string }`.

- [ ] **Step 1: Write the failing test** — `gate.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeGate } from "./gate.js";

const base = {
  kind: "agent-tau2", userSimModel: "x", numTrials: 3,
  overall: { pass1: 0.4, passK: 0.3, tasks: 60 },
  perDomain: { airline: { pass1: 0.25, passK: 0.2, tasks: 20 }, retail: { pass1: 0.5, passK: 0.4, tasks: 20 } },
  attribution: {}, highlights: { successSimId: null, successDomain: null, failureSimId: null, failureDomain: null },
} as const;

describe("computeGate", () => {
  it("off → null result", () => {
    expect(computeGate(base as any, { mode: "off" }, null).result).toBeNull();
  });
  it("perDomainFloor FAILS when a domain is below its floor", () => {
    const g = computeGate(base as any, { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } }, null);
    expect(g.result).toBe("FAILED");
    expect(g.detail).toContain("airline");
  });
  it("perDomainFloor PASSES when all domains meet floor", () => {
    const g = computeGate(base as any, { mode: "perDomainFloor", perDomainFloor: { airline: 0.2, retail: 0.4 } }, null);
    expect(g.result).toBe("PASSED");
  });
  it("baselineRegression FAILED when drop exceeds pp", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 5 }, 0.5);
    expect(g.result).toBe("FAILED"); // 0.40 vs 0.50 = -10pp > 5
  });
  it("baselineRegression WARNING within half the threshold", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 30 }, 0.5);
    expect(g.result).toBe("WARNING"); // -10pp, within [15,30) → warn
  });
  it("baselineRegression PASSED when no meaningful drop", () => {
    const g = computeGate(base as any, { mode: "baselineRegression", baselineRegressionPp: 30 }, 0.41);
    expect(g.result).toBe("PASSED");
  });
});
```

- [ ] **Step 2: Run** — `pnpm -F @modeldoctor/tool-adapters test -- tau2/gate` → FAIL.

- [ ] **Step 3: Implement** `gate.ts`:

```ts
import type { Tau2Params } from "./schema.js";
import type { Tau2Report } from "./schema.js";

export type GateResult = { mode: string; result: "PASSED" | "WARNING" | "FAILED" | null; detail?: string };

export function computeGate(
  report: Tau2Report,
  gate: Tau2Params["gate"],
  baselineOverallPass1: number | null,
): GateResult {
  if (gate.mode === "off") return { mode: "off", result: null };

  if (gate.mode === "perDomainFloor") {
    const floors = gate.perDomainFloor ?? {};
    const failed = Object.entries(floors).filter(([d, floor]) => {
      const m = report.perDomain[d as keyof typeof report.perDomain];
      return m != null && m.pass1 < floor;
    });
    if (failed.length > 0) {
      return { mode: gate.mode, result: "FAILED",
        detail: failed.map(([d, f]) => `${d} pass^1<${f}`).join(", ") };
    }
    return { mode: gate.mode, result: "PASSED" };
  }

  // baselineRegression
  if (baselineOverallPass1 == null) {
    return { mode: gate.mode, result: null, detail: "no baseline" };
  }
  const dropPp = (baselineOverallPass1 - report.overall.pass1) * 100;
  const th = gate.baselineRegressionPp ?? 5;
  if (dropPp >= th) return { mode: gate.mode, result: "FAILED", detail: `-${dropPp.toFixed(1)}pp vs baseline` };
  if (dropPp >= th / 2) return { mode: gate.mode, result: "WARNING", detail: `-${dropPp.toFixed(1)}pp vs baseline` };
  return { mode: gate.mode, result: "PASSED", detail: `${dropPp <= 0 ? "+" : "-"}${Math.abs(dropPp).toFixed(1)}pp vs baseline` };
}
```

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/tau2/gate.ts packages/tool-adapters/src/tau2/gate.spec.ts
git commit -m "feat(tool-adapters): tau2 gate (perDomainFloor + baselineRegression)"
```

---

## Task 6: tau2 adapter 组装 + parseFinalReport + 注册

**Files:**
- Create: `packages/tool-adapters/src/tau2/runtime.ts`, `packages/tool-adapters/src/tau2/index.ts`
- Modify: `packages/tool-adapters/src/core/interface.ts` (`ToolReport` union), `core/registry.ts`, `index.ts`, `schemas-entry.ts`
- Test: `packages/tool-adapters/src/tau2/runtime.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 2/4/5.
- Produces: `tau2Adapter: ToolAdapter`; `tau2ReadMetric` (always `null`); `parseFinalReport` reads `files.summary` (Buffer of `summary.json`) → `{ tool: "tau2", data: Tau2Report }` (gate is merged at the service layer in Task 9, which has params + baseline; `parseFinalReport` fills `data` and leaves `data.gate` from the summary if the summarizer emitted a placeholder).

> Design note: `parseFinalReport(stdout, files)` per the frozen interface takes only stdout+files, NOT params/baseline. So GATE cannot be computed here (needs params + baseline from DB). Therefore: `parseFinalReport` returns the metrics shape with `gate` omitted; the **BenchmarkService** (Task 9) calls `computeGate(...)` after parse and merges it into `summaryMetrics.data.gate` before persisting. Keep `computeGate` a pure export used by the service.

- [ ] **Step 1: Write the failing test** — `runtime.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tau2Adapter } from "./runtime.js";

const summary = {
  kind: "agent-tau2", userSimModel: "deepseek-v3", numTrials: 2,
  overall: { pass1: 0.4, passK: 0.3, tasks: 30 },
  perDomain: { airline: { pass1: 0.4, passK: 0.3, tasks: 30 } },
  attribution: { wrong_action: 1.0 },
  highlights: { successSimId: "s1", successDomain: "airline", failureSimId: "s2", failureDomain: "airline" },
};

describe("tau2Adapter", () => {
  it("has name tau2 bound to agent scenario", () => {
    expect(tau2Adapter.name).toBe("tau2");
    expect(tau2Adapter.scenarios).toContain("agent");
  });
  it("readMetric always returns null (agent metrics are not inference-shaped)", () => {
    expect(tau2Adapter.readMetric("ttft.p50", summary as any)).toBeNull();
  });
  it("parseFinalReport maps summary.json into the report union", () => {
    const files = { summary: Buffer.from(JSON.stringify(summary)) };
    const r = tau2Adapter.parseFinalReport("", files);
    expect(r.tool).toBe("tau2");
    expect((r.data as any).overall.tasks).toBe(30);
  });
  it("parseFinalReport throws a clear error when summary missing", () => {
    expect(() => tau2Adapter.parseFinalReport("", {})).toThrow(/summary/i);
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`runtime.ts`:
```ts
import type { MetricKind, ToolAdapter, ToolReport } from "../core/interface.js";
import { buildTau2Command, tau2MaxDurationSeconds, tau2ParseProgress } from "./build-command.js";
import { tau2ParamDefaults, tau2ParamsSchema, tau2ReportSchema } from "./schema.js";

export function tau2ReadMetric(_kind: MetricKind, _data: Record<string, unknown>): number | null {
  return null; // agent success/pass^k is not an inference-shaped metric
}

export const tau2Adapter: ToolAdapter = {
  name: "tau2",
  scenarios: ["agent"],
  paramsSchema: tau2ParamsSchema,
  reportSchema: tau2ReportSchema,
  paramDefaults: tau2ParamDefaults,
  buildCommand: buildTau2Command,
  parseProgress: tau2ParseProgress,
  getMaxDurationSeconds: tau2MaxDurationSeconds,
  readMetric: tau2ReadMetric,
  parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
    const buf = files.summary;
    if (!buf) throw new Error("tau2 parseFinalReport: missing 'summary' output file (summary.json)");
    const data = tau2ReportSchema.parse(JSON.parse(buf.toString("utf8")));
    return { tool: "tau2", data };
  },
};
```

`index.ts`:
```ts
export { tau2Adapter, tau2ReadMetric } from "./runtime.js";
export { computeGate, type GateResult } from "./gate.js";
export * from "./schema.js";
```

In `core/interface.ts`, add to the `ToolReport` union (and the type-only import):
```ts
import type { Tau2Report } from "../tau2/schema.js";
// ...
  | { tool: "aiperf"; data: AiperfReport }
  | { tool: "tau2"; data: Tau2Report };
```

In `core/registry.ts`: import `tau2Adapter` and add `tau2: tau2Adapter` to `ADAPTERS`.

In `index.ts` and `schemas-entry.ts`: export `tau2Adapter`, `tau2ReadMetric`, `tau2ParamsSchema`, `tau2ReportSchema`, `tau2ParamDefaults`, `type Tau2Params`, `type Tau2Report`, `computeGate` (mirror the aiperf export block).

- [ ] **Step 4: Run** — `pnpm -F @modeldoctor/tool-adapters test` (full package, so `assertScenariosInvariant` now passes with the adapter registered) → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/tau2/ packages/tool-adapters/src/core/interface.ts packages/tool-adapters/src/core/registry.ts packages/tool-adapters/src/index.ts packages/tool-adapters/src/schemas-entry.ts
git commit -m "feat(tool-adapters): assemble + register tau2 adapter"
```

---

## Task 7: Python 摘要脚本(复用 tau2 `compute_metrics` + 确定性归因)

**Files:**
- Create: `apps/benchmark-runner/tau2/summarize_lib.py` (pure functions), `apps/benchmark-runner/tau2/md_tau2_summarize.py` (CLI entry)
- Modify: `apps/benchmark-runner/pyproject.toml` (add `tau2` as a dev dependency so pytest can import its data models)
- Test: `apps/benchmark-runner/tests/test_tau2_summarize.py`

**Interfaces:**
- Produces `summary.json` matching `tau2ReportSchema` (Task 2). Pure functions:
  - `bucket_failure(sim: SimulationRun) -> str` → one of `agent_crash|no_completion|wrong_action|wrong_final_state|missing_info|other`
  - `domain_metrics(results: Results) -> dict` → `{pass1, passK, tasks, avgReward, infraErrors}`
  - `build_summary(per_domain: dict[str, Results], num_trials, user_sim_model) -> dict`

- [ ] **Step 1: Write the failing test** — `tests/test_tau2_summarize.py` (constructs tau2 pydantic objects directly — no LLM needed):

```python
from tau2.data_model.simulation import SimulationRun, RewardInfo, DBCheck, ActionCheck, TerminationReason
from tau2.data_model.tasks import Action
from tau2.environment.toolkit import ToolType
from tau2.tau2.summarize_lib import bucket_failure  # adjust import to installed path

def _sim(**kw):
    base = dict(id="s", task_id="t", start_time="0", end_time="1", duration=1.0,
                termination_reason=TerminationReason.USER_STOP, trial=0)
    base.update(kw)
    return SimulationRun(**base)

def test_agent_crash():
    assert bucket_failure(_sim(termination_reason=TerminationReason.AGENT_ERROR)) == "agent_crash"

def test_no_completion():
    assert bucket_failure(_sim(termination_reason=TerminationReason.MAX_STEPS)) == "no_completion"

def test_wrong_action():
    ac = ActionCheck(action=Action(name="book"), action_match=False, action_reward=0.0, tool_type=ToolType.WRITE)
    sim = _sim(reward_info=RewardInfo(reward=0.0, action_checks=[ac]))
    assert bucket_failure(sim) == "wrong_action"

def test_wrong_final_state():
    sim = _sim(reward_info=RewardInfo(reward=0.0, db_check=DBCheck(db_match=False, db_reward=0.0)))
    assert bucket_failure(sim) == "wrong_final_state"

def test_other_when_no_signal():
    assert bucket_failure(_sim(reward_info=RewardInfo(reward=0.0))) == "other"
```

(Verify the exact `Action` constructor args against `tau2/data_model/tasks.py` during impl; the cloned repo is at the scratchpad path used in research. Adjust the minimal kwargs so the pydantic objects validate.)

- [ ] **Step 2: Run** — `cd apps/benchmark-runner && uv run pytest tests/test_tau2_summarize.py -v` → FAIL.

- [ ] **Step 3: Implement** `summarize_lib.py`:

```python
"""Pure helpers to turn tau2 Results into ModelDoctor's summary.json shape.
Reuses tau2's own metrics (compute_metrics / pass^k) — we never reimplement pass^k.
"""
from tau2.data_model.simulation import Results, SimulationRun, TerminationReason
from tau2.metrics.agent_metrics import compute_metrics, is_successful

_CRASH = {TerminationReason.AGENT_ERROR, TerminationReason.TOO_MANY_ERRORS,
          TerminationReason.CONTEXT_WINDOW_EXCEEDED, TerminationReason.UNEXPECTED_ERROR}
_NO_COMPLETION = {TerminationReason.MAX_STEPS, TerminationReason.TIMEOUT}

def bucket_failure(sim: SimulationRun) -> str:
    tr = sim.termination_reason
    if tr in _CRASH:
        return "agent_crash"
    ri = sim.reward_info
    if ri and ri.action_checks and any(not ac.action_match for ac in ri.action_checks):
        return "wrong_action"
    if ri and ri.db_check and not ri.db_check.db_match:
        return "wrong_final_state"
    if ri and ri.communicate_checks and any(not c.met for c in ri.communicate_checks):
        return "missing_info"
    if tr in _NO_COMPLETION:
        return "no_completion"
    return "other"

def domain_metrics(results: Results) -> dict:
    m = compute_metrics(results)
    pass_ks = m.pass_hat_ks  # {k: float}
    max_k = max(pass_ks) if pass_ks else 1
    return {
        "pass1": pass_ks.get(1, 0.0),
        "passK": pass_ks.get(max_k, pass_ks.get(1, 0.0)),
        "tasks": m.total_tasks,
        "avgReward": m.avg_reward,
        "infraErrors": m.infra_error_count,
    }

def build_summary(per_domain: dict, num_trials: int, user_sim_model: str) -> dict:
    domains = {}
    attribution_counts: dict[str, int] = {}
    total_failed = 0
    best = (-1.0, None, None); worst = (2.0, None, None)  # (reward, sim_id, domain)
    weighted_p1 = 0.0; weighted_pk = 0.0; total_tasks = 0

    for dname, results in per_domain.items():
        dm = domain_metrics(results)
        domains[dname] = dm
        total_tasks += dm["tasks"]
        weighted_p1 += dm["pass1"] * dm["tasks"]
        weighted_pk += dm["passK"] * dm["tasks"]
        for sim in results.simulations:
            if sim.termination_reason == TerminationReason.INFRASTRUCTURE_ERROR:
                continue
            r = sim.reward_info.reward if sim.reward_info else 0.0
            if is_successful(r):
                if r > best[0]:
                    best = (r, sim.id, dname)
            else:
                total_failed += 1
                b = bucket_failure(sim)
                attribution_counts[b] = attribution_counts.get(b, 0) + 1
                if r < worst[0]:
                    worst = (r, sim.id, dname)

    attribution = {k: v / total_failed for k, v in attribution_counts.items()} if total_failed else {}
    overall = {
        "pass1": weighted_p1 / total_tasks if total_tasks else 0.0,
        "passK": weighted_pk / total_tasks if total_tasks else 0.0,
        "tasks": total_tasks,
    }
    return {
        "kind": "agent-tau2", "userSimModel": user_sim_model, "numTrials": num_trials,
        "overall": overall, "perDomain": domains, "attribution": attribution,
        "highlights": {
            "successSimId": best[1], "successDomain": best[2],
            "failureSimId": worst[1], "failureDomain": worst[2],
        },
    }
```

`md_tau2_summarize.py` (CLI):
```python
import argparse, json
from pathlib import Path
from tau2.data_model.simulation import Results
from summarize_lib import build_summary  # same dir on PYTHONPATH in the image

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--domains", required=True)  # comma-separated
    ap.add_argument("--num-trials", type=int, required=True)
    ap.add_argument("--user-sim-model", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    per_domain = {}
    for d in args.domains.split(","):
        path = Path(f"data/simulations/{args.run_id}_{d}/results.json")
        per_domain[d] = Results.load(path)

    summary = build_summary(per_domain, args.num_trials, args.user_sim_model)
    out = Path(args.out); out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))
    print(f"wrote {args.out}: overall pass^1={summary['overall']['pass1']:.3f}")

if __name__ == "__main__":
    main()
```

Add `tau2` to `pyproject.toml` `[dependency-groups] dev` (git source or PyPI — match how the image installs it in Task 8).

- [ ] **Step 4: Run** — `uv run pytest tests/test_tau2_summarize.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/benchmark-runner/tau2/ apps/benchmark-runner/tests/test_tau2_summarize.py apps/benchmark-runner/pyproject.toml
git commit -m "feat(benchmark-runner): tau2 summarizer (reuses compute_metrics, deterministic attribution)"
```

---

## Task 8: tau2 runner 镜像 + imageForTool

**Files:**
- Create: `apps/benchmark-runner/images/tau2.Dockerfile`
- Modify: `apps/benchmark-runner/tools/build-runner-images.sh`, `apps/api/src/modules/benchmark/k8s/runner-images.ts`
- Test: build smoke (documented commands; no unit test)

- [ ] **Step 1: Write `tau2.Dockerfile`** (base 3.12, install tau2 from source via uv, copy runner wrapper + our summarizer, verify data):

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv
WORKDIR /app

# tau2-bench from source (pins a commit for reproducibility — set during impl)
ARG TAU2_REF=main
RUN git clone --depth 1 --branch ${TAU2_REF} https://github.com/sierra-research/tau2-bench.git /opt/tau2 \
 && cd /opt/tau2 && uv pip install --system -e .

# tau2 needs its data dir; the repo ships data/ under /opt/tau2. Point tau2 at it.
ENV TAU2_DATA_DIR=/opt/tau2/data
RUN tau2 check-data || (echo "tau2 data check failed" && exit 1)

# ModelDoctor generic runner wrapper + our summarizer
COPY runner /app/runner
COPY tau2 /app/tau2
ENV PYTHONPATH=/app:/app/tau2
ENTRYPOINT ["python", "-m", "runner.main"]
```

> During impl verify: (a) tau2's actual data-dir env var name (`tau2 check-data` output / `tau2.config`), (b) whether `uv pip install --system -e .` is the right invocation vs `uv sync`. Adjust; report deviation per plan discipline.

- [ ] **Step 2: Wire the build script** — add a `tau2` case to `tools/build-runner-images.sh` mirroring the `aiperf` entry (image tag `md-runner-tau2`).

- [ ] **Step 3: `imageForTool`** — in `apps/api/src/modules/benchmark/k8s/runner-images.ts`, add `tau2 → md-runner-tau2` (mirror existing tool → image mapping; keep the same registry-prefix convention).

- [ ] **Step 4: Build + smoke**

```bash
cd apps/benchmark-runner
docker build -f images/tau2.Dockerfile -t md-runner-tau2 .
docker run --rm --entrypoint tau2 md-runner-tau2 --help          # tau2 CLI present
docker run --rm --entrypoint python md-runner-tau2 -c "import tau2.metrics.agent_metrics"  # importable
```
Expected: help text prints; import succeeds; `tau2 check-data` passed during build.

- [ ] **Step 5: Commit**

```bash
git add apps/benchmark-runner/images/tau2.Dockerfile apps/benchmark-runner/tools/build-runner-images.sh apps/api/src/modules/benchmark/k8s/runner-images.ts
git commit -m "build(benchmark-runner): tau2 runner image + imageForTool mapping"
```

---

## Task 9: API — user-sim 解析 + 门禁合并

**Files:**
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts` (agent-scenario branch)
- Test: `apps/api/src/modules/benchmark/benchmark.service.spec.ts` (or a focused new spec)

**Interfaces:**
- Consumes: `computeGate` (Task 6 export), `tau2ParamsSchema`, `LlmJudgeService` (resolve default provider + decrypt key), the existing buildCommand/plan flow.
- Produces: for `scenario==='agent'`, `plan.userSimulator` is populated; after `parseFinalReport`, `summaryMetrics.data.gate` is set via `computeGate`.

Read first: how the service currently builds `BuildCommandPlan` from a `Connection` and calls `adapter.buildCommand` / `parseFinalReport`; where `summaryMetrics` is persisted; how `LlmJudgeService` exposes the default provider (`apps/api/src/modules/llm-judge/`) and decrypts keys (reuses `CONNECTION_API_KEY_ENCRYPTION_KEY`).

- [ ] **Step 1: Write the failing test** — assert that creating an agent benchmark resolves the default judge provider into `plan.userSimulator` and that a below-floor result yields `gate.result === "FAILED"`. Mock `LlmJudgeService.getDefault()` → `{ baseUrl, model, apiKeyCipher }`; mock the runner so `parseFinalReport` returns a known summary; assert persisted `summaryMetrics.data.gate`.

```ts
it("agent scenario injects default judge provider as userSimulator", async () => {
  llmJudge.getDefault.mockResolvedValue({ baseUrl: "http://judge/v1", model: "deepseek-v3", apiKeyCipher: enc("sk-user") });
  const plan = await service.buildPlanForTest({ scenario: "agent", tool: "tau2",
    params: { ...tau2ParamDefaults, gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.9 } } },
    connectionId });
  expect(plan.userSimulator).toEqual({ baseUrl: "http://judge/v1", model: "deepseek-v3", apiKey: "sk-user" });
});
it("merges computeGate result into summaryMetrics after parse", async () => {
  // arrange parseFinalReport to return airline pass1=0.4; gate floor 0.9 → FAILED
  const persisted = await service.finalizeForTest(benchmarkId, summaryWithAirline04, { mode: "perDomainFloor", perDomainFloor: { airline: 0.9 } }, null);
  expect(persisted.summaryMetrics.data.gate.result).toBe("FAILED");
});
```
(Adapt method names to the real service surface; if no test seam exists, extract the two behaviors—`resolveUserSimulator(params)` and `applyGate(report, gate, baseline)`—into small private-but-testable helpers and test those.)

- [ ] **Step 2: Run** — `pnpm -F @modeldoctor/api test -- benchmark.service` → FAIL.

- [ ] **Step 3: Implement**
  - In the plan-building path, when `scenario === "agent"`: parse params via `tau2ParamsSchema`; resolve provider = `params.userSimProviderId ? llmJudge.getById(id) : llmJudge.getDefault()`; throw a 400-style domain error if none exists ("Agent 评测需要一个默认 LLM judge provider 作为模拟用户"); decrypt its key; set `plan.userSimulator = { baseUrl, model, apiKey }`. For non-agent tools, `plan.userSimulator` stays undefined.
  - In the finalize path, after `report = adapter.parseFinalReport(...)` for tool `tau2`: look up baseline overall pass^1 (if `benchmark.baselineId`, load that baseline benchmark's `summaryMetrics.data.overall.pass1`, else null); `const gate = computeGate(report.data, params.gate, baselinePass1); report.data.gate = gate;` then persist as today.

- [ ] **Step 4: Run** — PASS. Then `pnpm -F @modeldoctor/api build` (nest build — catches the TS2307 class of errors; ensure tool-adapters is built first: `pnpm -r build`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/benchmark/benchmark.service.ts apps/api/src/modules/benchmark/benchmark.service.spec.ts
git commit -m "feat(api): resolve user-simulator + apply tau2 gate for agent scenario"
```

---

## Task 10: 三档官方模板 + seed schema-picker

**Files:**
- Modify: `apps/api/prisma/seed.ts` (`BENCHMARK_TEMPLATES` + schema-picker)
- Test: `apps/api/prisma/seed.spec.ts` (or the existing seed-validation test)

**Interfaces:**
- Produces three rows: `tpl_official_agent_smoke|standard|full`, each `scenario:"agent", tool:"tau2"`, config validated by `tau2ParamsSchema`.

- [ ] **Step 1: Write the failing test** — assert the three configs parse under `tau2ParamsSchema` and have the tiered params:

```ts
import { tau2ParamsSchema } from "@modeldoctor/tool-adapters";
const tiers = { smoke: [5,1], standard: [20,3], full: [null,4] } as const;
for (const [name, [tasks, trials]] of Object.entries(tiers)) {
  it(`agent template ${name} validates`, () => {
    const tpl = BENCHMARK_TEMPLATES.find(t => t.id === `tpl_official_agent_${name}`)!;
    expect(tpl.scenario).toBe("agent");
    const p = tau2ParamsSchema.parse(tpl.config);
    expect(p.numTasksPerDomain).toBe(tasks);
    expect(p.numTrials).toBe(trials);
    expect(p.domains).toEqual(["airline","retail","telecom"]);
  });
}
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — add the schema-picker `tau2` case (mirror aiperf: `case "tau2": return tau2ParamsSchema`) and append three entries:

```ts
{ id: "tpl_official_agent_smoke", name: "Agent 冒烟(Smoke)", scenario: "agent", tool: "tau2",
  isOfficial: true, categories: ["chat"], tags: ["agent","tau2","smoke"],
  description: "3 domain × 5 任务 × 1 trial,验证链路 / 快速回归门禁。",
  config: { domains: ["airline","retail","telecom"], numTasksPerDomain: 5, numTrials: 1, maxSteps: 50, maxConcurrency: 4, gate: { mode: "off" } } },
{ id: "tpl_official_agent_standard", name: "Agent 基本能力(Standard)", scenario: "agent", tool: "tau2",
  isOfficial: true, categories: ["chat"], tags: ["agent","tau2","standard"],
  description: "3 domain × 20 任务 × 3 trial,测基本 Agent 能力 + pass^k 稳定性。",
  config: { domains: ["airline","retail","telecom"], numTasksPerDomain: 20, numTrials: 3, maxSteps: 50, maxConcurrency: 4, gate: { mode: "off" } } },
{ id: "tpl_official_agent_full", name: "Agent 全量(Full)", scenario: "agent", tool: "tau2",
  isOfficial: true, categories: ["chat"], tags: ["agent","tau2","full"],
  description: "3 domain 全任务集(50/114/114)× 4 trial,对标官方 leaderboard。慢且贵。",
  config: { domains: ["airline","retail","telecom"], numTasksPerDomain: null, numTrials: 4, maxSteps: 50, maxConcurrency: 4, gate: { mode: "off" } } },
```

- [ ] **Step 4: Run** — test PASS; then `pnpm -F @modeldoctor/api db:seed` against dev DB → 3 rows upsert (ask user before any DB reset; seed upsert is safe/non-destructive).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/prisma/seed.spec.ts
git commit -m "feat(api): seed three official tau2 agent templates (smoke/standard/full)"
```

---

## Task 11: Web — AgentReport 容器 + 完成率柱状图

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/AgentReport.tsx`, `reports/agent/CompletionBars.tsx`
- Modify: `apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx` (route `scenario==='agent'` → `<AgentReport>`)
- Test: `reports/agent/AgentReport.test.tsx`

**Interfaces:**
- Consumes: `benchmark.summaryMetrics.data` (a `Tau2Report`). Mirror how `InferenceReport` receives `{ benchmark }`.

- [ ] **Step 1: Write the failing test** — render `<AgentReport benchmark={fixture} />`; assert it shows overall pass^1, a per-domain bar for each domain, the gate badge, and the user-sim label:

```tsx
it("renders overall, per-domain bars, gate badge and user-sim label", () => {
  render(<AgentReport benchmark={agentBenchmarkFixture} />);
  expect(screen.getByText(/40%/)).toBeInTheDocument();          // overall pass^1
  expect(screen.getByText("airline")).toBeInTheDocument();
  expect(screen.getByText(/deepseek-v3/)).toBeInTheDocument();  // 模拟用户模型标注
  expect(screen.getByText(/FAILED|PASSED|WARNING/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** — `pnpm -F @modeldoctor/web test -- AgentReport` → FAIL.

- [ ] **Step 3: Implement** — `AgentReport.tsx` composes: header tiles (overall pass^1/pass^k, tasks, gate badge, "模拟用户: <userSimModel>"), `<CompletionBars perDomain numTrials />`, then `<ConversationReplay>` (Task 12) + `<FailureAttribution>` (Task 13) placeholders wired in later. `CompletionBars` renders grouped pass^1/pass^k bars per domain using the **dataviz** color system (read the skill; use the categorical palette; label axes; provide an `overflow-x:auto` wrapper). Gate badge reuses the PASSED/WARNING/FAILED color semantics from the quality-gate UI. Follow the page-body conventions (no card chrome unless matching siblings). In `BenchmarkDetailPage.tsx`, add the `scenario === "agent"` case returning `<AgentReport benchmark={benchmark} />`.

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/reports/AgentReport.tsx apps/web/src/features/benchmarks/reports/agent/CompletionBars.tsx apps/web/src/features/benchmarks/reports/agent/AgentReport.test.tsx apps/web/src/features/benchmarks/BenchmarkDetailPage.tsx
git commit -m "feat(web): AgentReport container + per-domain completion bars"
```

---

## Task 12: Web — 对话回放

**Files:**
- Create: `reports/agent/ConversationReplay.tsx`, `reports/agent/queries.ts`
- Test: `reports/agent/ConversationReplay.test.tsx`

**Interfaces:**
- Consumes: `benchmark.summaryMetrics.data.highlights` (success/failure sim ids + domain). Fetches the domain's `results.json` via the existing files endpoint `GET /benchmarks/:id/files/results_<domain>` (alias set in Task 4), finds the sim by id, renders `messages[]` as chat bubbles.

- [ ] **Step 1: Write the failing test** — with a mocked query hook returning a small `results.json` (2 sims, one with a user turn + an assistant tool_call), assert bubbles render and the failing turn is highlighted:

```tsx
it("renders chat bubbles for the highlighted failure sim and marks the faulty turn", async () => {
  mockTrajectory(sampleResults);
  render(<ConversationReplay benchmarkId="b1" simId="s2" domain="airline" variant="failure" />);
  expect(await screen.findByText(/改签/)).toBeInTheDocument();     // user message
  expect(screen.getByText(/book_reservation/)).toBeInTheDocument(); // agent tool call
  expect(screen.getByTestId("faulty-turn")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — `queries.ts`: `useTrajectory(benchmarkId, domain)` → React Query fetching the files endpoint, parsing `Results`, memoizing sims by id. `ConversationReplay.tsx`: given `simId`, render each `Message` (role user/assistant/tool) as a bubble; for `variant="failure"`, highlight the turn(s) where a tool_call failed or the final assistant turn (use `reward_info.action_checks` failed action names when present; else the last turn). Provide a task-picker dropdown to switch sims. Mirror the project's existing chat/message rendering styling if any (`features/playground/chat`).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/reports/agent/ConversationReplay.tsx apps/web/src/features/benchmarks/reports/agent/queries.ts apps/web/src/features/benchmarks/reports/agent/ConversationReplay.test.tsx
git commit -m "feat(web): tau2 conversation replay with fault highlighting"
```

---

## Task 13: Web — 失败归因 + 接入容器

**Files:**
- Create: `reports/agent/FailureAttribution.tsx`
- Modify: `reports/AgentReport.tsx` (wire replay + attribution in)
- Test: `reports/agent/FailureAttribution.test.tsx`

**Interfaces:**
- Consumes: `summaryMetrics.data.attribution` (`Record<bucket, fraction>`).

- [ ] **Step 1: Write the failing test**

```tsx
it("renders attribution slices with a one-line conclusion", () => {
  render(<FailureAttribution attribution={{ wrong_action: 0.5, no_completion: 0.3, other: 0.2 }} />);
  expect(screen.getByText(/用错工具|wrong_action/)).toBeInTheDocument();
  expect(screen.getByText(/50%/)).toBeInTheDocument();
  expect(screen.getByText(/最主要/)).toBeInTheDocument(); // one-line conclusion names the top bucket
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — a small pie/bar (dataviz categorical palette) mapping the six bucket keys to human-readable zh labels (`agent_crash`→"崩溃/连续报错", `no_completion`→"多轮未完成", `wrong_action`→"用错工具/参数", `wrong_final_state`→"最终状态错", `missing_info`→"漏告知信息", `other`→"其他"); one-line conclusion picks the max bucket ("失败最主要来自〈label〉,占 XX%"). Since these are deterministic (not LLM), **no "自动分类可能有误" 免责**. Then in `AgentReport.tsx`, wire `<ConversationReplay variant="success" simId={highlights.successSimId} .../>`, `<ConversationReplay variant="failure" simId={highlights.failureSimId} .../>`, and `<FailureAttribution attribution=.../>` below the bars.

- [ ] **Step 4: Run** — PASS; then `pnpm -F @modeldoctor/web build` (typecheck the whole report tree).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/reports/agent/FailureAttribution.tsx apps/web/src/features/benchmarks/reports/agent/FailureAttribution.test.tsx apps/web/src/features/benchmarks/reports/AgentReport.tsx
git commit -m "feat(web): tau2 failure attribution + wire full AgentReport"
```

---

## Task 14: Web — 创建表单接 agent 场景

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx`; add the agent scenario to the sidebar/route list (mirror an existing scenario list page shell, e.g. `BenchmarkInferencePage`)
- Test: `BenchmarkCreatePage` agent-scenario test

**Interfaces:**
- Produces a create request with `scenario:"agent", tool:"tau2"`, params from the chosen tier template (editable): `domains` multiselect, `numTasksPerDomain`, `numTrials`, optional `userSimProviderId`, `gate`.

- [ ] **Step 1: Write the failing test** — select the agent scenario + Standard template, submit, assert the posted body has `scenario:"agent"`, `tool:"tau2"`, `params.numTrials===3`, `params.domains` length 3. Also assert the **tool-call 前置提示** text renders and the **Full 档成本提示** appears when Full is chosen.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — add the agent branch to the scenario-aware create form (mirror how tool params render for other scenarios via `ToolParamsEditor` or a dedicated agent sub-form): domains multiselect (airline/retail/telecom), tier picker bound to the three official templates (selecting a tier fills `numTasksPerDomain`/`numTrials`), a static **前置校验提示**: "被测 endpoint 必须支持 OpenAI 工具调用(function calling),否则评测无意义" near the connection picker, and a cost hint when `numTasksPerDomain === null` (Full): "全量约 N episodes,预计小时级,消耗大量 token"。Use `<ConnectionPicker>` for the target endpoint. Follow the page-form conventions (`<Form>`/`<FormSection>`/`<FormActions>`, breadcrumbs).

- [ ] **Step 4: Run** — PASS; `pnpm -F @modeldoctor/web build`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/benchmarks/BenchmarkCreatePage.tsx apps/web/src/features/benchmarks/BenchmarkInferencePage.tsx apps/web/src/router apps/web/src/features/benchmarks/reports/agent/BenchmarkCreatePage.test.tsx
git commit -m "feat(web): agent scenario create form + list route"
```

---

## Task 15: 端到端冒烟 + 字段实测(手动验证)

**Files:** none (verification task). Uses the **verify** skill.

**Precondition:** a real Connection whose endpoint supports OpenAI tool-calling (e.g. a vLLM served with `--enable-auto-tool-choice` + a tool parser), and a default LlmJudgeProvider configured.

- [ ] **Step 1:** Build + push the tau2 image; ensure `imageForTool('tau2')` resolves to it in the dev/cluster registry.
- [ ] **Step 2:** From the UI, create an **Agent 冒烟(Smoke)** benchmark against the tool-call-capable Connection.
- [ ] **Step 3:** Watch the Job to completion. On any failure, pull `<runId>/stderr.log` from MinIO (per the debugging memo) — the runner exits with tau2's code; the real error is in stderr.log, not the pod log.
- [ ] **Step 4:** Confirm MinIO has `<runId>/files/summary.json` + `results_<domain>` and the detail page renders all four blocks (bars, success replay, failure replay, attribution).
- [ ] **Step 5:** Open one `results.json` and confirm the fields used by the summarizer + replay match reality (`reward_info.reward`, `action_checks[].action_match/tool_type`, `termination_reason`, `messages[]`). If any field name differs from the Global Constraints schema, fix the summarizer/replay and add a regression note — **report the deviation in the turn it's discovered** (plan discipline).
- [ ] **Step 6:** Verify the two endpoints were actually distinct: agent calls hit the Connection, user-sim calls hit the judge provider (check each endpoint's logs / the `info.agent_info.llm_args` vs `info.user_info.llm` in results.json). This is the real proof the `--*-llm-args api_base/api_key` split works end-to-end.

No commit (verification only); record findings, then proceed to finishing-a-development-branch.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- §3 架构总览 → Tasks 1,4,6,8,9 (scenario/tool, buildCommand, adapter, image, service).
- §4.1 adapter + Python 指标下沉 → Tasks 4,6,7.
- §4.2 镜像 → Task 8.
- §4.3 数据模型(复用 Benchmark, summary.json 形状)→ Tasks 2,6,9. **零 migration** honored (no Prisma schema task).
- §4.4 门禁 → Tasks 5,9.
- §4.5 确定性失败归因 → Task 7 (`bucket_failure`) + Task 13 (viz).
- §4.6 AgentReport 四块 → Tasks 11,12,13.
- §4.7 三档模板 → Task 10.
- §5 硬约束:tool-call 前置(Task 14 hint + Task 15 precondition);双密钥注入(Tasks 3,4);成本/时长(`tau2MaxDurationSeconds` Task 4 + Full cost hint Task 14);user-sim 噪声标注(Task 11 label);Python 3.12(Task 8);schema 已实(Global Constraints + Task 15 实测).
- §6 YAGNI:banking/横评/voice/LLM 语义归因 都无对应任务 (correctly out of scope).
- §7 测试 → each task's TDD steps + Task 15 e2e.

**2. Placeholder scan** — no "TBD/TODO/handle edge cases". The few "verify during impl / adjust" notes (tau2 data-dir env name in Task 8; `Action` constructor kwargs in Task 7; service method seams in Task 9) are explicit verification instructions against named source files, not vague fills — acceptable and required by "research before writing".

**3. Type consistency** — `Tau2Report` shape (`overall/perDomain/attribution/highlights/gate`) is identical across schema (Task 2), summarizer output (Task 7), parseFinalReport (Task 6), gate (Task 5), and web (Tasks 11-13). Attribution bucket keys (`agent_crash|no_completion|wrong_action|wrong_final_state|missing_info|other`) match between `bucket_failure` (Task 7) and the web label map (Task 13). Output-file aliases (`summary`, `results_<domain>`) match between buildCommand (Task 4), summarizer path (Task 7), parseFinalReport (Task 6), and replay fetch (Task 12). Secret env names (`MD_AGENT_KEY`/`MD_USER_KEY`) + sentinel token (`__MD_SECRET_<NAME>__`) match between buildCommand (Task 4) and the runner (Task 3).

**Gaps found & closed:** `parseFinalReport` can't see params/baseline (frozen interface) → gate computed in the service (Task 9), not the adapter; documented in Task 6 design note. `assertScenariosInvariant` fails until the adapter is registered → Task 1 test kept narrow; full-package test deferred to Task 6.
