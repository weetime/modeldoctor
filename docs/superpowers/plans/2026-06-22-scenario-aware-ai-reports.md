# Scenario-Aware AI Reports — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SavedCompare「Generate AI report」(System B) produce visibly different reports per benchmark scenario — by keying generation off `scenario` via a Report Scenario Profile registry that controls prompt fragment, available figures, and assembled data.

**Architecture:** Add a server-side `ReportScenarioProfile` registry (one module per scenario), resolved from the compare's `scenario`. The deep-report synthesizer composes `base system prompt + scenario promptFragment`, drives the available-figure set from the profile's `figureManifest`, and feeds profile-assembled data into the user prompt. New figures stay React-rendered from already-hydrated metrics (no server code execution). Backend hardens the「same scenario + same tool」invariant and persists the derived `scenario`/`tool` on the compare.

**Tech Stack:** TypeScript, NestJS (apps/api), Zod contracts (packages/contracts), Prisma/Postgres, React + ECharts (apps/web), Vitest, tool-adapters (packages/tool-adapters).

**Spec:** `docs/superpowers/specs/2026-06-22-scenario-aware-ai-reports-design.md`

**Worktree:** `/Users/fangyong/vllm/modeldoctor/scenario-reports` on `feat/scenario-aware-ai-reports`. First run needs `pnpm -r build` once (so `packages/*/dist` exists for api typecheck). DB is the shared local dev DB; **do not** `prisma migrate reset`.

---

## File Structure

**Group A — Selection layer (backend invariant + persisted scenario/tool)**
- Modify: `apps/api/prisma/schema.prisma` — add `scenario String?`, `tool String?` to `SavedCompare`
- Create: `apps/api/prisma/migrations/<ts>_saved_compare_scenario_tool/migration.sql` (via `migrate dev --create-only`)
- Modify: `packages/contracts/src/saved-compares/saved-compares.ts` — surface `scenario`/`tool`
- Modify: `apps/api/src/modules/saved-compares/saved-compares.service.ts` — validate homogeneity, persist, compute-on-read fallback
- Test: `apps/api/test/e2e/saved-compares.e2e-spec.ts`, `apps/api/src/modules/saved-compares/saved-compares.service.spec.ts`

**Group B — Report Scenario Profile registry**
- Create: `apps/api/src/modules/saved-compares/report-scenarios/types.ts`
- Create: `apps/api/src/modules/saved-compares/report-scenarios/{lb-strategy,inference,capacity,gateway,engine-kv-cache,default}.ts`
- Create: `apps/api/src/modules/saved-compares/report-scenarios/index.ts` (registry + resolver)
- Test: `apps/api/src/modules/saved-compares/report-scenarios/index.spec.ts`

**Group C — Wire profiles into synthesizer**
- Modify: `apps/api/src/modules/saved-compares/prompts.ts` — export base builder, scenario injection
- Modify: `apps/api/src/modules/saved-compares/compare-synthesize.service.ts` — resolve profile, inject fragment, manifest-driven refIds, assembled data

**Group D — Phase-1 figures**
- Modify: `packages/contracts/src/benchmark.ts` — expose `perPod` shape if not already exported
- Modify: `packages/contracts/src/saved-compares/compare-narrative.ts` — new `FigureRefId`s
- Modify: `apps/api/src/modules/saved-compares/metrics.ts` + `apps/web/src/features/benchmarks/compare/client-metrics.ts` — `readPodDistribution`, availability (mirror)
- Modify: `apps/api/src/modules/saved-compares/prompts.ts` — refId list in `COMMON_SCHEMA_BLOCK`
- Create: `apps/web/src/components/charts/PodDistributionChart.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx` — render cases

**Group E — Capacity sweep curve**
- Modify: `packages/tool-adapters/src/guidellm/schema.ts` — optional `capacityCurve`
- Modify: `packages/tool-adapters/src/guidellm/runtime.ts` — populate from all benches
- Modify: `packages/contracts/src/saved-compares/compare-narrative.ts` — `throughput-vs-concurrency` refId
- Modify: metrics mirror — availability + reader
- Create: `apps/web/src/components/charts/ThroughputConcurrencyChart.tsx`
- Modify: `FigureRenderer.tsx` — render case

---

## Conventions for every task

- Commit messages use conventional prefixes; body ends with the Co-Authored-By line from CLAUDE.md. Explicit `git add <files>` — never `git add -A`.
- Run api unit tests: `pnpm -F @modeldoctor/api test -- <file>`. Web: `pnpm -F @modeldoctor/web test -- <file>`. Contracts/tool-adapters: `pnpm -F @modeldoctor/contracts test` / `pnpm -F @modeldoctor/tool-adapters test`.
- After contract or tool-adapter changes that api/web import, rebuild that package: `pnpm -F @modeldoctor/contracts build` (api/web consume `dist`).

---

## Group A — Selection layer

### Task A1: Add nullable `scenario`/`tool` columns to SavedCompare

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (the `SavedCompare` model, ~line 350-382)
- Create: `apps/api/prisma/migrations/<ts>_saved_compare_scenario_tool/migration.sql`

- [ ] **Step 1: Edit the Prisma model**

In the `SavedCompare` model, add two optional columns next to `clientName`:

```prisma
  scenario     String?  // derived: shared scenario of all member benchmarks
  tool         String?  // derived: shared tool of all member benchmarks
```

- [ ] **Step 2: Generate the migration (schema-only, no data DML)**

Run: `cd apps/api && pnpm prisma migrate dev --create-only --name saved_compare_scenario_tool`
Expected: a new `migration.sql` containing only `ALTER TABLE "SavedCompare" ADD COLUMN "scenario" TEXT; ALTER TABLE "SavedCompare" ADD COLUMN "tool" TEXT;` (column names may be quoted differently — verify it is **only** ADD COLUMN, no UPDATE/INSERT/DELETE).

- [ ] **Step 3: Apply + regenerate client**

Run: `cd apps/api && pnpm prisma migrate dev` then `pnpm prisma generate`
Expected: migration applies clean; `@prisma/client` types now include `scenario`/`tool` on `SavedCompare`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add nullable scenario/tool columns to SavedCompare"
```

### Task A2: Surface `scenario`/`tool` in the contract + serializer

**Files:**
- Modify: `packages/contracts/src/saved-compares/saved-compares.ts:23-52` (savedCompareSchema)
- Modify: `apps/api/src/modules/saved-compares/saved-compares.service.ts:17-49` (serialize)
- Test: `packages/contracts/src/saved-compares/saved-compares.spec.ts` (create if absent)

- [ ] **Step 1: Write a failing contract test**

In `packages/contracts/src/saved-compares/saved-compares.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { savedCompareSchema } from "./saved-compares.js";

const base = {
  id: "c1", userId: "u1", name: "n", benchmarkIds: ["a", "b"],
  stageLabels: { a: "OFF", b: "ON" }, baselineId: null, context: null,
  classification: "internal", clientName: null, version: 1,
  narrative: null, narrativeAt: null,
  createdAt: "2026-06-22T00:00:00.000Z", updatedAt: "2026-06-22T00:00:00.000Z",
};

it("accepts nullable scenario/tool", () => {
  const p = savedCompareSchema.parse({ ...base, scenario: "lb-strategy", tool: "aiperf" });
  expect(p.scenario).toBe("lb-strategy");
  expect(savedCompareSchema.parse({ ...base }).scenario ?? null).toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm -F @modeldoctor/contracts test -- saved-compares.spec`
Expected: FAIL — `scenario` stripped/undefined (not in schema yet).

- [ ] **Step 3: Add fields to `savedCompareSchema`**

Inside the `.object({ ... })` (before `narrative`), add:

```ts
    scenario: z.string().nullable().optional(),
    tool: z.string().nullable().optional(),
```

- [ ] **Step 4: Surface in serializer**

In `saved-compares.service.ts`, add `scenario: string | null;` and `tool: string | null;` to the `serialize` row param type, and in the returned object add:

```ts
      scenario: row.scenario,
      tool: row.tool,
```

- [ ] **Step 5: Run tests + build contract**

Run: `pnpm -F @modeldoctor/contracts test -- saved-compares.spec && pnpm -F @modeldoctor/contracts build`
Expected: PASS; contract `dist` rebuilt.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/saved-compares/saved-compares.ts packages/contracts/src/saved-compares/saved-compares.spec.ts apps/api/src/modules/saved-compares/saved-compares.service.ts
git commit -m "feat(contracts): surface scenario/tool on SavedCompare"
```

### Task A3: Enforce same-scenario+same-tool on create; persist; derive-on-read

**Files:**
- Modify: `apps/api/src/modules/saved-compares/saved-compares.service.ts` (`create`, `getHydrated`)
- Test: `apps/api/src/modules/saved-compares/saved-compares.service.spec.ts` (create if absent)

- [ ] **Step 1: Add a pure helper for derivation**

At the bottom of `saved-compares.service.ts` (module scope, exported for test):

```ts
/** Derive the shared scenario/tool of a compare's member benchmarks.
 * Returns nulls when the set is empty or heterogeneous (mixed). */
export function deriveCompareDims(
  members: Array<{ scenario?: string | null; tool?: string | null }>,
): { scenario: string | null; tool: string | null } {
  const scenarios = new Set(members.map((m) => m.scenario ?? null));
  const tools = new Set(members.map((m) => m.tool ?? null));
  return {
    scenario: scenarios.size === 1 ? ([...scenarios][0] ?? null) : null,
    tool: tools.size === 1 ? ([...tools][0] ?? null) : null,
  };
}
```

- [ ] **Step 2: Write failing service tests**

In `saved-compares.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveCompareDims } from "./saved-compares.service.js";

describe("deriveCompareDims", () => {
  it("returns the shared dims when homogeneous", () => {
    expect(
      deriveCompareDims([
        { scenario: "lb-strategy", tool: "aiperf" },
        { scenario: "lb-strategy", tool: "aiperf" },
      ]),
    ).toEqual({ scenario: "lb-strategy", tool: "aiperf" });
  });
  it("returns nulls when scenarios differ", () => {
    expect(
      deriveCompareDims([
        { scenario: "lb-strategy", tool: "aiperf" },
        { scenario: "inference", tool: "aiperf" },
      ]),
    ).toEqual({ scenario: null, tool: "aiperf" });
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm -F @modeldoctor/api test -- saved-compares.service.spec`
Expected: FAIL — `deriveCompareDims` not exported yet (until Step 1 lands) → then PASS once Step 1 in place. (If you wrote Step 1 first, this step verifies green; otherwise it drives it.)

- [ ] **Step 4: Enforce + persist in `create`**

Replace the body of `create` so that, after the uniqueness check, it fetches the member benchmarks, validates homogeneity, and persists derived dims:

```ts
  async create(userId: string, body: CreateSavedCompareRequest): Promise<SavedCompare> {
    if (new Set(body.benchmarkIds).size !== body.benchmarkIds.length) {
      throw new BadRequestException("benchmarkIds must be unique");
    }
    const members = await this.prisma.benchmark.findMany({
      where: { id: { in: body.benchmarkIds } },
      select: { scenario: true, tool: true },
    });
    const scenarios = new Set(members.map((m) => m.scenario));
    const tools = new Set(members.map((m) => m.tool));
    if (scenarios.size > 1) {
      throw new BadRequestException("compare requires a single scenario across all benchmarks");
    }
    if (tools.size > 1) {
      throw new BadRequestException("compare requires a single tool across all benchmarks");
    }
    const row = await this.prisma.savedCompare.create({
      data: {
        userId,
        name: body.name,
        benchmarkIds: body.benchmarkIds,
        stageLabels: body.stageLabels,
        baselineId: body.baselineId ?? null,
        context: body.context ?? null,
        classification: body.classification ?? "internal",
        clientName: body.clientName ?? null,
        scenario: members.length > 0 ? ([...scenarios][0] ?? null) : null,
        tool: members.length > 0 ? ([...tools][0] ?? null) : null,
      },
    });
    return this.serialize(row);
  }
```

- [ ] **Step 5: Compute-on-read fallback in `getHydrated`**

At the end of `getHydrated`, before `return`, derive when the stored value is null (old rows):

```ts
    const dims = deriveCompareDims(
      hydratedBenchmarks.filter((b) => !b.missing).map((b) => ({ scenario: b.scenario, tool: b.tool })),
    );
    return {
      ...sc,
      scenario: sc.scenario ?? dims.scenario,
      tool: sc.tool ?? dims.tool,
      benchmarks: hydratedBenchmarks,
    };
```

- [ ] **Step 6: Run unit tests**

Run: `pnpm -F @modeldoctor/api test -- saved-compares.service.spec`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/saved-compares/saved-compares.service.ts apps/api/src/modules/saved-compares/saved-compares.service.spec.ts
git commit -m "feat(api): enforce single scenario+tool per compare and persist derived dims"
```

### Task A4: e2e — create rejects mixed scenario

**Files:**
- Modify: `apps/api/test/e2e/saved-compares.e2e-spec.ts`

- [ ] **Step 1: Add a failing e2e case**

Add a test that seeds two benchmarks with different `scenario` values and asserts `POST /api/saved-compares` returns 400. Follow the existing seeding helpers in this file (it already creates `scenario: "inference", tool: "guidellm"` benchmarks — add one with `scenario: "lb-strategy"`):

```ts
it("rejects a compare spanning two scenarios", async () => {
  const a = await createBenchmark({ scenario: "inference", tool: "guidellm" });
  const b = await createBenchmark({ scenario: "lb-strategy", tool: "guidellm" });
  await request(app.getHttpServer())
    .post("/api/saved-compares")
    .set(authHeader)
    .send({ name: "mix", benchmarkIds: [a.id, b.id], stageLabels: { [a.id]: "A", [b.id]: "B" } })
    .expect(400);
});
```

(Use whatever `createBenchmark` / `authHeader` helpers the file already defines; if it inlines prisma inserts, mirror that.)

- [ ] **Step 2: Run, verify it passes (logic already landed in A3)**

Run: `pnpm test:e2e:api -- saved-compares`
Expected: PASS (constraint enforced). Also confirm the existing same-scenario tests still pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/e2e/saved-compares.e2e-spec.ts
git commit -m "test(api): e2e covers mixed-scenario compare rejection"
```

---

## Group B — Report Scenario Profile registry

### Task B1: Profile types

**Files:**
- Create: `apps/api/src/modules/saved-compares/report-scenarios/types.ts`

- [ ] **Step 1: Write the types module**

```ts
import type { FigureRefId, HydratedSavedCompare } from "@modeldoctor/contracts";

export type Locale = "zh-CN" | "en-US";

/** Stable intent keys — finer than scenario (inference splits by run count). */
export type ReportIntent =
  | "lb-strategy"
  | "engine-kv-cache"
  | "capacity"
  | "gateway"
  | "inference-single"
  | "inference-multi"
  | "default";

/** Scenario-specific data the profile assembled from the hydrated compare,
 * passed to both the user-prompt builder and the figure manifest. */
export interface ScenarioData {
  /** Extra markdown block injected into the user prompt (per-pod table,
   * cold/warm pairing, capacity curve summary, …). Empty string = none. */
  promptBlock: string;
  /** refIds the profile wants offered to the LLM, intersected later with the
   * data-availability set so empty charts never get offered. */
  preferredFigures: FigureRefId[];
}

export interface ReportScenarioProfile {
  intent: ReportIntent;
  /** Injected after the common base in the system prompt. */
  promptFragment: (locale: Locale) => string;
  /** Assemble scenario data from the hydrated compare. */
  dataAssembly: (sc: HydratedSavedCompare) => ScenarioData;
}
```

- [ ] **Step 2: Build api to typecheck**

Run: `pnpm -F @modeldoctor/api type-check` (or `pnpm -F @modeldoctor/api build`)
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/saved-compares/report-scenarios/types.ts
git commit -m "feat(api): report-scenario profile types"
```

### Task B2: Resolver + registry skeleton with default profile

**Files:**
- Create: `apps/api/src/modules/saved-compares/report-scenarios/default.ts`
- Create: `apps/api/src/modules/saved-compares/report-scenarios/index.ts`
- Test: `apps/api/src/modules/saved-compares/report-scenarios/index.spec.ts`

- [ ] **Step 1: Default profile (no-op fragment, no extra data)**

`default.ts`:

```ts
import type { ReportScenarioProfile } from "./types.js";

export const defaultProfile: ReportScenarioProfile = {
  intent: "default",
  promptFragment: () => "",
  dataAssembly: () => ({ promptBlock: "", preferredFigures: [] }),
};
```

- [ ] **Step 2: Write failing resolver test**

`index.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveReportIntent } from "./index.js";

describe("resolveReportIntent", () => {
  it("maps lb-strategy directly", () => {
    expect(resolveReportIntent("lb-strategy", 2)).toBe("lb-strategy");
  });
  it("splits inference by run count", () => {
    expect(resolveReportIntent("inference", 1)).toBe("inference-single");
    expect(resolveReportIntent("inference", 3)).toBe("inference-multi");
  });
  it("falls back to default on null/unknown scenario", () => {
    expect(resolveReportIntent(null, 2)).toBe("default");
    expect(resolveReportIntent("nonsense", 2)).toBe("default");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm -F @modeldoctor/api test -- report-scenarios/index.spec`
Expected: FAIL — `resolveReportIntent` undefined.

- [ ] **Step 4: Implement resolver + registry**

`index.ts`:

```ts
import { defaultProfile } from "./default.js";
import type { ReportIntent, ReportScenarioProfile } from "./types.js";

export function resolveReportIntent(
  scenario: string | null | undefined,
  runCount: number,
): ReportIntent {
  switch (scenario) {
    case "lb-strategy":
      return "lb-strategy";
    case "engine-kv-cache":
      return "engine-kv-cache";
    case "capacity":
      return "capacity";
    case "gateway":
      return "gateway";
    case "inference":
      return runCount <= 1 ? "inference-single" : "inference-multi";
    default:
      return "default";
  }
}

const REGISTRY: Record<ReportIntent, ReportScenarioProfile> = {
  default: defaultProfile,
  // filled in B3/B4:
  "lb-strategy": defaultProfile,
  "engine-kv-cache": defaultProfile,
  capacity: defaultProfile,
  gateway: defaultProfile,
  "inference-single": defaultProfile,
  "inference-multi": defaultProfile,
};

export function getReportProfile(intent: ReportIntent): ReportScenarioProfile {
  return REGISTRY[intent] ?? defaultProfile;
}

export { REGISTRY as reportScenarioRegistry };
export type { ReportScenarioProfile } from "./types.js";
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm -F @modeldoctor/api test -- report-scenarios/index.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/saved-compares/report-scenarios/default.ts apps/api/src/modules/saved-compares/report-scenarios/index.ts apps/api/src/modules/saved-compares/report-scenarios/index.spec.ts
git commit -m "feat(api): report-scenario resolver + registry skeleton"
```

### Task B3: lb-strategy profile (the headline scenario)

**Files:**
- Create: `apps/api/src/modules/saved-compares/report-scenarios/lb-strategy.ts`
- Modify: `apps/api/src/modules/saved-compares/report-scenarios/index.ts` (register)
- Test: `apps/api/src/modules/saved-compares/report-scenarios/lb-strategy.spec.ts`

This profile folds in the prefix-cache guidance currently hardcoded in `prompts.ts` (`COMMON_STYLE_RULES`, the "Prefix-cache runs:" paragraph) and assembles a per-pod distribution table from `serverMetrics.prefixCache.perPod`.

- [ ] **Step 1: Write failing test for dataAssembly**

`lb-strategy.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lbStrategyProfile } from "./lb-strategy.js";

const sc = {
  benchmarks: [
    {
      missing: false, stageLabel: "ON", name: "on",
      serverMetrics: {
        prefixCache: {
          hitRatePct: 57.2, topPodSharePct: 41,
          perPod: [
            { pod: "p1", queries: 800, hits: 500 },
            { pod: "p2", queries: 200, hits: 60 },
          ],
        },
      },
    },
  ],
} as never;

it("emits a per-pod distribution block citing pod shares", () => {
  const data = lbStrategyProfile.dataAssembly(sc);
  expect(data.promptBlock).toContain("ON");
  expect(data.promptBlock).toContain("80"); // p1 share% = 800/1000
  expect(data.preferredFigures).toContain("stage-bars-prefix-cache-hit");
});
it("fragment leads with hit-rate", () => {
  expect(lbStrategyProfile.promptFragment("zh-CN")).toContain("命中率");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm -F @modeldoctor/api test -- report-scenarios/lb-strategy.spec`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the profile**

`lb-strategy.ts`:

```ts
import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import { readPodDistribution } from "../metrics.js";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const FRAGMENT_ZH = `本报告是负载均衡 / 路由策略验证(lb-strategy)。
- HEADLINE 与第一张 summary card 必须是 prefix cache 命中率的变化——这是实验存在的理由。
- 用 stage-bars-prefix-cache-hit 展示命中率,pod-traffic-distribution 展示每 pod 流量占比(集中度),pod-hit-rate 展示每 pod 命中率。
- 吞吐 / TTFT 视为次要:小模型 prefill 便宜,命中率上升未必改善时延,直说即可,不要拿一个持平的吞吐差当 headline。
- top-pod share 持平而命中率上升 = 更好的缓存局部性且无热点(好事),不是失败。
- stage 标签 OFF/ON 指路由开关,不是离线/在线。`;

const FRAGMENT_EN = `This is a load-balancer / routing-strategy validation (lb-strategy).
- The HEADLINE and first summary card MUST be the prefix-cache hit-rate change — that is why the experiment exists.
- Use stage-bars-prefix-cache-hit for hit rate, pod-traffic-distribution for each pod's traffic share (concentration), pod-hit-rate for per-pod hit rate.
- Treat throughput / TTFT as secondary: on small models prefill is cheap, so a higher hit rate need not improve latency — say so plainly rather than leading with a flat throughput delta.
- A flat top-pod share alongside a rising hit rate means better cache locality without hot-spotting (good), not a failure.
- Stage labels OFF/ON mean the routing toggle, not offline/online.`;

function assemble(sc: HydratedSavedCompare): ScenarioData {
  const lines: string[] = [];
  for (const b of sc.benchmarks) {
    if (b.missing) continue;
    const pods = readPodDistribution(b.serverMetrics);
    if (!pods || pods.length === 0) continue;
    const total = pods.reduce((s, p) => s + p.queries, 0) || 1;
    const top = pods
      .map((p) => ({ pod: p.pod, sharePct: (p.queries / total) * 100, hitPct: p.queries > 0 ? (p.hits / p.queries) * 100 : 0 }))
      .sort((a, z) => z.sharePct - a.sharePct)
      .slice(0, 6)
      .map((p) => `    ${p.pod}: share=${p.sharePct.toFixed(0)}% hit=${p.hitPct.toFixed(0)}%`)
      .join("\n");
    lines.push(`  [${b.stageLabel}] per-pod (top by share):\n${top}`);
  }
  const promptBlock = lines.length > 0 ? `## Per-pod traffic distribution\n${lines.join("\n")}` : "";
  return {
    promptBlock,
    preferredFigures: [
      "stage-bars-prefix-cache-hit",
      "pod-traffic-distribution",
      "pod-hit-rate",
      "stage-bars-top-pod-share",
    ],
  };
}

export const lbStrategyProfile: ReportScenarioProfile = {
  intent: "lb-strategy",
  promptFragment: (locale: Locale) => (locale === "en-US" ? FRAGMENT_EN : FRAGMENT_ZH),
  dataAssembly: assemble,
};
```

> Note: `readPodDistribution` and the `pod-*` refIds land in Group D. Until then this file won't typecheck. Order Group D Tasks D1–D2 **before** building api, or stub `readPodDistribution` returning `[]` and the refIds will be added to the enum in D1. Recommended order: do D1–D2 right after B1, then return here. The plan lists Group D separately for clarity; the executor may interleave.

- [ ] **Step 4: Register it**

In `index.ts`, import `lbStrategyProfile` and set `"lb-strategy": lbStrategyProfile` in `REGISTRY`.

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/api test -- report-scenarios/lb-strategy.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/saved-compares/report-scenarios/lb-strategy.ts apps/api/src/modules/saved-compares/report-scenarios/lb-strategy.spec.ts apps/api/src/modules/saved-compares/report-scenarios/index.ts
git commit -m "feat(api): lb-strategy report profile (hit-rate + per-pod distribution)"
```

### Task B4: Remaining four profiles

**Files:**
- Create: `report-scenarios/{engine-kv-cache,capacity,gateway,inference}.ts`
- Modify: `report-scenarios/index.ts`
- Test: `report-scenarios/profiles.spec.ts`

Each profile follows the B3 shape. Fragments below; `dataAssembly` returns `preferredFigures` and (where noted) a `promptBlock`.

- [ ] **Step 1: engine-kv-cache** — `engine-kv-cache.ts`

```ts
import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import { summarizeForPrompt } from "../metrics.js";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是引擎 KV / 前缀缓存冷热对比(engine-kv-cache)。
- 主线是冷(R1)→热(R2)的提升:用 cold-warm-delta 展示配对 stage 的吞吐/TTFT Δ%。
- HEADLINE 用「热轮相对冷轮」的最大增益指标(通常 TTFT 或吞吐)。
- 命名以 "(rerun)" 配对冷/热;若只有单轮,退化为单点描述,不要编造冷热差。`;
const EN = `This is an engine KV / prefix-cache cold-vs-warm comparison (engine-kv-cache).
- The through-line is the cold (R1) → warm (R2) gain: use cold-warm-delta for the paired-stage throughput/TTFT Δ%.
- Lead with the largest warm-vs-cold gain metric (usually TTFT or throughput).
- Cold/warm pair by the "(rerun)" name suffix; with a single round, degrade to a single-point description — do not invent a cold/warm delta.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return { promptBlock: "", preferredFigures: ["cold-warm-delta", "stage-bars-ttft-p95", "stage-bars-throughput"] };
}
export const engineKvCacheProfile: ReportScenarioProfile = {
  intent: "engine-kv-cache",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
```

- [ ] **Step 2: capacity** — `capacity.ts`

```ts
import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是容量规划(capacity),工具按并发/负载做了 sweep。
- 主图是 throughput-vs-concurrency:展示吞吐随并发的拐点(饱和点)。
- HEADLINE 用饱和点的并发档与对应吞吐;若曲线缺失(旧数据)则退回最终聚合百分位,并在 caveats 注明无 sweep 曲线。`;
const EN = `This is a capacity-planning report (capacity); the tool swept concurrency/load.
- The lead figure is throughput-vs-concurrency: show the saturation knee.
- Headline with the knee's concurrency level and its throughput; if the curve is missing (legacy data) fall back to final aggregate percentiles and note "no sweep curve" in caveats.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return { promptBlock: "", preferredFigures: ["throughput-vs-concurrency", "compare-grid"] };
}
export const capacityProfile: ReportScenarioProfile = {
  intent: "capacity",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
```

- [ ] **Step 3: gateway** — `gateway.ts`

```ts
import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是网关 / HTTP 层压测(gateway,vegeta)。
- 关注 HTTP 吞吐与时延(e2e),没有 LLM 语义指标(TTFT/TPOT 不适用,不要提)。
- HEADLINE 用吞吐(req/s)或 e2e p95;错误率与状态码分布作为稳定性佐证。`;
const EN = `This is a gateway / HTTP-layer load test (gateway, vegeta).
- Focus on HTTP throughput and latency (e2e); there are no LLM semantic metrics (TTFT/TPOT do not apply — do not mention them).
- Headline with throughput (req/s) or e2e p95; error rate and status-code mix support the stability story.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return { promptBlock: "", preferredFigures: ["stage-bars-throughput", "stage-bars-e2e-p95", "stage-bars-error-rate"] };
}
export const gatewayProfile: ReportScenarioProfile = {
  intent: "gateway",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
```

- [ ] **Step 4: inference (single + multi share one module)** — `inference.ts`

```ts
import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const MULTI_ZH = `本报告是多引擎推理对比(inference,多 run)。
- 主线是不同引擎在吞吐 / TTFT / E2E 上的相对位置;用 compare-grid + stage-bars-throughput + stage-bars-ttft-p95。
- HEADLINE 用赢家引擎与其吞吐领先幅度;同档差距 <10% 不作为优势判定,直说并列。`;
const MULTI_EN = `This is a multi-engine inference comparison (inference, multiple runs).
- The through-line is each engine's relative standing on throughput / TTFT / E2E; use compare-grid + stage-bars-throughput + stage-bars-ttft-p95.
- Headline with the winning engine and its throughput lead; a <10% gap in a tier is not an advantage — call it a tie.`;
const SINGLE_ZH = `本报告是单引擎推理基线(inference,单 run 或同引擎多配置)。
- 主线是该配置的 TTFT / E2E 分布与吞吐;用 stage-bars-ttft-p95 + stage-bars-e2e-p95。
- 没有跨引擎对比时,不要硬造"赢家";聚焦绝对水平与是否达 SLO。`;
const SINGLE_EN = `This is a single-engine inference baseline (inference, one run or same-engine configs).
- The through-line is this config's TTFT / E2E distribution and throughput; use stage-bars-ttft-p95 + stage-bars-e2e-p95.
- With no cross-engine comparison, do not manufacture a "winner"; focus on absolute levels and SLO attainment.`;

function makeProfile(multi: boolean): ReportScenarioProfile {
  return {
    intent: multi ? "inference-multi" : "inference-single",
    promptFragment: (l: Locale) =>
      multi ? (l === "en-US" ? MULTI_EN : MULTI_ZH) : l === "en-US" ? SINGLE_EN : SINGLE_ZH,
    dataAssembly: (_sc: HydratedSavedCompare): ScenarioData => ({
      promptBlock: "",
      preferredFigures: multi
        ? ["compare-grid", "stage-bars-throughput", "stage-bars-ttft-p95"]
        : ["stage-bars-ttft-p95", "stage-bars-e2e-p95", "stage-bars-throughput"],
    }),
  };
}
export const inferenceMultiProfile = makeProfile(true);
export const inferenceSingleProfile = makeProfile(false);
```

- [ ] **Step 5: Register all four (+ inference split) in `index.ts`**

Import and set: `"engine-kv-cache": engineKvCacheProfile`, `capacity: capacityProfile`, `gateway: gatewayProfile`, `"inference-multi": inferenceMultiProfile`, `"inference-single": inferenceSingleProfile`.

- [ ] **Step 6: Write a registry coverage test**

`profiles.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getReportProfile, reportScenarioRegistry } from "./index.js";

it("every intent has a non-default profile except 'default'", () => {
  for (const [intent, profile] of Object.entries(reportScenarioRegistry)) {
    expect(profile.intent === intent || intent === "default").toBe(true);
  }
});
it("fragments are non-empty for real intents (both locales)", () => {
  for (const intent of ["lb-strategy", "engine-kv-cache", "capacity", "gateway", "inference-multi", "inference-single"] as const) {
    const p = getReportProfile(intent);
    expect(p.promptFragment("zh-CN").length).toBeGreaterThan(20);
    expect(p.promptFragment("en-US").length).toBeGreaterThan(20);
  }
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm -F @modeldoctor/api test -- report-scenarios`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/saved-compares/report-scenarios/engine-kv-cache.ts apps/api/src/modules/saved-compares/report-scenarios/capacity.ts apps/api/src/modules/saved-compares/report-scenarios/gateway.ts apps/api/src/modules/saved-compares/report-scenarios/inference.ts apps/api/src/modules/saved-compares/report-scenarios/index.ts apps/api/src/modules/saved-compares/report-scenarios/profiles.spec.ts
git commit -m "feat(api): engine-kv-cache, capacity, gateway, inference report profiles"
```

---

## Group D — Phase-1 figures (do D1–D2 before B3 builds)

### Task D1: New FigureRefIds + expose perPod shape

**Files:**
- Modify: `packages/contracts/src/saved-compares/compare-narrative.ts:68-80` (figureRefIdSchema)
- Verify/Modify: `packages/contracts/src/benchmark.ts` (`prefixCacheAnnotationSchema` — ensure `perPod` is part of the exported schema; it already is per investigation at ~235-247)
- Test: `packages/contracts/src/saved-compares/compare-narrative.spec.ts` (create if absent)

- [ ] **Step 1: Add refIds to the enum**

In `figureRefIdSchema`, add three entries (keep existing ones):

```ts
  "pod-traffic-distribution",
  "pod-hit-rate",
  "cold-warm-delta",
```

(The `throughput-vs-concurrency` refId is added in Task E3.)

- [ ] **Step 2: Write a failing test**

`compare-narrative.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { figureRefIdSchema } from "./compare-narrative.js";
it("accepts the new phase-1 refIds", () => {
  for (const r of ["pod-traffic-distribution", "pod-hit-rate", "cold-warm-delta"]) {
    expect(figureRefIdSchema.parse(r)).toBe(r);
  }
});
```

- [ ] **Step 3: Run + build**

Run: `pnpm -F @modeldoctor/contracts test -- compare-narrative.spec && pnpm -F @modeldoctor/contracts build`
Expected: PASS, dist rebuilt.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/saved-compares/compare-narrative.ts packages/contracts/src/saved-compares/compare-narrative.spec.ts
git commit -m "feat(contracts): add phase-1 figure refIds (pod distribution, pod hit-rate, cold-warm delta)"
```

### Task D2: `readPodDistribution` + availability (server + client mirror)

**Files:**
- Modify: `apps/api/src/modules/saved-compares/metrics.ts`
- Modify: `apps/web/src/features/benchmarks/compare/client-metrics.ts`
- Test: `apps/api/src/modules/saved-compares/metrics.spec.ts` (create/extend)

- [ ] **Step 1: Write failing test (server)**

In `metrics.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { availableFigureRefIds, readPodDistribution } from "./metrics.js";

const withPods = {
  prefixCache: { hitRatePct: 50, topPodSharePct: 60, perPod: [
    { pod: "p1", queries: 600, hits: 300 }, { pod: "p2", queries: 400, hits: 100 },
  ] },
};
it("reads per-pod distribution", () => {
  expect(readPodDistribution(withPods)).toHaveLength(2);
});
it("offers pod figures + cold-warm-delta when data supports", () => {
  const set = availableFigureRefIds([
    { summaryMetrics: null, serverMetrics: withPods },
    { summaryMetrics: null, serverMetrics: withPods },
  ]);
  expect(set.has("pod-traffic-distribution")).toBe(true);
  expect(set.has("pod-hit-rate")).toBe(true);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm -F @modeldoctor/api test -- saved-compares/metrics.spec`
Expected: FAIL — `readPodDistribution` undefined.

- [ ] **Step 3: Implement reader + availability (server `metrics.ts`)**

Add a reader. Read the actual `prefixCacheAnnotationSchema` field name for the pod array (investigation: `perPod: [{ pod, queries, hits }]`):

```ts
export interface PodDatum { pod: string; queries: number; hits: number }

/** Read serverMetrics.prefixCache.perPod (per-pod query/hit counts). Null when
 * the annotation is absent/malformed; [] when present but empty. */
export function readPodDistribution(serverMetrics: unknown): PodDatum[] | null {
  const parsed = prefixCacheAnnotationSchema.safeParse(
    (serverMetrics as { prefixCache?: unknown } | null)?.prefixCache,
  );
  if (!parsed.success) return null;
  const pods = (parsed.data as { perPod?: PodDatum[] }).perPod;
  return Array.isArray(pods) ? pods : [];
}
```

In `availableFigureRefIds`, inside the existing `if (pc.every((p) => p !== null))` block (where prefix-cache figures get added), also add the pod figures when every run carries a non-empty perPod array:

```ts
  const pods = runs.map((r) => readPodDistribution(r.serverMetrics));
  if (pods.every((p) => p !== null && p.length > 0)) {
    out.add("pod-traffic-distribution");
    out.add("pod-hit-rate");
  }
```

Add `cold-warm-delta` when ≥2 runs carry a throughput or ttft summary (it's a paired-stage delta over `summarizeForPrompt`):

```ts
  if (perRun.filter((s) => s.throughput !== null || s.ttft !== null).length >= 2) {
    out.add("cold-warm-delta");
  }
```

- [ ] **Step 4: Mirror in client `client-metrics.ts`**

Add the identical `PodDatum`/`readPodDistribution` and the same three additions to the client `availableFigureRefIds`. Keep the "Keep this in sync" comment accurate.

- [ ] **Step 5: Run server tests + web typecheck**

Run: `pnpm -F @modeldoctor/api test -- saved-compares/metrics.spec && pnpm -F @modeldoctor/web type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/saved-compares/metrics.ts apps/api/src/modules/saved-compares/metrics.spec.ts apps/web/src/features/benchmarks/compare/client-metrics.ts
git commit -m "feat: per-pod distribution reader + figure availability (server/client mirror)"
```

### Task D3: Update prompt schema refId list

**Files:**
- Modify: `apps/api/src/modules/saved-compares/prompts.ts:35-40` (COMMON_SCHEMA_BLOCK figures union)

- [ ] **Step 1: Extend the inline refId union in `COMMON_SCHEMA_BLOCK`**

Update the `refId:` union string to include the new ids:

```ts
  refId: "stage-bars-throughput" | "stage-bars-error-rate" | "stage-bars-ttft-p95" | "stage-bars-e2e-p95" | "stage-bars-prefix-cache-hit" | "stage-bars-top-pod-share" | "pod-traffic-distribution" | "pod-hit-rate" | "cold-warm-delta" | "throughput-vs-concurrency" | "compare-grid";
```

- [ ] **Step 2: Remove the hardcoded prefix-cache paragraph from `COMMON_STYLE_RULES`**

Delete the "Prefix-cache runs: …" paragraph (lines ~71-80) — it now lives in the lb-strategy `promptFragment`. The base prompt stays scenario-agnostic.

- [ ] **Step 3: Build api**

Run: `pnpm -F @modeldoctor/api build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/saved-compares/prompts.ts
git commit -m "refactor(api): base prompt lists all refIds; move prefix-cache guidance to lb profile"
```

### Task D4: PodDistributionChart + cold-warm-delta + FigureRenderer cases

**Files:**
- Create: `apps/web/src/components/charts/PodDistributionChart.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx`
- Test: `apps/web/src/features/benchmarks/compare/FigureRenderer.test.tsx` (extend)

- [ ] **Step 1: Build the chart component**

`PodDistributionChart.tsx` — follow the styling/structure of `apps/web/src/components/charts/StageBarChart.tsx` (read it first). It renders, **per stage**, a horizontal bar list of pods. Props:

```tsx
export interface PodDistributionDatum { stage: string; pods: { pod: string; value: number }[] }
export interface PodDistributionChartProps {
  title: string;
  data: PodDistributionDatum[];
  /** "%" for share, "%" for hit rate — formatting unit */
  unit: string;
  labelColors: import("./StageBarChart").StageBarLabelColors;
}
```

Render an ECharts (or the same primitive StageBarChart uses) grouped horizontal bar: one group per stage, one bar per pod, value labels suffixed with `unit`, fixed REPORT light palette. Keep it print-safe (static labels, no hover dependency) — mirror StageBarChart's label rules.

- [ ] **Step 2: Wire render cases in FigureRenderer**

In `FigureRenderer.tsx`, import `readPodDistribution` from `./client-metrics` and `PodDistributionChart`. Add branches after the `stage-bars-top-pod-share` block:

```tsx
  } else if (refId === "pod-traffic-distribution") {
    const data = summaries
      .map(({ r }) => ({ r, pods: readPodDistribution(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pods && x.pods.length > 0)
      .map(({ r, pods }) => {
        const total = (pods ?? []).reduce((s, p) => s + p.queries, 0) || 1;
        return { stage: r.stageLabel, pods: (pods ?? []).map((p) => ({ pod: p.pod, value: (p.queries / total) * 100 })) };
      });
    chart = <PodDistributionChart title="Per-pod traffic share" data={data} unit="%" labelColors={REPORT_LABEL_COLORS} />;
  } else if (refId === "pod-hit-rate") {
    const data = summaries
      .map(({ r }) => ({ r, pods: readPodDistribution(r.benchmark?.serverMetrics) }))
      .filter((x) => x.pods && x.pods.length > 0)
      .map(({ r, pods }) => ({
        stage: r.stageLabel,
        pods: (pods ?? []).map((p) => ({ pod: p.pod, value: p.queries > 0 ? (p.hits / p.queries) * 100 : 0 })),
      }));
    chart = <PodDistributionChart title="Per-pod hit rate" data={data} unit="%" labelColors={REPORT_LABEL_COLORS} />;
  } else if (refId === "cold-warm-delta") {
    chart = <ColdWarmDeltaTable runs={runs} baselineId={baselineId} />;
  }
```

- [ ] **Step 3: Add `ColdWarmDeltaTable` (local component, like FourMetricTable)**

A compact table: rows = stages, columns = QPS / TTFT p90 / E2E p90, with Δ% vs the baseline stage (reuse `summarizeForPrompt`). Model it on `FourMetricTable` at the bottom of FigureRenderer; add a Δ% column computed against `baselineIndexOf`'s stage.

- [ ] **Step 4: Extend the FigureRenderer test**

In `FigureRenderer.test.tsx`, add a case: runs carrying `serverMetrics.prefixCache.perPod` render a `pod-traffic-distribution` figure (assert it is NOT the "data unavailable" placeholder — i.e. the figure body has chart content). Follow existing test setup in the file.

- [ ] **Step 5: Run web tests**

Run: `pnpm -F @modeldoctor/web test -- FigureRenderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/charts/PodDistributionChart.tsx apps/web/src/features/benchmarks/compare/FigureRenderer.tsx apps/web/src/features/benchmarks/compare/FigureRenderer.test.tsx
git commit -m "feat(web): pod-distribution, pod-hit-rate, cold-warm-delta figures"
```

---

## Group C — Wire profiles into the synthesizer

### Task C1: Base system prompt + scenario injection

**Files:**
- Modify: `apps/api/src/modules/saved-compares/prompts.ts`

- [ ] **Step 1: Export a composable builder**

Add an exported function that appends a scenario fragment to the existing locale base. Keep `COMPARE_SYS_PROMPT_ZH/EN` for back-compat; add:

```ts
export function buildSystemPrompt(locale: "zh-CN" | "en-US", scenarioFragment: string): string {
  const base = locale === "en-US" ? EN_SCHEMA_INSTRUCTIONS : ZH_SCHEMA_INSTRUCTIONS;
  if (!scenarioFragment.trim()) return base;
  const header = locale === "en-US" ? "\n\n## Scenario guidance\n" : "\n\n## 场景专项要求\n";
  return `${base}${header}${scenarioFragment}`;
}
```

- [ ] **Step 2: Build api**

Run: `pnpm -F @modeldoctor/api build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/saved-compares/prompts.ts
git commit -m "feat(api): composable system prompt with scenario fragment injection"
```

### Task C2: Resolve profile in compare-synthesize

**Files:**
- Modify: `apps/api/src/modules/saved-compares/compare-synthesize.service.ts`
- Test: `apps/api/src/modules/saved-compares/compare-synthesize.service.spec.ts` (create if absent)

- [ ] **Step 1: Resolve profile and compose the system prompt**

In `synthesize`, replace the `const sys = …` line with profile resolution:

```ts
    const runCount = sc.benchmarks.filter((b) => !b.missing).length;
    const intent = resolveReportIntent(sc.scenario, runCount);
    const profile = getReportProfile(intent);
    const scenarioData = profile.dataAssembly(sc);
    const sys = buildSystemPrompt(body.locale, profile.promptFragment(body.locale));
    const userPrompt = this.buildUserPrompt(sc, body.locale, scenarioData);
```

Add imports:

```ts
import { getReportProfile, resolveReportIntent } from "./report-scenarios/index.js";
import { buildSystemPrompt } from "./prompts.js";
```

(Drop the now-unused `COMPARE_SYS_PROMPT_*` imports if no longer referenced.)

- [ ] **Step 2: Thread scenarioData into `buildUserPrompt` + manifest-driven refIds**

Change `buildUserPrompt` signature to `(sc, locale, scenarioData: ScenarioData)`. After the per-stage loop, if `scenarioData.promptBlock` is non-empty, push it. Then replace the "Available figure refIds" block so the offered set is `availableFigureRefIds(...) ∩ (preferredFigures ∪ always-available)`:

```ts
    const available = availableFigureRefIds(
      sc.benchmarks.filter((b) => !b.missing).map((b) => ({ summaryMetrics: b.summaryMetrics, serverMetrics: b.serverMetrics })),
    );
    // Profile preference narrows ordering; never offer a refId whose data is absent.
    const preferred = scenarioData.preferredFigures.filter((r) => available.has(r));
    const offered = preferred.length > 0 ? preferred : [...available];
```

Use `offered` where the code currently spreads `[...available]`.

- [ ] **Step 3: Update `ensurePrefixCacheFigures` guard (still valid)**

No change needed — it still injects the hit-rate figure when available and absent. Leave as-is.

- [ ] **Step 4: Write a service test (prompt composition, no live LLM)**

Extract `buildUserPrompt` test via a thin exported helper or test the private through a small refactor: make `buildSystemPrompt` usage observable by asserting `resolveReportIntent` + `getReportProfile` produce an lb fragment for an lb compare. Minimal test:

```ts
import { describe, expect, it } from "vitest";
import { getReportProfile, resolveReportIntent } from "./report-scenarios/index.js";
import { buildSystemPrompt } from "./prompts.js";

it("lb compare yields a hit-rate-led system prompt", () => {
  const intent = resolveReportIntent("lb-strategy", 2);
  const sys = buildSystemPrompt("zh-CN", getReportProfile(intent).promptFragment("zh-CN"));
  expect(sys).toContain("命中率");
  expect(sys).toContain("场景专项要求");
});
```

- [ ] **Step 5: Run tests + build**

Run: `pnpm -F @modeldoctor/api test -- compare-synthesize && pnpm -F @modeldoctor/api build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/saved-compares/compare-synthesize.service.ts apps/api/src/modules/saved-compares/compare-synthesize.service.spec.ts
git commit -m "feat(api): drive deep report by scenario profile (prompt + figure manifest)"
```

---

## Group E — Capacity sweep curve

### Task E1: `capacityCurve` field on guidellm report schema

**Files:**
- Modify: `packages/tool-adapters/src/guidellm/schema.ts:67-83`
- Test: `packages/tool-adapters/src/guidellm/schema.spec.ts`

- [ ] **Step 1: Write failing schema test**

In `schema.spec.ts`, add:

```ts
it("accepts an optional capacityCurve", () => {
  const base = { /* a valid GuidellmReport — copy from an existing passing case */ };
  const withCurve = { ...base, capacityCurve: [{ concurrency: 16, rps: 120, e2eP95Ms: 900 }] };
  expect(guidellmReportSchema.parse(withCurve).capacityCurve?.[0].concurrency).toBe(16);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/schema.spec`
Expected: FAIL — `capacityCurve` stripped.

- [ ] **Step 3: Add the field**

In `guidellmReportSchema`, add (after `requests`):

```ts
  capacityCurve: z
    .array(z.object({ concurrency: z.number(), rps: z.number(), e2eP95Ms: z.number() }))
    .optional(),
```

- [ ] **Step 4: Run + build**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/schema.spec && pnpm -F @modeldoctor/tool-adapters build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/guidellm/schema.ts packages/tool-adapters/src/guidellm/schema.spec.ts
git commit -m "feat(tool-adapters): optional capacityCurve on guidellm report"
```

### Task E2: Populate `capacityCurve` from all sweep benches

**Files:**
- Modify: `packages/tool-adapters/src/guidellm/runtime.ts:150-188` (`mapGuidellmRawToReport`)
- Test: `packages/tool-adapters/src/guidellm/runtime.spec.ts`

- [ ] **Step 1: Write failing test**

In `runtime.spec.ts`, add a case feeding a raw object whose `benchmarks` array has 3 entries (each with `metrics.request_concurrency.successful.mean`, `metrics.requests_per_second.successful.mean`, `metrics.request_latency.successful.percentiles.p95`), and assert `parseFinalReport` (or the mapper) yields `capacityCurve.length === 3` sorted by concurrency. Mirror the existing fixture style in this file / `__fixtures__`.

- [ ] **Step 2: Run, verify fail**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/runtime.spec`
Expected: FAIL.

- [ ] **Step 3: Implement — build the curve when >1 bench**

In `mapGuidellmRawToReport`, after computing the existing fields from `benches[0]`, add a curve derived from every bench (reuse the existing `successful`/`latency`/`rate` helpers):

```ts
  const capacityCurve =
    benches.length > 1
      ? benches
          .map((bn) => {
            const mx = (bn.metrics as Record<string, unknown> | undefined) ?? {};
            return {
              concurrency: Number(successful(mx, "request_concurrency").mean ?? 0),
              rps: Number(successful(mx, "requests_per_second").mean ?? 0),
              e2eP95Ms: latency(mx, "request_latency").p95 * 1000,
            };
          })
          .sort((a, z) => a.concurrency - z.concurrency)
      : undefined;
```

and include `capacityCurve,` in the returned object.

- [ ] **Step 4: Run + build**

Run: `pnpm -F @modeldoctor/tool-adapters test -- guidellm/runtime.spec && pnpm -F @modeldoctor/tool-adapters build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/guidellm/runtime.ts packages/tool-adapters/src/guidellm/runtime.spec.ts
git commit -m "feat(tool-adapters): extract capacity sweep curve from guidellm benchmarks[]"
```

### Task E3: `throughput-vs-concurrency` refId + availability + reader

**Files:**
- Modify: `packages/contracts/src/saved-compares/compare-narrative.ts` (figureRefIdSchema)
- Modify: `apps/api/.../metrics.ts` + `apps/web/.../client-metrics.ts` (reader + availability mirror)
- Test: extend `metrics.spec.ts`

- [ ] **Step 1: Add refId to enum + rebuild contracts**

Add `"throughput-vs-concurrency"` to `figureRefIdSchema`. Run `pnpm -F @modeldoctor/contracts build`.

- [ ] **Step 2: Reader + availability (server + client mirror)**

Add to both metrics modules:

```ts
export interface CapacityPoint { concurrency: number; rps: number; e2eP95Ms: number }
/** Read guidellm capacityCurve from a run's summaryMetrics ({tool,data}). */
export function readCapacityCurve(summaryMetrics: unknown): CapacityPoint[] | null {
  const m = summaryMetrics as { data?: { capacityCurve?: CapacityPoint[] } } | null;
  const c = m?.data?.capacityCurve;
  return Array.isArray(c) && c.length > 0 ? c : null;
}
```

In `availableFigureRefIds`, add `throughput-vs-concurrency` when any run carries a curve:

```ts
  if (runs.some((r) => readCapacityCurve(r.summaryMetrics) !== null)) {
    out.add("throughput-vs-concurrency");
  }
```

- [ ] **Step 3: Test (server)**

Add to `metrics.spec.ts`: a run with `summaryMetrics.data.capacityCurve` makes `throughput-vs-concurrency` available; one without does not.

- [ ] **Step 4: Run + build + commit**

Run: `pnpm -F @modeldoctor/api test -- saved-compares/metrics.spec && pnpm -F @modeldoctor/web type-check`

```bash
git add packages/contracts/src/saved-compares/compare-narrative.ts apps/api/src/modules/saved-compares/metrics.ts apps/api/src/modules/saved-compares/metrics.spec.ts apps/web/src/features/benchmarks/compare/client-metrics.ts
git commit -m "feat: throughput-vs-concurrency refId + capacity-curve reader (server/client mirror)"
```

### Task E4: ThroughputConcurrencyChart + FigureRenderer case + prompt union

**Files:**
- Create: `apps/web/src/components/charts/ThroughputConcurrencyChart.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx`
- Modify: `apps/api/src/modules/saved-compares/prompts.ts` (already includes the id from D3 step 1 — verify)
- Test: `FigureRenderer.test.tsx`

- [ ] **Step 1: Build the line chart**

`ThroughputConcurrencyChart.tsx` — a line chart (x = concurrency log scale, y = rps), one line per stage/run, REPORT light palette, print-safe labels. Follow the ECharts setup used by existing report charts. Props:

```tsx
export interface ThroughputConcurrencySeries { stage: string; points: { concurrency: number; rps: number }[] }
export interface ThroughputConcurrencyChartProps { title: string; series: ThroughputConcurrencySeries[] }
```

- [ ] **Step 2: FigureRenderer case**

Import `readCapacityCurve` + the chart. Add:

```tsx
  } else if (refId === "throughput-vs-concurrency") {
    const series = summaries
      .map(({ r }) => ({ r, curve: readCapacityCurve(r.summaryMetrics) }))
      .filter((x) => x.curve)
      .map(({ r, curve }) => ({ stage: r.stageLabel, points: (curve ?? []).map((p) => ({ concurrency: p.concurrency, rps: p.rps })) }));
    chart = <ThroughputConcurrencyChart title="Throughput vs concurrency" series={series} />;
  }
```

- [ ] **Step 3: Test + run**

Add a FigureRenderer test: a run with `summaryMetrics.data.capacityCurve` renders the figure (not the placeholder).
Run: `pnpm -F @modeldoctor/web test -- FigureRenderer`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/charts/ThroughputConcurrencyChart.tsx apps/web/src/features/benchmarks/compare/FigureRenderer.tsx apps/web/src/features/benchmarks/compare/FigureRenderer.test.tsx
git commit -m "feat(web): throughput-vs-concurrency capacity figure"
```

---

## Final verification

- [ ] **Whole-workspace build + lint + test**

Run: `pnpm -r build && pnpm -r lint && pnpm -r test`
Expected: all PASS. (First run in this worktree: `pnpm -r build` must precede api typecheck.)

- [ ] **Manual smoke (optional, single dev session — kill it after):** start `pnpm dev`, open an lb-strategy SavedCompare, click「Generate AI report」, confirm the report leads with hit-rate and shows the per-pod distribution figure; open a capacity compare and confirm the throughput-vs-concurrency curve. Kill the dev server.

- [ ] **Follow-up issue comments (per CLAUDE.md / [[feedback_temp_followups]]):** post comments noting the Phase-2 deferrals (latency-distribution needs rawOutput wiring; lb traffic-topology + hit-rate timeseries need request logs / interval snapshots; evalscope/aiperf sample histograms; aiperf KV-cache field) on the relevant tracking issue.

- [ ] **Open the PR** once green (see CLAUDE.md PR follow-through).

---

## Self-review notes (author)

- **Spec coverage:** selection layer (A), profile registry + 5 scenarios (B), synthesizer wiring (C), Phase-1 figures incl. lb per-pod (D), capacity sweep curve (E). All §6 scope items covered. `latency-distribution` intentionally Phase-2 (spec-corrected — needs rawOutput, not hydrated in compare).
- **Ordering caveat:** B3 (lb profile) imports `readPodDistribution` and `pod-*` refIds from Group D — execute D1–D2 before B3 builds (noted inline in B3 Step 3).
- **Mirror discipline:** every figure-availability change touches BOTH `apps/api/.../metrics.ts` and `apps/web/.../client-metrics.ts` (D2, E3). The "keep in sync" comments are load-bearing.
- **Name consistency:** `readPodDistribution`, `readCapacityCurve`, `resolveReportIntent`, `getReportProfile`, `buildSystemPrompt`, `deriveCompareDims`, `ScenarioData.{promptBlock,preferredFigures}`, `ReportScenarioProfile.{intent,promptFragment,dataAssembly}` used consistently across tasks.
</content>
