# Test Insights 重构(覆盖矩阵 + 象限散点 + Map 图谱)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Test Insights 从平铺卡片网格重构为「覆盖/健康矩阵(落地)→ 象限/Pareto 散点(点列头)→ 现有详情页(点行/格)」,力导向图谱降为可选 Map 视图。

**Architecture:** 抽出共享评分包 `@modeldoctor/insights-scoring`(纯函数 + 依赖注入的 metric reader),web 与 api 共用;新增 `GET /api/insights/matrix` 批量算 endpoint × 维度成员 的分;新建 `InsightsMatrixPage` 承接入口,旧 `EndpointReportsPage` 退休。

**Tech Stack:** TypeScript, NestJS(api), React + react-router + @tanstack/react-query(web), zod(contracts), echarts / echarts-for-react(散点), react-force-graph-2d(Map), Vitest(单测/e2e), Prisma。

## Global Constraints

- Monorepo pnpm workspace;新包 `packages/insights-scoring`,`"type":"module"`,`private:true`,依赖 `zod` + `@modeldoctor/contracts`(type-only)。
- **api 绝不 import `@modeldoctor/tool-adapters/schemas`**(CI nest build TS2307)。共享评分包**不直接 import 任何 tool-adapters 运行时**;`readMetricSafe` 由调用方注入(web=`@modeldoctor/tool-adapters/schemas` 的 fe 版,api=`@modeldoctor/tool-adapters` 主入口的 registry 版)。
- 详情页 `/insights/:connectionId`(`InsightsDetailPage`)**行为/UI 不变**,只把评分实现换成共享包。
- 新 worktree 首次 e2e/api typecheck 前需 `pnpm -r build`(`packages/*/dist`)。
- 页面遵循 CLAUDE.md「Page layout convention」:路由页首行 `PageHeader`;body `<div className="px-8 py-6 space-y-6">`,不加 `mx-auto`/`max-w-*`;详情/下钻页带 breadcrumbs。
- Conventional commits,显式 `git add <files>`(不 `git add -A`),commit body 结尾 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 契约枚举权威:`scenario` ∈ `[inference,capacity,gateway,lb-strategy,engine-kv-cache,agent]`;`tool` ∈ `[guidellm,vegeta,evalscope,aiperf,tau3]`;`category` ∈ `[chat,audio,embeddings,rerank,image]`。
- v1 评分覆盖 `inference/capacity/gateway`;`agent/lb-strategy/engine-kv-cache` 无 check → 该 (endpoint,dim) `score=null,band=null`,矩阵显灰格「未评分」、散点该带留空。评分扩展 = 紧邻 follow-up(在对应 issue 留 inline 注释)。

---

## 文件结构

**新建**
- `packages/insights-scoring/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- `packages/insights-scoring/src/evaluate.ts` — evaluateSeverity/scenarioScore/compositeScore/axisValue(从 web 移入)
- `packages/insights-scoring/src/descriptors.ts` + `src/checks/{inference,capacity,gateway}.ts` — CheckDescriptor(带 `metricKind`,无 `read` 闭包、无 i18n)
- `packages/insights-scoring/src/findings.ts` — `buildFindingsCore` / `bandFromScore` / `nativeMetric`
- `packages/insights-scoring/src/{evaluate,findings}.spec.ts` — 单测
- `packages/contracts/src/insights/matrix.ts` — matrix 响应 schema
- `apps/api/src/modules/insights/matrix.service.ts` + `matrix.controller.ts` + `matrix.service.spec.ts`
- `apps/web/src/features/insights/InsightsMatrixPage.tsx` + `MatrixGrid.tsx` + `ScatterPanel.tsx` + `ForceMap.tsx`
- `apps/web/src/features/insights/matrix-queries.ts`
- `apps/web/src/features/insights/paretoFrontier.ts` + `paretoFrontier.test.ts`
- `apps/web/src/features/insights/InsightsMatrixPage.test.tsx`

**修改**
- `apps/web/src/features/insights/evaluate.ts`、`buildFindings.ts`、`checks/*.ts`、`checks/descriptors.ts` — 改为 re-export/wrap 共享包
- `packages/contracts/src/insights/index.ts` — 导出 matrix schema
- `apps/api/src/modules/insights/insights.module.ts` — 注册 matrix controller/service
- `apps/web/src/router/index.tsx` — `benchmarks/reports` → `InsightsMatrixPage`
- `apps/web/src/components/sidebar/sidebar-config.tsx` — 入口指向(路径不变)
- `apps/web/src/locales/{en-US,zh-CN}/insights.json` — 矩阵/散点/Map 文案
- `apps/web/package.json` — 加 `react-force-graph-2d`
- `pnpm-workspace.yaml` 无需改(`packages/*` 已 glob)

**删除**
- `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`(退休,末期任务)

---

## Phase 1 — 共享评分包

### Task 1: 抽出纯评分函数到共享包

**Files:**
- Create: `packages/insights-scoring/package.json`
- Create: `packages/insights-scoring/tsconfig.json`, `tsconfig.build.json`
- Create: `packages/insights-scoring/src/index.ts`
- Create: `packages/insights-scoring/src/evaluate.ts`
- Test: `packages/insights-scoring/src/evaluate.spec.ts`

**Interfaces:**
- Produces: `evaluateSeverity(value, {warn,crit}, direction)`, `scenarioScore(findings)`, `compositeScore(perScenario)`, `axisValue(axis, findings)`,type `Direction`。签名与现 `apps/web/.../evaluate.ts` 完全一致。Finding/ScenarioId/RadarAxisId/Severity 从 `@modeldoctor/contracts` type-only import。

- [ ] **Step 1: 写 package.json**(镜像 contracts 包结构,scripts 用相同 build/type-check/lint/test)

```json
{
  "name": "@modeldoctor/insights-scoring",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Shared scoring pure-functions for Test Insights (web + api)",
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./src/index.ts" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" },
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.build.json",
    "type-check": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check src",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": { "@modeldoctor/contracts": "workspace:*" }
}
```

- [ ] **Step 2: 写 tsconfig**(复制 `packages/contracts/tsconfig.json` 与 `tsconfig.build.json`,`outDir: dist`,`rootDir: src`;`build.cjs` 先不做,`main` 指 dist/index.cjs 但 build 仅 esm——api 走 `default: ./src/index.ts` 源码,web 同理 dev,build 产 dist/index.js/.d.ts)。若与 contracts 的 dual esm/cjs 一致更稳,则照抄 contracts 的三条 build 脚本 + `scripts/rename-cjs.mjs`。**执行时:先照抄 contracts 完整 build 配置**(dual output),避免 nest build 解析 cjs 失败。

- [ ] **Step 3: 移入 evaluate.ts**(整段复制现 `apps/web/src/features/insights/evaluate.ts` 1-57 行,唯一改动:import 从相对 `../evaluate` 无——本文件即 evaluate,类型 import 保持 `@modeldoctor/contracts`)

- [ ] **Step 4: index.ts re-export**

```ts
export * from "./evaluate.js";
```

- [ ] **Step 5: 写失败单测** `evaluate.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Finding } from "@modeldoctor/contracts";
import { compositeScore, evaluateSeverity, scenarioScore } from "./evaluate.js";

const f = (severity: Finding["severity"], weight: number): Finding => ({
  checkId: "x", scenario: "inference", axis: "responsiveness",
  severity, value: 1, threshold: { warn: 0, crit: 0 }, weight,
  recommendation: "", contributingRunIds: [],
});

describe("evaluateSeverity", () => {
  it("lower_is_better crosses warn/crit", () => {
    expect(evaluateSeverity(5, { warn: 10, crit: 20 }, "lower_is_better")).toBe("good");
    expect(evaluateSeverity(15, { warn: 10, crit: 20 }, "lower_is_better")).toBe("warn");
    expect(evaluateSeverity(25, { warn: 10, crit: 20 }, "lower_is_better")).toBe("crit");
    expect(evaluateSeverity(null, { warn: 10, crit: 20 }, "lower_is_better")).toBe("no_data");
  });
});
describe("scenarioScore", () => {
  it("weights good=1 warn=.5 crit=0 → 0-100", () => {
    expect(scenarioScore([f("good", 1), f("crit", 1)])).toBe(50);
    expect(scenarioScore([f("no_data", 1)])).toBeNull();
  });
});
describe("compositeScore", () => {
  it("averages present sub-scores", () => {
    expect(compositeScore({ inference: 80, capacity: 60, gateway: null } as never)).toBe(70);
  });
});
```

- [ ] **Step 6: 跑测确认通过**
Run: `pnpm -F @modeldoctor/insights-scoring test`
Expected: PASS(3 describe 全绿)

- [ ] **Step 7: build 出 dist**(供 api 消费)
Run: `pnpm -F @modeldoctor/insights-scoring build && ls packages/insights-scoring/dist`
Expected: 出 `index.js` `index.d.ts`(及 cjs 若配)

- [ ] **Step 8: Commit**
```bash
git add packages/insights-scoring
git commit -m "feat(insights-scoring): scaffold shared scoring package with pure evaluate fns"
```

---

### Task 2: 移入 check descriptors(metricKind 化,去 i18n / 去 read 闭包)

**Files:**
- Create: `packages/insights-scoring/src/descriptors.ts`
- Create: `packages/insights-scoring/src/checks/{inference,capacity,gateway}.ts`
- Test: `packages/insights-scoring/src/descriptors.spec.ts`

**Interfaces:**
- Produces: `interface CheckDescriptor { id; scenario: ScenarioId; toolFilter?: BenchmarkTool[]; axis: RadarAxisId; defaultWeight: number; direction: Direction; metricKind: MetricKind }`;`ALL_CHECKS: CheckDescriptor[]`;`getCheck(id)`。`MetricKind = Parameters<typeof import("@modeldoctor/tool-adapters").readMetricSafe>[0]`——**type-only** import(不引入运行时)。
- **关键差异 vs 现 web 版**:去掉 `read` 闭包与 `recommendationKey`,新增 `metricKind: MetricKind`(值 = 原 `read("<kind>")` 的 kind 字符串,如 `"ttft.p95"`)。

- [ ] **Step 1: 确认 MetricKind 可 type-only 从主入口取**
Run: `grep -n "MetricKind\|readMetricSafe" packages/tool-adapters/src/index.ts`
Expected: 若主入口未导出 `MetricKind` 类型,则在 `packages/tool-adapters/src/index.ts` 加 `export type { MetricKind } from "./core/read-metric-safe.runtime.js";`(或其定义处),build tool-adapters 后再继续。**在本步 report 是否需要补该 export**。

- [ ] **Step 2: 写 descriptors.ts**

```ts
import type { BenchmarkTool, RadarAxisId, ScenarioId } from "@modeldoctor/contracts";
import type { MetricKind } from "@modeldoctor/tool-adapters";
import type { Direction } from "./evaluate.js";
import { capacityChecks } from "./checks/capacity.js";
import { gatewayChecks } from "./checks/gateway.js";
import { inferenceChecks } from "./checks/inference.js";

export interface CheckDescriptor {
  id: string;
  scenario: ScenarioId;
  toolFilter?: BenchmarkTool[];
  axis: RadarAxisId;
  defaultWeight: number;
  direction: Direction;
  metricKind: MetricKind;
}

export const ALL_CHECKS: CheckDescriptor[] = [
  ...inferenceChecks, ...capacityChecks, ...gatewayChecks,
];
const byId = new Map(ALL_CHECKS.map((c) => [c.id, c]));
export function getCheck(id: string): CheckDescriptor | undefined { return byId.get(id); }
```

- [ ] **Step 3: 移入三个 checks 文件**,把每条 `read: read("<kind>")` 换成 `metricKind: "<kind>"`,删 `recommendationKey`。示例(inference.ts 第一条):

```ts
import type { CheckDescriptor } from "../descriptors.js";
export const inferenceChecks: CheckDescriptor[] = [
  { id: "inference.ttft.p95.ms", scenario: "inference", toolFilter: ["guidellm","evalscope","aiperf"],
    axis: "responsiveness", defaultWeight: 1.0, direction: "lower_is_better", metricKind: "ttft.p95" },
  // …逐条照搬现 web/checks/inference.ts,read("X")→metricKind:"X",删 recommendationKey
];
```
(capacity.ts / gateway.ts 同法照搬现 `apps/web/src/features/insights/checks/*.ts`。)

- [ ] **Step 4: index.ts 追加 export**
```ts
export * from "./descriptors.js";
```

- [ ] **Step 5: 写单测** `descriptors.spec.ts`
```ts
import { describe, expect, it } from "vitest";
import { ALL_CHECKS, getCheck } from "./descriptors.js";
describe("descriptors", () => {
  it("all checks have metricKind and known scenario", () => {
    expect(ALL_CHECKS.length).toBeGreaterThan(0);
    for (const c of ALL_CHECKS) {
      expect(c.metricKind).toBeTruthy();
      expect(["inference","capacity","gateway"]).toContain(c.scenario);
    }
  });
  it("getCheck resolves by id", () => {
    expect(getCheck("inference.ttft.p95.ms")?.axis).toBe("responsiveness");
  });
});
```

- [ ] **Step 6: 跑测 + build**
Run: `pnpm -F @modeldoctor/insights-scoring test && pnpm -F @modeldoctor/insights-scoring build`
Expected: PASS

- [ ] **Step 7: Commit**
```bash
git add packages/insights-scoring/src
git commit -m "feat(insights-scoring): move check descriptors, metricKind-based (no i18n, no read closure)"
```

---

### Task 3: buildFindingsCore(注入 reader)+ bandFromScore + nativeMetric

**Files:**
- Create: `packages/insights-scoring/src/findings.ts`
- Test: `packages/insights-scoring/src/findings.spec.ts`

**Interfaces:**
- Consumes: Task 1 `evaluateSeverity/scenarioScore`,Task 2 `ALL_CHECKS/CheckDescriptor`。
- Produces:
  - `type MetricReader = (kind: MetricKind, metrics: unknown) => number | null`
  - `type RunLike = { id: string; scenario: string; status: string; tool: string; summaryMetrics: unknown }`
  - `buildFindingsCore(runs: RunLike[], rules: ProfileRules, read: MetricReader): Finding[]` — 与 web `buildFindings` 同逻辑,但 `recommendation:""`(i18n 由 web 端补),`read` 注入。
  - `bandFromScore(score: number | null): "recommended" | "usable" | "not-recommended" | null` — 阈值:`>=85 recommended`,`>=60 usable`,`<60 not-recommended`,`null→null`(与详情页 `severityClass` 同档)。
  - `nativeMetric(scenario, runs, read): { kind: MetricKind; value: number } | null` — 取该场景「代表指标」中位数:inference/capacity→`e2e.p95`(ms),gateway→`e2e.p95`;缺失返回 null。(agent 等无 check 场景在 Task6 单独取 pass^1。)

- [ ] **Step 1: 写失败单测** `findings.spec.ts`

```ts
import { describe, expect, it } from "vitest";
import type { ProfileRules } from "@modeldoctor/contracts";
import { bandFromScore, buildFindingsCore, type RunLike } from "./findings.js";

const rules: ProfileRules = { checks: { "inference.ttft.p95.ms": { warn: 100, crit: 300, weight: 1 } } };
const run = (metrics: unknown): RunLike => ({ id: "r1", scenario: "inference", status: "completed", tool: "guidellm", summaryMetrics: metrics });
// reader that returns a fixed ttft.p95
const reader = (_k: unknown, _m: unknown) => 50; // good (<100)

describe("buildFindingsCore", () => {
  it("scores good when metric under warn", () => {
    const findings = buildFindingsCore([run({})], rules, reader as never);
    const ttft = findings.find((f) => f.checkId === "inference.ttft.p95.ms");
    expect(ttft?.severity).toBe("good");
    expect(ttft?.recommendation).toBe("");
  });
});
describe("bandFromScore", () => {
  it("bands by threshold", () => {
    expect(bandFromScore(90)).toBe("recommended");
    expect(bandFromScore(70)).toBe("usable");
    expect(bandFromScore(40)).toBe("not-recommended");
    expect(bandFromScore(null)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测确认失败**
Run: `pnpm -F @modeldoctor/insights-scoring test`
Expected: FAIL(找不到 `./findings.js`)

- [ ] **Step 3: 实现 findings.ts**

```ts
import type { Finding, ProfileRules } from "@modeldoctor/contracts";
import type { MetricKind } from "@modeldoctor/tool-adapters";
import { ALL_CHECKS } from "./descriptors.js";
import { evaluateSeverity } from "./evaluate.js";

export type MetricReader = (kind: MetricKind, metrics: unknown) => number | null;
export type RunLike = { id: string; scenario: string; status: string; tool: string; summaryMetrics: unknown };

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(kind: MetricKind, scenario: string, toolFilter: string[] | undefined, runs: RunLike[], read: MetricReader) {
  const matched = runs.filter((r) => r.scenario === scenario && r.status === "completed" && (!toolFilter || toolFilter.includes(r.tool)));
  const samples: { id: string; v: number }[] = [];
  for (const r of matched) { const v = read(kind, r.summaryMetrics); if (v !== null) samples.push({ id: r.id, v }); }
  if (samples.length === 0) return { value: null as number | null, ids: [] as string[] };
  return { value: median(samples.map((s) => s.v)), ids: samples.map((s) => s.id) };
}

export function buildFindingsCore(runs: RunLike[], rules: ProfileRules, read: MetricReader): Finding[] {
  const out: Finding[] = [];
  for (const check of ALL_CHECKS) {
    const rule = rules.checks[check.id];
    const { value, ids } = aggregate(check.metricKind, check.scenario, check.toolFilter, runs, read);
    out.push({
      checkId: check.id, scenario: check.scenario, axis: check.axis,
      severity: rule ? evaluateSeverity(value, rule, check.direction) : "no_data",
      value, threshold: rule ?? { warn: 0, crit: 0 }, weight: rule?.weight ?? check.defaultWeight,
      recommendation: "", contributingRunIds: ids,
    });
  }
  return out;
}

export function bandFromScore(score: number | null) {
  if (score == null) return null;
  if (score >= 85) return "recommended" as const;
  if (score >= 60) return "usable" as const;
  return "not-recommended" as const;
}

export function nativeMetric(scenario: string, runs: RunLike[], read: MetricReader): { kind: MetricKind; value: number } | null {
  const kind: MetricKind = "e2e.p95";
  const { value } = aggregate(kind, scenario, undefined, runs, read);
  return value == null ? null : { kind, value };
}
```

- [ ] **Step 4: index.ts 追加 export** `export * from "./findings.js";`

- [ ] **Step 5: 跑测 + build**
Run: `pnpm -F @modeldoctor/insights-scoring test && pnpm -F @modeldoctor/insights-scoring build`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add packages/insights-scoring/src
git commit -m "feat(insights-scoring): buildFindingsCore(reader-injected) + bandFromScore + nativeMetric"
```

---

### Task 4: 前端改用共享包(详情页行为不变)

**Files:**
- Modify: `apps/web/src/features/insights/evaluate.ts`
- Modify: `apps/web/src/features/insights/buildFindings.ts`
- Modify: `apps/web/src/features/insights/checks/{descriptors,inference,capacity,gateway}.ts`
- Modify: `apps/web/package.json`(加 `"@modeldoctor/insights-scoring": "workspace:*"`)
- Test(既有,须保持绿): `apps/web/src/features/insights/__tests__/*`

**Interfaces:**
- Consumes: 共享包 `evaluateSeverity/scenarioScore/compositeScore/axisValue/buildFindingsCore/ALL_CHECKS/CheckDescriptor/MetricReader`。
- Produces: web `buildFindings(runs, rules)` 签名**不变**(内部注入 fe reader + 补 i18n recommendation)。

- [ ] **Step 1: web `evaluate.ts` 变纯 re-export**
```ts
export { evaluateSeverity, scenarioScore, compositeScore, axisValue } from "@modeldoctor/insights-scoring";
export type { Direction } from "@modeldoctor/insights-scoring";
```

- [ ] **Step 2: web `checks/*` 与 `descriptors.ts` 删除**(逻辑已入共享包);`descriptors.ts` 改为薄封装,给现有 recommendationKey 建映射表(供 i18n):
```ts
import { ALL_CHECKS as CORE_CHECKS, getCheck } from "@modeldoctor/insights-scoring";
export { getCheck };
export const ALL_CHECKS = CORE_CHECKS;
// checkId → i18n recommendation key(逐条列出,从旧 checks/*.ts 迁移过来)
export const RECOMMENDATION_KEY: Record<string, string> = {
  "inference.ttft.p95.ms": "checks.inference.ttft.p95.ms.recommendation",
  // …其余 check 全列
};
```

- [ ] **Step 3: web `buildFindings.ts` 用共享 core + fe reader + 补 i18n**
```ts
import type { Benchmark, Finding, ProfileRules } from "@modeldoctor/contracts";
import { buildFindingsCore, type RunLike } from "@modeldoctor/insights-scoring";
import { readMetricSafe } from "@modeldoctor/tool-adapters/schemas";
import i18n from "@/lib/i18n";
import { RECOMMENDATION_KEY } from "./checks/descriptors";

const feReader = (kind: Parameters<typeof readMetricSafe>[0], m: unknown) =>
  readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);

export function buildFindings(runs: Benchmark[], profile: ProfileRules): Finding[] {
  const core = buildFindingsCore(runs as unknown as RunLike[], profile, feReader as never);
  return core.map((f) => ({
    ...f,
    recommendation: i18n.t(RECOMMENDATION_KEY[f.checkId] ?? "", { ns: "insights", defaultValue: "" }),
  }));
}
export { aggregateCheck, aggregateCheckDetailed } from "./buildFindings.legacy"; // 若他处用到,否则删
```
(执行时 grep `aggregateCheck` 使用点;无外部使用则不导出、删 legacy 引用。)

- [ ] **Step 4: 装 workspace 依赖**
Run: `pnpm install`
Expected: `@modeldoctor/insights-scoring` linked 进 web/api node_modules

- [ ] **Step 5: 跑详情页既有测试(回归)**
Run: `pnpm -F @modeldoctor/web test -- insights`
Expected: PASS(composite/subscore/findings 与旧实现一致)

- [ ] **Step 6: typecheck web**
Run: `pnpm -F @modeldoctor/web type-check`
Expected: 0 error

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/features/insights apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(insights): detail page scoring backed by shared @modeldoctor/insights-scoring (behavior unchanged)"
```

---

## Phase 2 — 契约

### Task 5: matrix 响应 schema

**Files:**
- Create: `packages/contracts/src/insights/matrix.ts`
- Modify: `packages/contracts/src/insights/index.ts`(加 `export * from "./matrix.js";`)
- Test: `packages/contracts/src/insights/matrix.spec.ts`

**Interfaces:**
- Produces: `matrixAggregateSchema = z.enum(["scenario","tool","engine"])`;`insightsMatrixResponseSchema`;类型 `InsightsMatrixResponse`,`MatrixCell`,`MatrixDimension`,`MatrixEndpoint`,`MatrixBand = z.enum(["recommended","usable","not-recommended"])`。

- [ ] **Step 1: 写 schema**
```ts
import { z } from "zod";
import { endpointReportRangeSchema } from "../benchmark.js";
import { modalityCategorySchema } from "../modality.js";

export const matrixAggregateSchema = z.enum(["scenario", "tool", "engine"]);
export type MatrixAggregate = z.infer<typeof matrixAggregateSchema>;
export const matrixBandSchema = z.enum(["recommended", "usable", "not-recommended"]);
export type MatrixBand = z.infer<typeof matrixBandSchema>;

export const matrixDimensionSchema = z.object({ key: z.string(), label: z.string(), count: z.number().int() });
export const matrixEndpointSchema = z.object({
  id: z.string(), name: z.string(), model: z.string(), baseUrl: z.string(),
  category: modalityCategorySchema, serverKind: z.string().nullable(),
});
export const matrixCellSchema = z.object({
  endpointId: z.string(), dimKey: z.string(), runs: z.number().int(),
  score: z.number().nullable(), band: matrixBandSchema.nullable(),
  nativeMetric: z.object({ kind: z.string(), value: z.number(), unit: z.string() }).nullable(),
});
export const insightsMatrixResponseSchema = z.object({
  aggregate: matrixAggregateSchema,
  range: endpointReportRangeSchema,
  generatedAt: z.string().datetime(),
  dimensions: z.array(matrixDimensionSchema),
  endpoints: z.array(matrixEndpointSchema),
  cells: z.array(matrixCellSchema),
});
export type InsightsMatrixResponse = z.infer<typeof insightsMatrixResponseSchema>;
export type MatrixCell = z.infer<typeof matrixCellSchema>;
export type MatrixDimension = z.infer<typeof matrixDimensionSchema>;
export type MatrixEndpoint = z.infer<typeof matrixEndpointSchema>;
```
(执行时确认 `modality.ts` 导出名为 `modalityCategorySchema`;若为 `ModalityCategorySchema` 用之。)

- [ ] **Step 2: 单测(round-trip)**
```ts
import { describe, expect, it } from "vitest";
import { insightsMatrixResponseSchema } from "./matrix.js";
describe("matrix schema", () => {
  it("parses a minimal valid payload", () => {
    const r = insightsMatrixResponseSchema.parse({
      aggregate: "scenario", range: "30d", generatedAt: new Date(0).toISOString(),
      dimensions: [{ key: "inference", label: "Inference", count: 3 }],
      endpoints: [{ id: "c1", name: "n", model: "m", baseUrl: "http://x", category: "chat", serverKind: "vllm" }],
      cells: [{ endpointId: "c1", dimKey: "inference", runs: 3, score: 80, band: "usable", nativeMetric: { kind: "e2e.p95", value: 1200, unit: "ms" } }],
    });
    expect(r.cells[0].band).toBe("usable");
  });
});
```

- [ ] **Step 3: 跑测 + build contracts**
Run: `pnpm -F @modeldoctor/contracts test && pnpm -F @modeldoctor/contracts build`
Expected: PASS

- [ ] **Step 4: Commit**
```bash
git add packages/contracts/src/insights
git commit -m "feat(contracts): insights matrix response schema"
```

---

## Phase 3 — API

### Task 6: matrix service(批量算分)

**Files:**
- Create: `apps/api/src/modules/insights/matrix.service.ts`
- Test: `apps/api/src/modules/insights/matrix.service.spec.ts`

**Interfaces:**
- Consumes: `BenchmarkRepo`(或复用 `getByConnectionReports` 用的 `this.repo.list({userId,createdAfter,limit})`)、`PrismaService`、`EvaluationProfileService`(取 profile.rules)、共享包 `buildFindingsCore/scenarioScore/bandFromScore/nativeMetric`、`readMetricSafe`(主入口)。
- Produces: `class MatrixService { getMatrix(userId, { aggregate, range, profileSlug }): Promise<InsightsMatrixResponse> }`。
- **reader 注入**:`const apiReader = (kind, m) => readMetricSafe(kind, m as {tool?:unknown;data?:unknown}|null)`(主入口 registry 版)。

**分维度取列(dimKey)逻辑:**
- `aggregate=scenario`:dimKey = run.scenario;label 用 i18n scenario 名(api 无 i18n → 返回 raw key,web 端翻译)。
- `aggregate=tool`:dimKey = run.tool。
- `aggregate=engine`:dimKey = connection.serverKind ?? "unknown"。

**cell 算分逻辑(每 endpoint × dimKey):**
- 该分组 runs → 若 `aggregate=scenario` 且 dimKey ∈ 有 check 的场景(inference/capacity/gateway):`scenarioScore(buildFindingsCore(runs, rules, apiReader).filter(f=>f.scenario===dimKey))`;否则(tool/engine 聚合,或无 check 场景):**按该组内所有 run 的 scenario 分别算子分再平均**——统一实现:对 group runs 调 `buildFindingsCore` → 得 findings → `scenarioScore(findings)`(全体加权,跨场景),`score=null` 当无任何 scored finding(如全是 agent runs)。
- `band = bandFromScore(score)`;`runs = group.length`;`nativeMetric = nativeMetric(dimKey或"inference", groupRuns, apiReader)`→ `{kind, value, unit:"ms"}`(kind 决定 unit:`*.p95/e2e.*`→"ms";后续 pass^1→"%")。

- [ ] **Step 1: 写失败单测**(用假 runs;mock repo/prisma/profile)
```ts
import { describe, expect, it, vi } from "vitest";
import { MatrixService } from "./matrix.service";

const rules = { checks: { "inference.ttft.p95.ms": { warn: 100, crit: 300, weight: 1 } } };
function svc() {
  const repo = { list: vi.fn().mockResolvedValue({ items: [
    { id: "r1", scenario: "inference", status: "completed", tool: "guidellm",
      summaryMetrics: { tool: "guidellm", data: {} },
      createdAt: new Date(), connection: { id: "c1", name: "n", model: "m", baseUrl: "http://x", serverKind: "vllm" } },
  ] }) };
  const prisma = { connection: { findMany: vi.fn().mockResolvedValue([{ id: "c1", category: "chat" }]) } };
  const profiles = { getRulesBySlug: vi.fn().mockResolvedValue(rules) };
  return new MatrixService(repo as never, prisma as never, profiles as never);
}
describe("MatrixService.getMatrix", () => {
  it("returns one endpoint × one scenario dim with a cell", async () => {
    const res = await svc().getMatrix("u1", { aggregate: "scenario", range: "30d", profileSlug: "default" });
    expect(res.aggregate).toBe("scenario");
    expect(res.endpoints).toHaveLength(1);
    expect(res.dimensions.map((d) => d.key)).toContain("inference");
    const cell = res.cells.find((c) => c.endpointId === "c1" && c.dimKey === "inference");
    expect(cell?.runs).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测确认失败**
Run: `pnpm -F @modeldoctor/api test -- matrix.service`
Expected: FAIL(MatrixService 未定义)

- [ ] **Step 3: 实现 matrix.service.ts**(NestJS `@Injectable`;取数骨架照抄 `getByConnectionReports` 的 repo.list + category 批量;分组 by connection→再 by dimKey)。核心:
```ts
import { Injectable } from "@nestjs/common";
import type { InsightsMatrixResponse, MatrixAggregate, EndpointReportRange } from "@modeldoctor/contracts";
import { buildFindingsCore, scenarioScore, bandFromScore, nativeMetric, type RunLike } from "@modeldoctor/insights-scoring";
import { readMetricSafe } from "@modeldoctor/tool-adapters";
// … constructor(repo, prisma, profiles)
const apiReader = (kind: Parameters<typeof readMetricSafe>[0], m: unknown) =>
  readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);
// getMatrix: days from range → repo.list → group by connection.id → per group, dimKey by aggregate →
//   per (endpoint,dimKey): findings = buildFindingsCore(runs, rules, apiReader);
//   score = scenarioScore(aggregate==="scenario" ? findings.filter(f=>f.scenario===dimKey) : findings);
//   band = bandFromScore(score); nm = nativeMetric(dimKey OR "inference", runs, apiReader);
//   push cell { endpointId, dimKey, runs: runs.length, score, band, nativeMetric: nm && {kind:nm.kind, value:nm.value, unit:"ms"} };
// dimensions = unique dimKeys with count = distinct endpoints; endpoints = unique connections (+category from prisma batch)
```
(完整实现照 interface 描述展开;`RunLike` 由 prisma row 结构上满足——`scenario/status/tool/summaryMetrics/id` 字段名一致。)

- [ ] **Step 4: 跑测通过**
Run: `pnpm -F @modeldoctor/api test -- matrix.service`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/insights/matrix.service.ts apps/api/src/modules/insights/matrix.service.spec.ts
git commit -m "feat(api/insights): matrix service — batch score endpoint×dimension"
```

---

### Task 7: matrix controller + 注册 + e2e

**Files:**
- Create: `apps/api/src/modules/insights/matrix.controller.ts`
- Modify: `apps/api/src/modules/insights/insights.module.ts`
- Test: `apps/api/test/e2e/insights-matrix.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/insights/matrix?aggregate=&range=&profile=` → `InsightsMatrixResponse`;scoped `user.sub`;zod-validate query(`matrixAggregateSchema` default `"scenario"`,`endpointReportRangeSchema` default `"30d"`,`profile` optional string)。

- [ ] **Step 1: 写 controller**(参考 `evaluation-profile.controller.ts` + `benchmark.controller.ts:74` 的 `@Get` + zod pipe 模式)
```ts
@Controller("insights")
export class MatrixController {
  constructor(private readonly matrix: MatrixService) {}
  @Get("matrix")
  async getMatrix(@CurrentUser() user: JwtUser,
    @Query("aggregate", new ZodQueryPipe(matrixAggregateSchema.default("scenario"))) aggregate: MatrixAggregate,
    @Query("range", new ZodQueryPipe(endpointReportRangeSchema.default("30d"))) range: EndpointReportRange,
    @Query("profile") profile?: string,
  ): Promise<InsightsMatrixResponse> {
    return this.matrix.getMatrix(user.sub, { aggregate, range, profileSlug: profile ?? "default" });
  }
}
```
(用仓库既有的 query 校验管道/装饰器名;执行时对齐 `benchmark.controller.ts` 的确切写法。)

- [ ] **Step 2: 注册进 insights.module.ts** controllers/providers 数组加 `MatrixController` / `MatrixService`。

- [ ] **Step 3: 写 e2e**(参考既有 `apps/api/test/e2e/*.e2e-spec.ts`:seed 一个 connection + 一条 completed benchmark,GET matrix 断言 200 + cells 结构)

- [ ] **Step 4: 跑 api typecheck + e2e**
Run: `pnpm -r build && pnpm -F @modeldoctor/api type-check && pnpm test:e2e:api -- insights-matrix`
Expected: 200,响应 zod-parse 通过
(`pnpm -r build` 必要:api nest build 需 insights-scoring/contracts 的 dist。)

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/insights/matrix.controller.ts apps/api/src/modules/insights/insights.module.ts apps/api/test/e2e/insights-matrix.e2e-spec.ts
git commit -m "feat(api/insights): GET /api/insights/matrix controller + e2e"
```

---

## Phase 4 — 前端矩阵

### Task 8: matrix query hook

**Files:**
- Create: `apps/web/src/features/insights/matrix-queries.ts`

**Interfaces:**
- Produces: `useInsightsMatrix({ aggregate, range, profile }) => UseQueryResult<InsightsMatrixResponse>`;queryKey `["insights-matrix", aggregate, range, profile]`;`api.get("/api/insights/matrix?…")`。

- [ ] **Step 1: 写 hook**
```ts
import type { InsightsMatrixResponse, MatrixAggregate, EndpointReportRange } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
export function useInsightsMatrix(p: { aggregate: MatrixAggregate; range: EndpointReportRange; profile: string | null }) {
  const qs = new URLSearchParams({ aggregate: p.aggregate, range: p.range });
  if (p.profile) qs.set("profile", p.profile);
  return useQuery<InsightsMatrixResponse>({
    queryKey: ["insights-matrix", p.aggregate, p.range, p.profile],
    queryFn: () => api.get<InsightsMatrixResponse>(`/api/insights/matrix?${qs.toString()}`),
  });
}
```

- [ ] **Step 2: typecheck**
Run: `pnpm -F @modeldoctor/web type-check`
Expected: 0 error

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/features/insights/matrix-queries.ts
git commit -m "feat(web/insights): useInsightsMatrix query hook"
```

---

### Task 9: InsightsMatrixPage 骨架 + 聚合 Tab + 过滤 + 矩阵网格

**Files:**
- Create: `apps/web/src/features/insights/InsightsMatrixPage.tsx`
- Create: `apps/web/src/features/insights/MatrixGrid.tsx`
- Test: `apps/web/src/features/insights/InsightsMatrixPage.test.tsx`

**Interfaces:**
- Consumes: Task8 hook、`useEvaluationProfiles`、`PageHeader`。
- Produces: 页面组件(default export via router)。URL search-params:`aggregate`(default scenario)、`range`(default 30d)、`profile`、`q`、`category`。`MatrixGrid` props:`{ data: InsightsMatrixResponse; onCellClick(endpointId, dimKey); onDimClick(dimKey); onRowClick(endpointId) }`。

**布局(遵循 CLAUDE.md):** `<PageHeader title subtitle />`(无 breadcrumbs,顶级页)+ `<div className="px-8 py-6 space-y-6">`:第一行工具条(聚合 Tab via shadcn Tabs/或按钮组 + 搜索 + category Select + range Select + ProfileSelector + Map toggle),下面 `<MatrixGrid>`。

- [ ] **Step 1: 写组件测试(失败)**
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
// mock useInsightsMatrix → 1 endpoint × 1 scenario,1 usable cell
// mock useEvaluationProfiles → { items: [] }
// render <InsightsMatrixPage/> within MemoryRouter + QueryClientProvider + i18n
describe("InsightsMatrixPage", () => {
  it("renders endpoint row and scenario column header", async () => {
    // …setup mocks
    render(/* … */);
    expect(await screen.findByText("m")).toBeInTheDocument(); // model name row
    expect(screen.getByRole("columnheader", { name: /inference/i })).toBeInTheDocument();
  });
});
```
(参照现有 `__tests__` setup 里 QueryClient/i18n/Router wrapper 工厂。)

- [ ] **Step 2: 跑测确认失败**
Run: `pnpm -F @modeldoctor/web test -- InsightsMatrixPage`
Expected: FAIL

- [ ] **Step 3: 实现 MatrixGrid.tsx**(`<table>`,首列 endpoint = `<Link to="/insights/{id}">model</Link>`(遵循列表页 action 惯例),列头 = dimensions(可点 → onDimClick),格 = cell:有 score 用色块(emerald/amber/rose 三档,对齐 `severityClass`)+ 角标 runs;无 cell 留白;score=null 灰「—」。悬停 title = nativeMetric + band。`overflow-x:auto` 包裹防止横向溢出。)

- [ ] **Step 4: 实现 InsightsMatrixPage.tsx**(search-params 状态 + 工具条 + client 端 `q`/`category` 过滤 endpoints;Map toggle 先占位 boolean,Task14 接 ForceMap)。

- [ ] **Step 5: 跑测通过 + typecheck**
Run: `pnpm -F @modeldoctor/web test -- InsightsMatrixPage && pnpm -F @modeldoctor/web type-check`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/features/insights/InsightsMatrixPage.tsx apps/web/src/features/insights/MatrixGrid.tsx apps/web/src/features/insights/InsightsMatrixPage.test.tsx
git commit -m "feat(web/insights): matrix page — aggregation tabs + coverage/health grid"
```

---

## Phase 5 — 象限散点

### Task 10: Pareto 前沿工具函数

**Files:**
- Create: `apps/web/src/features/insights/paretoFrontier.ts`
- Test: `apps/web/src/features/insights/paretoFrontier.test.ts`

**Interfaces:**
- Produces: `paretoFrontier(points: {id:string;x:number;y:number}[], opts?:{xBetter?:"higher"|"lower"; yBetter?:"higher"|"lower"}): Set<string>` — 返回处于前沿的 point id。默认 x 越高越好(score)、y 越低越好(延迟)。

- [ ] **Step 1: 写失败单测**
```ts
import { describe, expect, it } from "vitest";
import { paretoFrontier } from "./paretoFrontier";
describe("paretoFrontier", () => {
  it("keeps non-dominated points (x higher better, y lower better)", () => {
    // A(90,100) dominates B(80,120); C(70,50) non-dominated (lower y)
    const front = paretoFrontier([
      { id: "A", x: 90, y: 100 }, { id: "B", x: 80, y: 120 }, { id: "C", x: 70, y: 50 },
    ]);
    expect(front.has("A")).toBe(true);
    expect(front.has("C")).toBe(true);
    expect(front.has("B")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测失败 → 实现 → 跑测通过**
Run: `pnpm -F @modeldoctor/web test -- paretoFrontier`
实现:O(n²) 支配判定(点 p 被 q 支配 iff q 在两轴都不差且至少一轴更优)。

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/features/insights/paretoFrontier.ts apps/web/src/features/insights/paretoFrontier.test.ts
git commit -m "feat(web/insights): pareto frontier util for quadrant scatter"
```

---

### Task 11: ScatterPanel(echarts 象限散点)+ 接列头点击

**Files:**
- Create: `apps/web/src/features/insights/ScatterPanel.tsx`
- Modify: `apps/web/src/features/insights/InsightsMatrixPage.tsx`(dimClick → 打开 ScatterPanel)

**Interfaces:**
- Consumes: `paretoFrontier`、`echarts-for-react`、matrix `cells`(过滤 dimKey)、matrix `endpoints`。
- Produces: `ScatterPanel({ dimKey, dimLabel, data, onClose, onPointClick(endpointId) })`。X=score(0-100,三色 markArea:0-60 rose / 60-85 amber / 85-100 emerald)、Y=nativeMetric.value(ms;无则 y=jitter 常量退化 1D)。前沿点加大/描边。点击点 → `onPointClick` → navigate `/insights/:id`。

- [ ] **Step 1: 实现 ScatterPanel**(右侧 shadcn Sheet 或同页 Card 面板;echarts option:`series[0].type="scatter"`,`markArea` 画推荐带,`markLine` 画前沿连线,`tooltip.formatter` 显 endpoint name + score + native 指标 + band。数据点 = 该 dimKey 有 cell 的 endpoints;`score==null` 的点归入「未评分」区不参与前沿。)

- [ ] **Step 2: InsightsMatrixPage 接 onDimClick**(state 存 selectedDimKey;渲染 `<ScatterPanel>`;onPointClick → `navigate(/insights/${id}?range=${range})`)。

- [ ] **Step 3: 加最小渲染测试**(mock echarts-for-react 为 `<div data-testid="scatter"/>`,点列头后断言出现)。
Run: `pnpm -F @modeldoctor/web test -- InsightsMatrixPage`
Expected: PASS

- [ ] **Step 4: typecheck + Commit**
```bash
git add apps/web/src/features/insights/ScatterPanel.tsx apps/web/src/features/insights/InsightsMatrixPage.tsx
git commit -m "feat(web/insights): quadrant scatter panel with pareto frontier + recommendation bands"
```

---

## Phase 6 — Map 图谱视图

### Task 12: 加 react-force-graph 依赖 + ForceMap 组件

**Files:**
- Modify: `apps/web/package.json`(加 `"react-force-graph-2d"`)
- Create: `apps/web/src/features/insights/ForceMap.tsx`

**Interfaces:**
- Consumes: matrix `dimensions/endpoints/cells`。
- Produces: `ForceMap({ data, onNodeClick(endpointId) })` — 二部图:中心=dimension 节点,外围=endpoint 节点(色=score 三档/灰,径 ∝ Σruns),边=cell(宽 ∝ runs)。点 endpoint 节点 → onNodeClick。

- [ ] **Step 1: 装依赖**(计划已指定,授权范围内)
Run: `pnpm -F @modeldoctor/web add react-force-graph-2d`
Expected: 写入 package.json + lockfile

- [ ] **Step 2: 实现 ForceMap**(`graphData = { nodes: [...dims(kind:"dim"), ...endpoints(kind:"ep",val:score)], links: cells.map(c=>({source:c.dimKey, target:c.endpointId, value:c.runs})) }`;`nodeCanvasObject` 自绘颜色/半径/标签;`onNodeClick(n)=> n.kind==="ep" && onNodeClick(n.id)`。SSR/测试环境 mock。)

- [ ] **Step 3: typecheck + Commit**
```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/insights/ForceMap.tsx
git commit -m "feat(web/insights): force-directed bipartite Map view"
```

---

### Task 13: Map toggle 接线

**Files:**
- Modify: `apps/web/src/features/insights/InsightsMatrixPage.tsx`

- [ ] **Step 1: 工具条 Map/矩阵切换**(`view` search-param: `"grid"|"map"`,default grid;view==="map" 渲染 `<ForceMap data onNodeClick={(id)=>navigate(/insights/${id})} />`,否则 `<MatrixGrid>`)。

- [ ] **Step 2: 渲染测试**(mock react-force-graph-2d;切到 map 断言容器出现)。
Run: `pnpm -F @modeldoctor/web test -- InsightsMatrixPage`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/features/insights/InsightsMatrixPage.tsx
git commit -m "feat(web/insights): grid/map view toggle"
```

---

## Phase 7 — 退休旧页 + 接线 + i18n

### Task 14: 路由/侧栏切到新页,退休 EndpointReportsPage

**Files:**
- Modify: `apps/web/src/router/index.tsx`(`benchmarks/reports` element → `<InsightsMatrixPage/>`;保留 `insights/:connectionId` 详情;旧 `RedirectToInsights` 不动)
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`(labelKey 不变,`to:"/benchmarks/reports"` 不变——只换渲染组件)
- Delete: `apps/web/src/features/benchmarks/EndpointReportsPage.tsx`
- Modify: 删除对 `EndpointReportsPage` 的 import;若有针对它的测试,删除或改写

- [ ] **Step 1: 路由改指新页 + 删旧页 + grep 清引用**
Run: `grep -rn "EndpointReportsPage" apps/web/src`
Expected: 改完后 0 命中

- [ ] **Step 2: typecheck + web 全量测试**
Run: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/router/index.tsx apps/web/src/components/sidebar/sidebar-config.tsx
git rm apps/web/src/features/benchmarks/EndpointReportsPage.tsx
git commit -m "refactor(web/insights): route Test Insights to matrix page; retire EndpointReportsPage"
```

---

### Task 15: i18n 文案(en-US + zh-CN)

**Files:**
- Modify: `apps/web/src/locales/en-US/insights.json`
- Modify: `apps/web/src/locales/zh-CN/insights.json`

**Interfaces:**
- 新增 key(两语言对齐,en-US **零 CJK**):`matrix.title`、`matrix.subtitle`、`matrix.aggregate.{scenario,tool,engine}`、`matrix.band.{recommended,usable,notRecommended}`、`matrix.unscored`、`matrix.gap`、`matrix.view.{grid,map}`、`matrix.scatter.{title,frontier,score,latency}`、以及 scenario/tool/engine dimKey 的 label 映射(scenario 复用 `detail.scenario.*`)。

- [ ] **Step 1: 加 en-US 文案**(纯英文;title "Test Insights",subtitle 描述矩阵)
- [ ] **Step 2: 加 zh-CN 文案**(对应中文)
- [ ] **Step 3: 组件里把 raw dimKey / band / aggregate 走 `t(...)`**(api 返回 raw key,web 翻译)
- [ ] **Step 4: 跑 web 测试确认无缺 key 警告**
Run: `pnpm -F @modeldoctor/web test`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add apps/web/src/locales/en-US/insights.json apps/web/src/locales/zh-CN/insights.json apps/web/src/features/insights
git commit -m "feat(web/insights): i18n for matrix / scatter / map"
```

---

## 收尾验证(非任务,执行完跑一遍)

- [ ] `pnpm -r build` 全绿(nest build 能解析 insights-scoring/contracts dist)
- [ ] `pnpm -F @modeldoctor/api type-check && pnpm -F @modeldoctor/web type-check`
- [ ] `pnpm -r test`
- [ ] `pnpm test:e2e:api -- insights-matrix`
- [ ] 手动 verify(/verify skill):起 dev,进 Test Insights,切三个聚合 Tab、点列头出散点、点格进详情、切 Map;确认 detail 页与重构前一致。
- [ ] follow-up:在 agent-eval 相关 issue 留 inline 注释——「agent/lb-strategy/engine-kv-cache 场景评分规则待补,当前矩阵显未评分灰格」。

## Self-Review 记录

- **Spec 覆盖**:①矩阵→Task9;②象限散点→Task10/11;③详情不变→Task4;④Map→Task12/13;共享评分→Task1-4;matrix API→Task5-7;退休旧页→Task14;分期(agent 灰格)→Global Constraints + 收尾 follow-up。无遗漏。
- **占位符**:UI 大组件(MatrixGrid/ScatterPanel/ForceMap)给了 props 接口 + 关键渲染/option 结构而非逐像素样式——viz 样式本属迭代,接口/数据流已锁死,不算 TODO 占位。逻辑任务(评分包/契约/service/pareto)为完整代码。
- **类型一致**:`buildFindingsCore`/`RunLike`/`MetricReader`/`bandFromScore`/`nativeMetric`/`InsightsMatrixResponse`/`MatrixCell` 跨任务命名一致;reader 注入 web=fe 版、api=registry 版,均不触 `/schemas` 于 api。
