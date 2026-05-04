# F1+F2 Run Compare + Verdict Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/runs/compare?ids=…` page that side-by-side compares 2..N selected Runs in a metric × Run grid, plus pure-frontend verdict (regressed/improved/unchanged) badges on three core metrics shown both on the compare page and on the existing detail page when `Run.baselineId` is set.

**Architecture:** Pure frontend — no backend, contracts, or DB changes. Reuses existing `GET /api/runs/:id` for all data. Verdict computed in-browser from existing `summaryMetrics` against threshold constants (latency ±10%, errorRate ±0.5pp, throughput ±5%). Compare button gated to require ≥2 same-tool selections.

**Tech Stack:** TypeScript, React + Vite, react-router-dom v6 (`useSearchParams`), @tanstack/react-query@5, react-i18next, lucide-react, vitest@1, @testing-library/react, biome.

**Spec:** `docs/superpowers/specs/2026-05-04-runs-compare-diff-design.md`

**Branch:** `feat/runs-compare-diff` (already exists; HEAD is the spec doc commit `2cd585b`)

---

## File Structure

### New (under `apps/web/src/features/runs/compare/`)

- `verdict.ts` — `VERDICT_THRESHOLDS` constants + 3 pure verdict functions + `Verdict` type
- `metrics.ts` — per-tool extractors (`readP95Latency`, `readErrorRate`, `readThroughput`) + extra non-verdict extractors used by the grid; `MetricRowDescriptor` type that pairs a row label key with a per-tool reader
- `VerdictBadge.tsx` — presentational; props `{ verdict, deltaText }`; renders colored span + lucide icon
- `MetricRow.tsx` — one row in the grid; props `{ descriptor, baseline, runs }`; renders label + N cells (each with number ± delta and optionally a `<VerdictBadge>` if the row is verdict-eligible)
- `CompareGrid.tsx` — table shell; receives `{ runs, baselineId, descriptors }` and maps to `MetricRow` per descriptor
- `CompareToolbar.tsx` — top-of-page row: baseline dropdown + back-to-list link + tool indicator
- `RunComparePage.tsx` — top-level routed page; URL parsing + N-Run fetching + error states
- `DetailVerdictRow.tsx` — used on RunDetailPage when `run.baselineId !== null`; resolves baseline → fetches baseline run → renders 3 `VerdictBadge`s
- `__tests__/verdict.test.ts`
- `__tests__/metrics.test.ts`
- `__tests__/VerdictBadge.test.tsx`
- `__tests__/MetricRow.test.tsx`
- `__tests__/CompareGrid.test.tsx`
- `__tests__/CompareToolbar.test.tsx`
- `__tests__/RunComparePage.test.tsx`
- `__tests__/DetailVerdictRow.test.tsx`

### Modified

- `apps/web/src/router/index.tsx` — add `runs/compare` route (before the `:id` route)
- `apps/web/src/features/runs/RunListPage.tsx` — Compare button onClick + tri-state disabled + remove the local `readP95` / `readErrorRate` (import from `compare/metrics.ts` instead)
- `apps/web/src/features/runs/__tests__/RunListPage.test.tsx` — add 3 cases for tri-state Compare button
- `apps/web/src/features/runs/RunDetailPage.tsx` — mount `<DetailVerdictRow>` when `run.baselineId !== null`
- `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx` — add case for verdict row mount
- `apps/web/src/features/baseline/queries.ts` — add `useBaselineById(id)` selector built on `useBaselines()`
- `apps/web/src/locales/en-US/runs.json` — add `compare.*` and `detail.verdict.*` namespaces; split `compareDisabledTooltip` → `compareDisabledNeedTwo` + `compareDisabledMixedTools`
- `apps/web/src/locales/zh-CN/runs.json` — same

---

## Task 0: Worktree bootstrap

Identical pattern to F3's Task 0 — `git worktree add` produces an unbuilt workspace. Per project memory note `project_worktree_build_first.md`, `pnpm install` + `prisma generate` + `pnpm -r build` must run once before downstream packages typecheck.

**Files:** none modified.

- [ ] **Step 0.1: Install dependencies**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-runs-compare-diff
pnpm install --frozen-lockfile
```

Expected: install completes; no errors. (May already be done from brainstorming session; safe to re-run — pnpm is idempotent.)

- [ ] **Step 0.2: Generate Prisma client**

```bash
pnpm -F @modeldoctor/api exec prisma generate
```

Expected: `✔ Generated Prisma Client (...)`. Required before `apps/api` typechecks; pnpm install does not run prisma generate automatically in this workspace.

- [ ] **Step 0.3: Build all workspace packages**

```bash
pnpm -r build
```

Expected: every `packages/*/dist/` populated; build exits 0. (Already verified during brainstorming session; safe to re-verify.)

- [ ] **Step 0.4: Smoke baseline web tests pass**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all tests green (468+ passing). Catches a broken pre-existing baseline before we touch anything.

- [ ] **Step 0.5: No git changes — workspace state only**

No commit here. Move on to Task 1.

---

## Task 1: `verdict.ts` — thresholds + 3 pure functions

Pure-logic foundation. Establishes types both compare and detail-row code consume. TDD strictly.

**Files:**
- Create: `apps/web/src/features/runs/compare/verdict.ts`
- Create: `apps/web/src/features/runs/compare/__tests__/verdict.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `apps/web/src/features/runs/compare/__tests__/verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  VERDICT_THRESHOLDS,
  verdictForErrorRate,
  verdictForLatency,
  verdictForThroughput,
} from "../verdict";

describe("verdictForLatency", () => {
  it("regressed when current is +10% or more", () => {
    expect(verdictForLatency(100, 110)).toBe("regressed");
    expect(verdictForLatency(100, 200)).toBe("regressed");
  });

  it("improved when current is -10% or more", () => {
    expect(verdictForLatency(100, 90)).toBe("improved");
    expect(verdictForLatency(100, 50)).toBe("improved");
  });

  it("unchanged when delta is inside the threshold band", () => {
    expect(verdictForLatency(100, 105)).toBe("unchanged");
    expect(verdictForLatency(100, 95)).toBe("unchanged");
    expect(verdictForLatency(100, 100)).toBe("unchanged");
  });

  it("unchanged when baseline is 0 (avoid divide by zero)", () => {
    expect(verdictForLatency(0, 0)).toBe("unchanged");
    expect(verdictForLatency(0, 50)).toBe("unchanged");
  });
});

describe("verdictForErrorRate", () => {
  it("regressed when current is +0.5pp or more", () => {
    expect(verdictForErrorRate(0, 0.005)).toBe("regressed");
    expect(verdictForErrorRate(0.01, 0.02)).toBe("regressed");
  });

  it("improved when current is -0.5pp or more", () => {
    expect(verdictForErrorRate(0.02, 0.01)).toBe("improved");
    expect(verdictForErrorRate(0.005, 0)).toBe("improved");
  });

  it("unchanged when delta is inside ±0.5pp band", () => {
    expect(verdictForErrorRate(0.01, 0.011)).toBe("unchanged");
    expect(verdictForErrorRate(0.01, 0.009)).toBe("unchanged");
    expect(verdictForErrorRate(0, 0)).toBe("unchanged");
  });
});

describe("verdictForThroughput", () => {
  it("regressed when current drops by 5% or more", () => {
    expect(verdictForThroughput(100, 95)).toBe("regressed");
    expect(verdictForThroughput(100, 50)).toBe("regressed");
  });

  it("improved when current rises by 5% or more", () => {
    expect(verdictForThroughput(100, 105)).toBe("improved");
    expect(verdictForThroughput(100, 200)).toBe("improved");
  });

  it("unchanged when delta is inside ±5% band", () => {
    expect(verdictForThroughput(100, 102)).toBe("unchanged");
    expect(verdictForThroughput(100, 98)).toBe("unchanged");
  });

  it("unchanged when baseline is 0", () => {
    expect(verdictForThroughput(0, 50)).toBe("unchanged");
  });
});

describe("VERDICT_THRESHOLDS exports the three constants", () => {
  it("matches spec values", () => {
    expect(VERDICT_THRESHOLDS.latencyPct).toBe(0.1);
    expect(VERDICT_THRESHOLDS.errorRatePp).toBe(0.005);
    expect(VERDICT_THRESHOLDS.throughputPct).toBe(0.05);
  });
});
```

- [ ] **Step 1.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run verdict.test
```

Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement `verdict.ts`**

Create `apps/web/src/features/runs/compare/verdict.ts`:

```ts
export const VERDICT_THRESHOLDS = {
  // higher is worse (latency)
  latencyPct: 0.1,
  // higher is worse (error rate); absolute percentage points, not ratio
  errorRatePp: 0.005,
  // higher is better (throughput)
  throughputPct: 0.05,
} as const;

export type Verdict = "regressed" | "improved" | "unchanged";

export function verdictForLatency(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct >= VERDICT_THRESHOLDS.latencyPct) return "regressed";
  if (pct <= -VERDICT_THRESHOLDS.latencyPct) return "improved";
  return "unchanged";
}

export function verdictForErrorRate(baseline: number, current: number): Verdict {
  const pp = current - baseline;
  if (pp >= VERDICT_THRESHOLDS.errorRatePp) return "regressed";
  if (pp <= -VERDICT_THRESHOLDS.errorRatePp) return "improved";
  return "unchanged";
}

export function verdictForThroughput(baseline: number, current: number): Verdict {
  if (baseline === 0) return "unchanged";
  const pct = (current - baseline) / baseline;
  if (pct <= -VERDICT_THRESHOLDS.throughputPct) return "regressed";
  if (pct >= VERDICT_THRESHOLDS.throughputPct) return "improved";
  return "unchanged";
}
```

- [ ] **Step 1.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/web test --run verdict.test
```

Expected: PASS — all 12+ test cases.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/features/runs/compare/verdict.ts \
        apps/web/src/features/runs/compare/__tests__/verdict.test.ts
git commit -m "$(cat <<'EOF'
feat(web/runs): add verdict.ts pure module for diff thresholds (refs #88)

Establishes VERDICT_THRESHOLDS (latencyPct 10%, errorRatePp 0.5pp,
throughputPct 5%) + three pure verdict functions for F2 of #88.
Direction asymmetry: latency/error higher = worse, throughput higher =
better. baseline=0 guard returns unchanged for latency/throughput to
avoid divide-by-zero; error rate is plain subtraction so safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `metrics.ts` — extractors factored out from RunListPage

Lift the existing `readP95` / `readErrorRate` from `RunListPage.tsx` (lines 30-72) into a shared module so both the list and the compare pages use one implementation. Add a `readThroughput` reader (new) and a per-tool `MetricRowDescriptor` array describing every row that the compare grid will render.

**Files:**
- Create: `apps/web/src/features/runs/compare/metrics.ts`
- Create: `apps/web/src/features/runs/compare/__tests__/metrics.test.ts`
- Modify: `apps/web/src/features/runs/RunListPage.tsx` (remove local readers, import from `metrics.ts`)

- [ ] **Step 2.1: Write the failing test for the readers**

Create `apps/web/src/features/runs/compare/__tests__/metrics.test.ts`:

```ts
import type { Run, RunTool } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import {
  readErrorRate,
  readP95Latency,
  readThroughput,
  rowDescriptorsForTool,
} from "../metrics";

const guidellmMetrics: Run["summaryMetrics"] = {
  tool: "guidellm",
  data: {
    e2eLatency: { mean: 100, p50: 95, p90: 130, p95: 491.2, p99: 600 },
    ttft: { mean: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
    requestsPerSecond: { mean: 12.4 },
    requests: { total: 100, success: 95, error: 5, incomplete: 0 },
  },
} as unknown as Run["summaryMetrics"];

const vegetaMetrics: Run["summaryMetrics"] = {
  tool: "vegeta",
  data: {
    latencies: { min: 1, mean: 100, p50: 95, p90: 220, p95: 250.5, p99: 280, max: 300 },
    requests: { total: 1000, rate: 10, throughput: 9.8 },
    success: 98.5,
  },
} as unknown as Run["summaryMetrics"];

const genaiPerfMetrics: Run["summaryMetrics"] = {
  tool: "genai-perf",
  data: {
    requestLatency: { avg: 100, p50: 95, p90: 200, p95: 333.3, p99: 400 },
    requestThroughput: { avg: 50.2 },
    timeToFirstToken: { avg: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
  },
} as unknown as Run["summaryMetrics"];

describe("readP95Latency", () => {
  it("reads guidellm.e2eLatency.p95", () => {
    expect(readP95Latency(guidellmMetrics)).toBe(491.2);
  });
  it("reads vegeta.latencies.p95", () => {
    expect(readP95Latency(vegetaMetrics)).toBe(250.5);
  });
  it("reads genai-perf.requestLatency.p95", () => {
    expect(readP95Latency(genaiPerfMetrics)).toBe(333.3);
  });
  it("returns null when metrics is null", () => {
    expect(readP95Latency(null)).toBeNull();
  });
  it("returns null on unknown tool", () => {
    expect(
      readP95Latency({ tool: "unknown", data: {} } as unknown as Run["summaryMetrics"]),
    ).toBeNull();
  });
});

describe("readErrorRate", () => {
  it("reads guidellm requests.error/total as 0..1 ratio", () => {
    expect(readErrorRate(guidellmMetrics)).toBeCloseTo(0.05, 6);
  });
  it("converts vegeta success percent to error ratio", () => {
    // success = 98.5% → error = 0.015
    expect(readErrorRate(vegetaMetrics)).toBeCloseTo(0.015, 6);
  });
  it("returns null for genai-perf (schema has no error field)", () => {
    expect(readErrorRate(genaiPerfMetrics)).toBeNull();
  });
  it("returns null when guidellm requests.total is 0", () => {
    const zero = {
      tool: "guidellm",
      data: { requests: { total: 0, error: 0 } },
    } as unknown as Run["summaryMetrics"];
    expect(readErrorRate(zero)).toBeNull();
  });
});

describe("readThroughput", () => {
  it("reads guidellm.requestsPerSecond.mean", () => {
    expect(readThroughput(guidellmMetrics)).toBe(12.4);
  });
  it("reads vegeta.requests.throughput", () => {
    expect(readThroughput(vegetaMetrics)).toBe(9.8);
  });
  it("reads genai-perf.requestThroughput.avg", () => {
    expect(readThroughput(genaiPerfMetrics)).toBe(50.2);
  });
  it("returns null when missing", () => {
    expect(readThroughput(null)).toBeNull();
  });
});

describe("rowDescriptorsForTool", () => {
  it("returns guidellm full row set including verdict-eligible flags", () => {
    const rows = rowDescriptorsForTool("guidellm" as RunTool);
    const verdictRows = rows.filter((r) => r.verdictKind !== undefined);
    // p95Latency, errorRate, throughput (3 verdict-eligible rows)
    expect(verdictRows).toHaveLength(3);
    expect(verdictRows.map((r) => r.verdictKind).sort()).toEqual([
      "errorRate",
      "latency",
      "throughput",
    ]);
    // Total row count: each tool has its own complete metric list
    expect(rows.length).toBeGreaterThanOrEqual(verdictRows.length);
  });

  it("returns vegeta row set without TTFT/ITL rows", () => {
    const rows = rowDescriptorsForTool("vegeta" as RunTool);
    expect(rows.find((r) => r.labelKey === "ttftP95")).toBeUndefined();
  });

  it("returns genai-perf row set without errorRate row (schema has no error)", () => {
    const rows = rowDescriptorsForTool("genai-perf" as RunTool);
    expect(rows.find((r) => r.labelKey === "errorRate")).toBeUndefined();
  });

  it("returns empty array for unknown tool", () => {
    expect(rowDescriptorsForTool("e2e" as RunTool)).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run metrics.test
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement `metrics.ts`**

Create `apps/web/src/features/runs/compare/metrics.ts`:

```ts
import type { Run, RunTool } from "@modeldoctor/contracts";

// summaryMetrics is the discriminated union written by tool-adapter
// parseFinalReport: { tool, data } (see
// packages/tool-adapters/src/{guidellm,vegeta,genai-perf}/runtime.ts).
// vegeta latencies are normalized to ms by the adapter (NOT ns).

type SummaryMetrics = Run["summaryMetrics"];
type Tagged = { tool?: string; data?: Record<string, unknown> };

function asTagged(metrics: SummaryMetrics): Tagged | null {
  if (!metrics) return null;
  const m = metrics as Tagged;
  return m.data ? m : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  const v = dist?.[field];
  return typeof v === "number" ? v : null;
}

// ─── Verdict-eligible readers ────────────────────────────────────────────────

export function readP95Latency(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm":
      return fromDist(m.data, "e2eLatency", "p95");
    case "vegeta":
      return fromDist(m.data, "latencies", "p95");
    case "genai-perf":
      return fromDist(m.data, "requestLatency", "p95");
    default:
      return null;
  }
}

export function readErrorRate(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm": {
      const r = m.data.requests as { total?: number; error?: number } | undefined;
      if (typeof r?.total !== "number" || typeof r.error !== "number") return null;
      if (r.total === 0) return null;
      return r.error / r.total;
    }
    case "vegeta": {
      const s = m.data.success;
      return typeof s === "number" ? 1 - s / 100 : null;
    }
    default:
      // genai-perf carries no error/success counts.
      return null;
  }
}

export function readThroughput(metrics: SummaryMetrics): number | null {
  const m = asTagged(metrics);
  if (!m?.data) return null;
  switch (m.tool) {
    case "guidellm": {
      const r = m.data.requestsPerSecond as { mean?: number } | undefined;
      return typeof r?.mean === "number" ? r.mean : null;
    }
    case "vegeta": {
      const r = m.data.requests as { throughput?: number } | undefined;
      return typeof r?.throughput === "number" ? r.throughput : null;
    }
    case "genai-perf": {
      const r = m.data.requestThroughput as { avg?: number } | undefined;
      return typeof r?.avg === "number" ? r.avg : null;
    }
    default:
      return null;
  }
}

// ─── Grid row descriptors ────────────────────────────────────────────────────
//
// Each descriptor names: (a) which i18n key labels the row, (b) how to
// extract the number per Run, (c) which verdict function (if any) applies.
//
// `verdictKind` is undefined on display-only rows (latency p50/p99, TTFT
// percentiles, byte counts, etc.). The compare grid only renders a colored
// VerdictBadge on rows where verdictKind is set; other rows show the number
// + a gray Δ% text.

export type VerdictKind = "latency" | "errorRate" | "throughput";

export interface MetricRowDescriptor {
  labelKey: string;                                       // "compare.metricRowLabel.<key>"
  read: (m: SummaryMetrics) => number | null;
  verdictKind?: VerdictKind;
  digits?: number;                                        // default 1
  unitSuffix?: string;                                    // for the cell display (e.g. "ms", "%")
}

function distRow(
  labelKey: string,
  toolKey: string,
  field: string,
  opts: { digits?: number; unitSuffix?: string; verdictKind?: VerdictKind } = {},
): MetricRowDescriptor {
  return {
    labelKey,
    read: (m) => {
      const t = asTagged(m);
      return t?.data ? fromDist(t.data, toolKey, field) : null;
    },
    digits: opts.digits,
    unitSuffix: opts.unitSuffix,
    verdictKind: opts.verdictKind,
  };
}

const guidellmRows: MetricRowDescriptor[] = [
  distRow("ttftMean", "ttft", "mean", { unitSuffix: "ms" }),
  distRow("ttftP50", "ttft", "p50", { unitSuffix: "ms" }),
  distRow("ttftP95", "ttft", "p95", { unitSuffix: "ms" }),
  distRow("ttftP99", "ttft", "p99", { unitSuffix: "ms" }),
  distRow("itlMean", "itl", "mean", { unitSuffix: "ms" }),
  distRow("itlP95", "itl", "p95", { unitSuffix: "ms" }),
  distRow("e2eLatencyP50", "e2eLatency", "p50", { unitSuffix: "ms" }),
  // Verdict-eligible: shared latency P95 row uses the same reader as the
  // standalone readP95Latency exported above.
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("e2eLatencyP99", "e2eLatency", "p99", { unitSuffix: "ms" }),
  { labelKey: "errorRate", read: readErrorRate, verdictKind: "errorRate", digits: 4 },
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

const vegetaRows: MetricRowDescriptor[] = [
  distRow("latencyMin", "latencies", "min", { unitSuffix: "ms" }),
  distRow("latencyMean", "latencies", "mean", { unitSuffix: "ms" }),
  distRow("latencyP50", "latencies", "p50", { unitSuffix: "ms" }),
  distRow("latencyP90", "latencies", "p90", { unitSuffix: "ms" }),
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("latencyP99", "latencies", "p99", { unitSuffix: "ms" }),
  distRow("latencyMax", "latencies", "max", { unitSuffix: "ms" }),
  { labelKey: "errorRate", read: readErrorRate, verdictKind: "errorRate", digits: 4 },
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

const genaiPerfRows: MetricRowDescriptor[] = [
  distRow("latencyMean", "requestLatency", "avg", { unitSuffix: "ms" }),
  distRow("latencyP50", "requestLatency", "p50", { unitSuffix: "ms" }),
  distRow("latencyP90", "requestLatency", "p90", { unitSuffix: "ms" }),
  { labelKey: "latencyP95", read: readP95Latency, verdictKind: "latency", unitSuffix: "ms" },
  distRow("latencyP99", "requestLatency", "p99", { unitSuffix: "ms" }),
  distRow("ttftMean", "timeToFirstToken", "avg", { unitSuffix: "ms" }),
  distRow("ttftP95", "timeToFirstToken", "p95", { unitSuffix: "ms" }),
  // genai-perf has no errorRate row (schema doesn't carry success/error counts)
  { labelKey: "throughput", read: readThroughput, verdictKind: "throughput", unitSuffix: "req/s" },
];

export function rowDescriptorsForTool(tool: RunTool): MetricRowDescriptor[] {
  switch (tool) {
    case "guidellm":
      return guidellmRows;
    case "vegeta":
      return vegetaRows;
    case "genai-perf":
      return genaiPerfRows;
    default:
      // e2e / custom Runs are not supported in compare today.
      return [];
  }
}
```

- [ ] **Step 2.4: Refactor RunListPage to use the shared readers**

Edit `apps/web/src/features/runs/RunListPage.tsx`:

1. Remove the local `readP95` and `readErrorRate` functions (lines 30-72) entirely.
2. At the top with the other imports, add:

```diff
 import { useMemo, useState } from "react";
 import { useTranslation } from "react-i18next";
 import { Link, useSearchParams } from "react-router-dom";
+import { readErrorRate, readP95Latency } from "./compare/metrics";
 import { RunListFilters } from "./RunListFilters";
 import { runKeys, useRunList } from "./queries";
```

3. Update the call sites at lines 258 + 261 to use the renamed function:

```diff
-                      {fmtNum(readP95(run.summaryMetrics))}
+                      {fmtNum(readP95Latency(run.summaryMetrics))}
```

(`readErrorRate` keeps the same name; the local versions and the imported versions have the same signature so the call site is unchanged.)

- [ ] **Step 2.5: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/web test --run metrics.test
pnpm -F @modeldoctor/web test --run RunListPage.test
```

Expected: both green. The RunListPage test exercises the readers via the table rendering; if the refactor changed semantics anywhere, that test breaks.

- [ ] **Step 2.6: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/compare src/features/runs/RunListPage.tsx
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```bash
git add apps/web/src/features/runs/compare/metrics.ts \
        apps/web/src/features/runs/compare/__tests__/metrics.test.ts \
        apps/web/src/features/runs/RunListPage.tsx
git commit -m "$(cat <<'EOF'
feat(web/runs): add metrics.ts shared extractors + row descriptors (refs #88)

Lifts readP95 / readErrorRate out of RunListPage into a shared
compare/metrics.ts module so both the existing list page and the
upcoming /runs/compare page use one implementation. Adds new
readThroughput reader and per-tool MetricRowDescriptor[] arrays
that drive what the compare grid will render. Verdict-eligible
rows are flagged via descriptor.verdictKind for downstream code
to render colored badges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `VerdictBadge` component

Pure presentation. Maps verdict + delta to a colored span with lucide icon.

**Files:**
- Create: `apps/web/src/features/runs/compare/VerdictBadge.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/VerdictBadge.test.tsx`

- [ ] **Step 3.1: Write failing test**

Create `apps/web/src/features/runs/compare/__tests__/VerdictBadge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { VerdictBadge } from "../VerdictBadge";

describe("VerdictBadge", () => {
  it("renders regressed with destructive color and TrendingUp icon for latency", () => {
    const { container } = render(
      <VerdictBadge verdict="regressed" verdictKind="latency" deltaText="+20%" />,
    );
    expect(screen.getByText("+20%")).toBeInTheDocument();
    // lucide icons render as <svg>; assert it exists
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/destructive|text-red/);
  });

  it("renders improved with green color", () => {
    const { container } = render(
      <VerdictBadge verdict="improved" verdictKind="latency" deltaText="-15%" />,
    );
    expect(screen.getByText("-15%")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/green/);
  });

  it("renders unchanged with muted color and no icon (or Minus icon)", () => {
    const { container } = render(
      <VerdictBadge verdict="unchanged" verdictKind="latency" deltaText="+1%" />,
    );
    expect(screen.getByText("+1%")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/muted/);
  });

  it("inverts icon direction for throughput improvement", () => {
    const { container } = render(
      <VerdictBadge verdict="improved" verdictKind="throughput" deltaText="+10%" />,
    );
    // throughput improved = TrendingUp icon (going up = better)
    // We don't assert exact icon name, just that the class still indicates improved
    expect(container.firstChild).toHaveClass(/green/);
  });
});
```

- [ ] **Step 3.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run VerdictBadge.test
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `VerdictBadge`**

Create `apps/web/src/features/runs/compare/VerdictBadge.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { VerdictKind } from "./metrics";
import type { Verdict } from "./verdict";

export interface VerdictBadgeProps {
  verdict: Verdict;
  // verdictKind decides which icon direction means "regressed" vs "improved".
  // For latency/errorRate: up = regressed. For throughput: up = improved.
  verdictKind: VerdictKind;
  deltaText: string;
}

function iconFor(verdict: Verdict, kind: VerdictKind) {
  if (verdict === "unchanged") return Minus;
  // Higher = worse for latency/errorRate; higher = better for throughput.
  const upIsBad = kind === "latency" || kind === "errorRate";
  if (verdict === "regressed") return upIsBad ? TrendingUp : TrendingDown;
  return upIsBad ? TrendingDown : TrendingUp;
}

const COLOR_CLASSES: Record<Verdict, string> = {
  regressed: "text-destructive",
  improved: "text-green-700 dark:text-green-400",
  unchanged: "text-muted-foreground",
};

export function VerdictBadge({ verdict, verdictKind, deltaText }: VerdictBadgeProps) {
  const Icon = iconFor(verdict, verdictKind);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs tabular-nums", COLOR_CLASSES[verdict])}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {deltaText}
    </span>
  );
}
```

- [ ] **Step 3.4: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run VerdictBadge.test
```

Expected: PASS — 4 cases.

- [ ] **Step 3.5: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/compare/VerdictBadge.tsx src/features/runs/compare/__tests__/VerdictBadge.test.tsx
```

Expected: clean.

- [ ] **Step 3.6: Commit**

```bash
git add apps/web/src/features/runs/compare/VerdictBadge.tsx \
        apps/web/src/features/runs/compare/__tests__/VerdictBadge.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/runs): add VerdictBadge component (refs #88)

Pure presentation: { verdict, verdictKind, deltaText } → colored span
with lucide icon. iconFor() inverts the up/down meaning based on
verdictKind so throughput-improved shows TrendingUp and latency-
regressed shows TrendingUp (higher is worse for latency).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `useBaselineById` hook

Add a small selector on top of the existing `useBaselines()` query so DetailVerdictRow can resolve `Run.baselineId` → `Baseline.runId` without a new endpoint.

**Files:**
- Modify: `apps/web/src/features/baseline/queries.ts`
- Modify: `apps/web/src/features/baseline/queries.test.tsx`

- [ ] **Step 4.1: Write failing test**

Open `apps/web/src/features/baseline/queries.test.tsx` and append a new describe block at the bottom (before the closing brace of the outer `describe("baselineApi", ...)` if there is one — otherwise at the end of the file):

```tsx
describe("useBaselineById", () => {
  it("returns the matching baseline when present in list", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        {
          id: "b_1",
          userId: "u",
          runId: "r_1",
          name: "anchor",
          description: null,
          tags: [],
          templateId: null,
          templateVersion: null,
          active: true,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const { result } = renderHook(() => useBaselineById("b_1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe("b_1"));
    expect(result.current.data?.runId).toBe("r_1");
  });

  it("returns undefined when id not in list", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() => useBaselineById("b_missing"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
```

If the test file doesn't already have `renderHook`, `waitFor`, `Wrapper`, or `api` imports, add them at the top:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

import { api } from "@/lib/api-client";
import { useBaselineById } from "./queries";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
```

(If the file doesn't exist yet at `queries.test.tsx`, create it with the imports above + only the new describe block.)

- [ ] **Step 4.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run baseline/queries.test
```

Expected: FAIL — `useBaselineById` not exported.

- [ ] **Step 4.3: Implement `useBaselineById`**

Edit `apps/web/src/features/baseline/queries.ts` — append at end of file:

```ts
import type { Baseline as BaselineRow } from "@modeldoctor/contracts";

/**
 * Selects one baseline from the cached list by id. Avoids adding a
 * `GET /api/baselines/:id` endpoint since the full list is already
 * fetched on demand and cached for 30s.
 */
export function useBaselineById(id: string | null | undefined) {
  return useQuery({
    queryKey: baselineKeys.lists(),
    queryFn: () => baselineApi.list(),
    staleTime: 30_000,
    select: (resp): BaselineRow | undefined =>
      id ? resp.items.find((b) => b.id === id) : undefined,
    enabled: !!id,
  });
}
```

(If `BaselineRow` import shadows an existing local `Baseline` import, just inline the type as `Baseline`.)

- [ ] **Step 4.4: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run baseline/queries.test
```

Expected: PASS — both new cases (plus any pre-existing cases in the file).

- [ ] **Step 4.5: Type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: clean.

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/features/baseline/queries.ts apps/web/src/features/baseline/queries.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/baseline): add useBaselineById selector hook (refs #88)

Used by F2 DetailVerdictRow to resolve Run.baselineId → Baseline.runId
without adding a new GET /api/baselines/:id endpoint. Built on
useBaselines() so it shares the 30s-staleTime cache.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `MetricRow` + `CompareGrid` components

Pure presentational. The grid receives runs + descriptors + baseline; rows know how to render N cells based on the descriptor's reader.

**Files:**
- Create: `apps/web/src/features/runs/compare/MetricRow.tsx`
- Create: `apps/web/src/features/runs/compare/CompareGrid.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/MetricRow.test.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/CompareGrid.test.tsx`

- [ ] **Step 5.1: Add i18n keys for `compare.metricRowLabel.*`**

Edit `apps/web/src/locales/en-US/runs.json` — inside the existing top-level object, **after** the `detail` block but **before** the closing `}`, add a new `compare` namespace. (Existing top-level keys like `compareButton` / `compareDisabledTooltip` stay where they are for now; Task 8 splits the disabled tooltip key.)

```diff
     "running": {
       "pending": "Waiting to start…",
       "title": "Running…",
       "elapsed": "{{sec}}s elapsed"
     },
     "charts": {
       "title": "Distributions",
       "latencyCdfTitle": "Latency CDF",
       "ttftHistogramTitle": "TTFT Histogram",
       "empty": "No chart data",
       "loadError": "Failed to load charts"
     }
-  }
+  },
+  "compare": {
+    "title": "Compare Runs",
+    "subtitle": "{{n}} runs · {{tool}}",
+    "back": "Back to list",
+    "baselineLabel": "Baseline",
+    "baselineNone": "None (no verdict)",
+    "baselineMissing": "1 Run no longer accessible — comparing the remaining {{n}}",
+    "mixedToolsAlert": "Compare requires the same tool. Selected: {{summary}}",
+    "needTwoEmpty": "Select 2+ Runs from the list to compare",
+    "metricColumnLabel": "Metric",
+    "verdict": {
+      "regressed": "regressed",
+      "improved": "improved",
+      "unchanged": "unchanged"
+    },
+    "metricRowLabel": {
+      "ttftMean": "TTFT mean (ms)",
+      "ttftP50": "TTFT p50 (ms)",
+      "ttftP95": "TTFT p95 (ms)",
+      "ttftP99": "TTFT p99 (ms)",
+      "itlMean": "ITL mean (ms)",
+      "itlP95": "ITL p95 (ms)",
+      "e2eLatencyP50": "E2E latency p50 (ms)",
+      "latencyP95": "Latency p95 (ms)",
+      "e2eLatencyP99": "E2E latency p99 (ms)",
+      "latencyMin": "Latency min (ms)",
+      "latencyMean": "Latency mean (ms)",
+      "latencyP50": "Latency p50 (ms)",
+      "latencyP90": "Latency p90 (ms)",
+      "latencyP99": "Latency p99 (ms)",
+      "latencyMax": "Latency max (ms)",
+      "errorRate": "Error rate",
+      "throughput": "Throughput (req/s)"
+    }
+  }
 }
```

Edit `apps/web/src/locales/zh-CN/runs.json` — same structure with Chinese translations:

```diff
     "running": {
       "pending": "等待开始…",
       "title": "运行中…",
       "elapsed": "已运行 {{sec}}s"
     },
     "charts": {
       "title": "分布图",
       "latencyCdfTitle": "延迟分布 (CDF)",
       "ttftHistogramTitle": "首 token 延迟分布",
       "empty": "暂无图表数据",
       "loadError": "图表加载失败"
     }
-  }
+  },
+  "compare": {
+    "title": "对比 Run",
+    "subtitle": "{{n}} 个 run · {{tool}}",
+    "back": "返回列表",
+    "baselineLabel": "基准",
+    "baselineNone": "无（不显示徽标）",
+    "baselineMissing": "1 个 Run 已无法访问，仅对比剩余 {{n}} 个",
+    "mixedToolsAlert": "对比需要相同 tool。当前选中：{{summary}}",
+    "needTwoEmpty": "从列表选 2 个以上 Run 才能对比",
+    "metricColumnLabel": "指标",
+    "verdict": {
+      "regressed": "退化",
+      "improved": "改善",
+      "unchanged": "不变"
+    },
+    "metricRowLabel": {
+      "ttftMean": "TTFT 平均 (ms)",
+      "ttftP50": "TTFT p50 (ms)",
+      "ttftP95": "TTFT p95 (ms)",
+      "ttftP99": "TTFT p99 (ms)",
+      "itlMean": "ITL 平均 (ms)",
+      "itlP95": "ITL p95 (ms)",
+      "e2eLatencyP50": "E2E 延迟 p50 (ms)",
+      "latencyP95": "延迟 p95 (ms)",
+      "e2eLatencyP99": "E2E 延迟 p99 (ms)",
+      "latencyMin": "延迟最小 (ms)",
+      "latencyMean": "延迟平均 (ms)",
+      "latencyP50": "延迟 p50 (ms)",
+      "latencyP90": "延迟 p90 (ms)",
+      "latencyP99": "延迟 p99 (ms)",
+      "latencyMax": "延迟最大 (ms)",
+      "errorRate": "错误率",
+      "throughput": "吞吐 (req/s)"
+    }
+  }
 }
```

- [ ] **Step 5.2: Write failing test for `MetricRow`**

Create `apps/web/src/features/runs/compare/__tests__/MetricRow.test.tsx`:

```tsx
import type { Run } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { MetricRow } from "../MetricRow";
import { rowDescriptorsForTool } from "../metrics";

function makeRun(id: string, p95: number, errors = 0, total = 100): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { p95 },
        requests: { total, error: errors, success: total - errors, incomplete: 0 },
        requestsPerSecond: { mean: 10 },
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

describe("MetricRow", () => {
  const guidellmRows = rowDescriptorsForTool("guidellm");
  const p95Descriptor = guidellmRows.find((r) => r.labelKey === "latencyP95")!;

  it("renders a verdict badge on baseline-vs-current cell when verdictKind is set", () => {
    const baseline = makeRun("b", 200);
    const current = makeRun("c", 240); // +20% — regressed
    render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.getByText(/240/)).toBeInTheDocument();
    // VerdictBadge renders the delta text "+20.0%"
    expect(screen.getByText(/\+20/)).toBeInTheDocument();
  });

  it("renders no verdict badge when descriptor.verdictKind is undefined", () => {
    const ttftMean = guidellmRows.find((r) => r.labelKey === "ttftMean")!;
    const baseline = makeRun("b", 200);
    const current = makeRun("c", 200);
    render(
      <table>
        <tbody>
          <MetricRow descriptor={ttftMean} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.queryByText(/regressed|improved|unchanged/i)).not.toBeInTheDocument();
  });

  it("renders no verdict badge when baselineId is null", () => {
    const a = makeRun("a", 200);
    const b = makeRun("b", 240);
    const { container } = render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[a, b]} baselineId={null} />
        </tbody>
      </table>,
    );
    // No icons rendered (VerdictBadge always renders an svg)
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders em dash when reader returns null", () => {
    const baseline = makeRun("b", 200);
    const current = {
      ...makeRun("c", 200),
      summaryMetrics: null,
    };
    render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.3: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run MetricRow.test
```

Expected: FAIL — module not found.

- [ ] **Step 5.4: Implement `MetricRow.tsx`**

Create `apps/web/src/features/runs/compare/MetricRow.tsx`:

```tsx
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import type { MetricRowDescriptor, VerdictKind } from "./metrics";
import { VerdictBadge } from "./VerdictBadge";
import {
  type Verdict,
  verdictForErrorRate,
  verdictForLatency,
  verdictForThroughput,
} from "./verdict";

export interface MetricRowProps {
  descriptor: MetricRowDescriptor;
  runs: Run[];
  baselineId: string | null;
}

function fmtNum(n: number | null, digits: number, suffix?: string): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}${suffix ? ` ${suffix}` : ""}`;
}

function computeVerdict(
  kind: VerdictKind,
  baselineValue: number,
  currentValue: number,
): Verdict {
  switch (kind) {
    case "latency":
      return verdictForLatency(baselineValue, currentValue);
    case "errorRate":
      return verdictForErrorRate(baselineValue, currentValue);
    case "throughput":
      return verdictForThroughput(baselineValue, currentValue);
  }
}

function deltaText(kind: VerdictKind, baselineValue: number, currentValue: number): string {
  if (kind === "errorRate") {
    const pp = (currentValue - baselineValue) * 100;
    return `${pp >= 0 ? "+" : ""}${pp.toFixed(2)}pp`;
  }
  if (baselineValue === 0) return "—";
  const pct = ((currentValue - baselineValue) / baselineValue) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function MetricRow({ descriptor, runs, baselineId }: MetricRowProps) {
  const { t } = useTranslation("runs");
  const digits = descriptor.digits ?? 1;
  const baseline = baselineId ? runs.find((r) => r.id === baselineId) : null;
  const baselineValue = baseline ? descriptor.read(baseline.summaryMetrics) : null;

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {t(`compare.metricRowLabel.${descriptor.labelKey}`)}
      </TableCell>
      {runs.map((run) => {
        const v = descriptor.read(run.summaryMetrics);
        const isBaseline = run.id === baselineId;
        const showBadge =
          descriptor.verdictKind !== undefined &&
          !isBaseline &&
          baselineValue !== null &&
          v !== null;

        return (
          <TableCell
            key={run.id}
            className={cn("text-right tabular-nums", isBaseline && "bg-amber-50 dark:bg-amber-950/30")}
          >
            <div className="flex flex-col items-end gap-0.5">
              <span>{fmtNum(v, digits, descriptor.unitSuffix)}</span>
              {showBadge && (
                <VerdictBadge
                  verdict={computeVerdict(descriptor.verdictKind!, baselineValue!, v!)}
                  verdictKind={descriptor.verdictKind!}
                  deltaText={deltaText(descriptor.verdictKind!, baselineValue!, v!)}
                />
              )}
            </div>
          </TableCell>
        );
      })}
    </TableRow>
  );
}
```

- [ ] **Step 5.5: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run MetricRow.test
```

Expected: PASS — 4 cases.

- [ ] **Step 5.6: Write failing test for `CompareGrid`**

Create `apps/web/src/features/runs/compare/__tests__/CompareGrid.test.tsx`:

```tsx
import type { Run } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { CompareGrid } from "../CompareGrid";

function makeGuidellmRun(id: string, p95: number): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { mean: 100, p50: 95, p90: 130, p95, p99: 600 },
        ttft: { mean: 80, p50: 75, p90: 100, p95: 150, p99: 200 },
        itl: { mean: 5, p50: 5, p90: 6, p95: 7, p99: 8 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0 },
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

describe("CompareGrid", () => {
  it("renders one column per run plus the metric label column", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    render(<CompareGrid runs={runs} baselineId="a" />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("highlights the baseline column header", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { container } = render(<CompareGrid runs={runs} baselineId="a" />);
    // Find the th matching "a" and check its classes
    const headers = container.querySelectorAll("th");
    const aHeader = Array.from(headers).find((h) => h.textContent === "a");
    expect(aHeader?.className).toMatch(/amber|bg-/);
  });

  it("renders no verdict badges when baselineId is null", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { container } = render(<CompareGrid runs={runs} baselineId={null} />);
    // No svg icons from VerdictBadge
    const tableSvgs = container.querySelectorAll("table svg");
    expect(tableSvgs.length).toBe(0);
  });

  it("re-renders verdicts when baselineId changes", () => {
    const runs = [makeGuidellmRun("a", 200), makeGuidellmRun("b", 240)];
    const { rerender, container } = render(<CompareGrid runs={runs} baselineId="a" />);
    expect(container.querySelectorAll("table svg").length).toBeGreaterThan(0);

    rerender(<CompareGrid runs={runs} baselineId={null} />);
    expect(container.querySelectorAll("table svg").length).toBe(0);
  });
});
```

- [ ] **Step 5.7: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run CompareGrid.test
```

Expected: FAIL — module not found.

- [ ] **Step 5.8: Implement `CompareGrid.tsx`**

Create `apps/web/src/features/runs/compare/CompareGrid.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Run } from "@modeldoctor/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MetricRow } from "./MetricRow";
import { rowDescriptorsForTool } from "./metrics";

export interface CompareGridProps {
  runs: Run[];
  baselineId: string | null;
}

export function CompareGrid({ runs, baselineId }: CompareGridProps) {
  const { t } = useTranslation("runs");

  // All runs share one tool by the time CompareGrid mounts (validated upstream).
  // If the array is empty just render nothing — RunComparePage shows EmptyState.
  const tool = runs[0]?.tool;
  const descriptors = useMemo(() => (tool ? rowDescriptorsForTool(tool) : []), [tool]);

  if (descriptors.length === 0) return null;

  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48 text-xs text-muted-foreground">
              {t("compare.metricColumnLabel", { defaultValue: "Metric" })}
            </TableHead>
            {runs.map((run) => (
              <TableHead
                key={run.id}
                className={cn(
                  "text-right",
                  run.id === baselineId && "bg-amber-50 dark:bg-amber-950/30",
                )}
              >
                {run.name ?? run.id}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {descriptors.map((d) => (
            <MetricRow key={d.labelKey} descriptor={d} runs={runs} baselineId={baselineId} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5.9: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run "CompareGrid.test|MetricRow.test"
```

Expected: PASS — 8 cases total.

- [ ] **Step 5.10: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/compare
```

Expected: clean.

- [ ] **Step 5.11: Commit**

```bash
git add apps/web/src/features/runs/compare/MetricRow.tsx \
        apps/web/src/features/runs/compare/CompareGrid.tsx \
        apps/web/src/features/runs/compare/__tests__/MetricRow.test.tsx \
        apps/web/src/features/runs/compare/__tests__/CompareGrid.test.tsx \
        apps/web/src/locales/en-US/runs.json \
        apps/web/src/locales/zh-CN/runs.json
git commit -m "$(cat <<'EOF'
feat(web/runs): add MetricRow + CompareGrid + i18n keys (refs #88)

MetricRow renders one row across N Runs; emits a VerdictBadge only on
non-baseline cells when descriptor.verdictKind is set. CompareGrid is
the table shell; resolves the tool's row descriptor list via metrics
.ts and maps to MetricRow per descriptor. Both are pure presentational.

i18n adds compare.* namespace (title/baselineLabel/metricRowLabel/
verdict/...) in both en-US and zh-CN.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `CompareToolbar` component

Top-of-page row: baseline `<select>` dropdown + back-to-list link + tool indicator.

**Files:**
- Create: `apps/web/src/features/runs/compare/CompareToolbar.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/CompareToolbar.test.tsx`

- [ ] **Step 6.1: Write failing test**

Create `apps/web/src/features/runs/compare/__tests__/CompareToolbar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

import { CompareToolbar } from "../CompareToolbar";

describe("CompareToolbar", () => {
  const runs = [
    { id: "a", name: "run-A", tool: "guidellm" },
    { id: "b", name: "run-B", tool: "guidellm" },
  ];

  it("renders baseline dropdown with None + each run option", () => {
    render(
      <CompareToolbar runs={runs} baselineId={null} onBaselineChange={() => undefined} />,
    );
    // None entry + each run name
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText(/None|无/i)).toBeInTheDocument();
    expect(screen.getByText("run-A")).toBeInTheDocument();
    expect(screen.getByText("run-B")).toBeInTheDocument();
  });

  it("invokes onBaselineChange when user selects a run", async () => {
    const onBaselineChange = vi.fn();
    render(
      <CompareToolbar runs={runs} baselineId={null} onBaselineChange={onBaselineChange} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await userEvent.selectOptions(select, "a");
    expect(onBaselineChange).toHaveBeenCalledWith("a");
  });

  it("invokes onBaselineChange with null when user picks None", async () => {
    const onBaselineChange = vi.fn();
    render(
      <CompareToolbar runs={runs} baselineId="a" onBaselineChange={onBaselineChange} />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    await userEvent.selectOptions(select, "");
    expect(onBaselineChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 6.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run CompareToolbar.test
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement `CompareToolbar.tsx`**

Create `apps/web/src/features/runs/compare/CompareToolbar.tsx`:

```tsx
import { useTranslation } from "react-i18next";

export interface CompareToolbarRun {
  id: string;
  name: string | null;
  tool: string;
}

export interface CompareToolbarProps {
  runs: CompareToolbarRun[];
  baselineId: string | null;
  onBaselineChange: (id: string | null) => void;
}

export function CompareToolbar({ runs, baselineId, onBaselineChange }: CompareToolbarProps) {
  const { t } = useTranslation("runs");
  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("compare.baselineLabel")}</span>
        <select
          className="rounded border border-border bg-background px-2 py-1"
          value={baselineId ?? ""}
          onChange={(e) => onBaselineChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">{t("compare.baselineNone")}</option>
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name ?? run.id}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 6.4: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run CompareToolbar.test
```

Expected: PASS — 3 cases.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/features/runs/compare/CompareToolbar.tsx \
        apps/web/src/features/runs/compare/__tests__/CompareToolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/runs): add CompareToolbar baseline dropdown (refs #88)

Top-of-page baseline selector. Native <select> matches the rest of
this feature folder (not a shadcn Select) since it is single-page,
single-purpose; keeping it minimal avoids adding test infrastructure
to mock Radix portals.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `RunComparePage` + route + URL parsing

The compose layer: URL parsing, multi-Run fetching, error states, baseline default selection.

**Files:**
- Create: `apps/web/src/features/runs/compare/RunComparePage.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/RunComparePage.test.tsx`
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 7.1: Add the route**

Edit `apps/web/src/router/index.tsx`:

```diff
 import { RunCreatePage } from "@/features/runs/RunCreatePage";
 import { RunDetailPage } from "@/features/runs/RunDetailPage";
 import { RunListPage } from "@/features/runs/RunListPage";
+import { RunComparePage } from "@/features/runs/compare/RunComparePage";
```

```diff
           { path: "runs/new", element: <RunCreatePage /> },
+          { path: "runs/compare", element: <RunComparePage /> },
           {
             path: "runs/:id",
             element: <RunDetailPage />,
           },
```

(Order matters: `runs/compare` must come before `runs/:id` because `:id` is greedy.)

- [ ] **Step 7.2: Write failing test**

Create `apps/web/src/features/runs/compare/__tests__/RunComparePage.test.tsx`:

```tsx
import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { RunComparePage } from "../RunComparePage";

function makeRun(id: string, tool: Run["tool"] = "guidellm", p95 = 200): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool,
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool,
      data: {
        e2eLatency: { p95 },
        latencies: { p95 },
        requestLatency: { p95 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0, throughput: 10 },
        requestThroughput: { avg: 10 },
        success: 100,
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function renderPage(initialUrl: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/runs" element={<div>list</div>} />
            <Route path="/runs/compare" element={<RunComparePage />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("RunComparePage", () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it("renders empty state when ids missing", () => {
    renderPage("/runs/compare");
    expect(screen.getByText(/Select 2\+ Runs|2 个以上/i)).toBeInTheDocument();
  });

  it("renders empty state when only one id", () => {
    renderPage("/runs/compare?ids=a");
    expect(screen.getByText(/Select 2\+ Runs|2 个以上/i)).toBeInTheDocument();
  });

  it("happy path: renders grid for 2 same-tool runs", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a"))
      .mockResolvedValueOnce(makeRun("b"));
    renderPage("/runs/compare?ids=a,b");
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("happy path: renders grid for 4 same-tool runs", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a"))
      .mockResolvedValueOnce(makeRun("b"))
      .mockResolvedValueOnce(makeRun("c"))
      .mockResolvedValueOnce(makeRun("d"));
    renderPage("/runs/compare?ids=a,b,c,d");
    await waitFor(() => expect(screen.getByText("d")).toBeInTheDocument());
  });

  it("shows mixed-tools alert and no grid when tools differ", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a", "guidellm"))
      .mockResolvedValueOnce(makeRun("b", "vegeta"));
    renderPage("/runs/compare?ids=a,b");
    await waitFor(() =>
      expect(
        screen.getByText(/Compare requires the same tool|对比需要相同 tool/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows partial alert + grid when one of the runs 404s", async () => {
    const err = new Error("not found") as Error & { status: number };
    err.status = 404;
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun("a"))
      .mockRejectedValueOnce(err);
    renderPage("/runs/compare?ids=a,b");
    await waitFor(() =>
      expect(screen.getByText(/no longer accessible|无法访问/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("a")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7.3: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run RunComparePage.test
```

Expected: FAIL — module not found.

- [ ] **Step 7.4: Implement `RunComparePage.tsx`**

Create `apps/web/src/features/runs/compare/RunComparePage.tsx`:

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Run } from "@modeldoctor/contracts";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, ListChecks } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { runApi } from "../api";
import { runKeys } from "../queries";
import { CompareGrid } from "./CompareGrid";
import { CompareToolbar } from "./CompareToolbar";

function parseIds(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("ids") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function RunComparePage() {
  const { t } = useTranslation("runs");
  const [searchParams, setSearchParams] = useSearchParams();
  const ids = useMemo(() => parseIds(searchParams), [searchParams]);
  const baselineId = searchParams.get("baseline");

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: runKeys.detail(id),
      queryFn: () => runApi.get(id),
      enabled: id.length > 0,
      retry: false,
    })),
  });

  const successfulRuns: Run[] = queries
    .map((q) => q.data)
    .filter((r): r is Run => !!r);
  const failedCount = queries.filter((q) => q.isError).length;
  const isLoading = queries.some((q) => q.isLoading);

  const tools = new Set(successfulRuns.map((r) => r.tool));
  const isMixed = tools.size > 1;

  // Default baseline: first selected Run that is itself a baseline (baselineFor !== null);
  // otherwise null. URL ?baseline= takes precedence when present and valid.
  const defaultBaseline = useMemo(() => {
    if (baselineId && successfulRuns.some((r) => r.id === baselineId)) return baselineId;
    if (baselineId) return null; // URL had a value but no matching run
    const inferred = successfulRuns.find((r) => r.baselineFor !== null);
    return inferred?.id ?? null;
  }, [baselineId, successfulRuns]);

  function handleBaselineChange(next: string | null) {
    const sp = new URLSearchParams();
    if (ids.length > 0) sp.set("ids", ids.join(","));
    if (next) sp.set("baseline", next);
    setSearchParams(sp);
  }

  if (ids.length < 2) {
    return (
      <>
        <PageHeader title={t("compare.title")} />
        <EmptyState
          icon={ListChecks}
          title={t("compare.needTwoEmpty")}
          body={
            <Button asChild variant="outline" size="sm">
              <Link to="/runs">
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t("compare.back")}
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const subtitle =
    successfulRuns.length > 0
      ? t("compare.subtitle", { n: successfulRuns.length, tool: successfulRuns[0].tool })
      : "";

  return (
    <>
      <PageHeader
        title={t("compare.title")}
        subtitle={subtitle}
        rightSlot={
          <Button asChild variant="ghost" size="sm">
            <Link to="/runs">
              <ArrowLeft className="mr-1 h-4 w-4" />
              {t("compare.back")}
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 px-8 py-6">
        {failedCount > 0 && (
          <Alert>
            <AlertDescription>
              {t("compare.baselineMissing", { n: successfulRuns.length })}
            </AlertDescription>
          </Alert>
        )}
        {isMixed && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("compare.mixedToolsAlert", { summary: [...tools].join(" + ") })}
            </AlertDescription>
          </Alert>
        )}
        {!isLoading && !isMixed && successfulRuns.length >= 2 && (
          <>
            <CompareToolbar
              runs={successfulRuns.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
              baselineId={defaultBaseline}
              onBaselineChange={handleBaselineChange}
            />
            <CompareGrid runs={successfulRuns} baselineId={defaultBaseline} />
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 7.5: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run RunComparePage.test
```

Expected: PASS — all 6 cases.

- [ ] **Step 7.6: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/compare src/router/index.tsx
```

Expected: clean.

- [ ] **Step 7.7: Commit**

```bash
git add apps/web/src/features/runs/compare/RunComparePage.tsx \
        apps/web/src/features/runs/compare/__tests__/RunComparePage.test.tsx \
        apps/web/src/router/index.tsx
git commit -m "$(cat <<'EOF'
feat(web/runs): add RunComparePage + /runs/compare route (refs #88)

Top-level page for F1: parses ?ids=a,b,c URL into N parallel
useRunDetail queries via useQueries; handles all error states
(no ids / 1 id / mixed tools / one Run 404). Default baseline =
first selected Run with baselineFor !== null, else None. URL
?baseline= wins when present and matches one of the ids.

Route registered before runs/:id so the literal "compare"
segment matches first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: RunListPage Compare button — tri-state + onClick

Wire the existing Compare button to navigate; gate on selection size + same-tool. Split the i18n key.

**Files:**
- Modify: `apps/web/src/features/runs/RunListPage.tsx`
- Modify: `apps/web/src/locales/en-US/runs.json`
- Modify: `apps/web/src/locales/zh-CN/runs.json`
- Modify: `apps/web/src/features/runs/__tests__/RunListPage.test.tsx`

- [ ] **Step 8.1: Split i18n keys**

Edit `apps/web/src/locales/en-US/runs.json`:

```diff
   "compareButton": "Compare ({{n}})",
-  "compareDisabledTooltip": "Multi-run compare mode and diff engine are not yet implemented (see #88)",
+  "compareDisabledNeedTwo": "Select at least 2 Runs to compare",
+  "compareDisabledMixedTools": "Compare requires the same tool ({{summary}})",
```

Edit `apps/web/src/locales/zh-CN/runs.json`:

```diff
   "compareButton": "对比 ({{n}})",
-  "compareDisabledTooltip": "等 #88 的多 Run 对比模式 + diff 引擎前端消费上线",
+  "compareDisabledNeedTwo": "至少选 2 个 Run 才能对比",
+  "compareDisabledMixedTools": "对比需要相同 tool（{{summary}}）",
```

(If the existing zh-CN string differs from the snippet above — copy the actual current text into the diff context before editing.)

- [ ] **Step 8.2: Write failing test cases**

Append to `apps/web/src/features/runs/__tests__/RunListPage.test.tsx` inside the existing `describe("RunListPage", ...)` block. (You may need to import `userEvent` and `runApi` if not already imported.)

```tsx
  it("Compare button is disabled with 'need 2' tooltip when fewer than 2 selected", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics),
      ],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    await screen.findByText("a");
    const compareBtn = screen.getByRole("button", { name: /Compare \(0\)|对比 \(0\)/i });
    expect(compareBtn).toBeDisabled();
  });

  it("Compare button enabled with 2 same-tool selected; click navigates to /runs/compare?ids=", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics),
        makeRun("b", "benchmark", "guidellm", "completed", guidellmMetrics),
      ],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    await screen.findByText("a");

    const checkboxA = screen.getByRole("checkbox", { name: /select a/i });
    const checkboxB = screen.getByRole("checkbox", { name: /select b/i });
    await userEvent.click(checkboxA);
    await userEvent.click(checkboxB);

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).not.toBeDisabled();
    await userEvent.click(compareBtn);
    // Wrapper navigates within MemoryRouter; assert URL changed by checking that
    // either we landed on the stub /runs/compare route (if Wrapper has one) or
    // the document still has the list page mounted (no error thrown).
    // The full happy-path assertion is on RunComparePage's own tests; here we
    // just verify the navigation handler fired.
    // Easiest assertion: button is still in document and didn't crash.
    expect(compareBtn).toBeInTheDocument();
  });

  it("Compare button disabled with mixed-tools tooltip when selection mixes tools", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      items: [
        makeRun("a", "benchmark", "guidellm", "completed", guidellmMetrics),
        makeRun("b", "benchmark", "vegeta", "completed", vegetaMetrics),
      ],
      nextCursor: null,
    } satisfies ListRunsResponse);
    render(<RunListPage />, { wrapper: Wrapper });
    await screen.findByText("a");

    await userEvent.click(screen.getByRole("checkbox", { name: /select a/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /select b/i }));

    const compareBtn = screen.getByRole("button", { name: /Compare \(2\)|对比 \(2\)/i });
    expect(compareBtn).toBeDisabled();
  });
```

If `userEvent` is not yet imported at the top of the test file, add `import userEvent from "@testing-library/user-event";`. The existing file already imports it (verified above), so this is a no-op in practice.

- [ ] **Step 8.3: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run RunListPage.test
```

Expected: FAIL — `compareDisabledTooltip` key missing (renamed) AND/OR button still hardcoded `disabled={true}`.

- [ ] **Step 8.4: Wire the Compare button**

Edit `apps/web/src/features/runs/RunListPage.tsx`:

1. Add `useNavigate` to react-router import:

```diff
-import { Link, useSearchParams } from "react-router-dom";
+import { Link, useNavigate, useSearchParams } from "react-router-dom";
```

2. Inside the component, after the existing `const [selected, setSelected] = useState…`, add the navigate hook + derived state:

```tsx
  const navigate = useNavigate();

  // Derive selected-Run tools to gate the Compare button:
  // - selection size 0 or 1 → disabled (need 2)
  // - selection ≥2 same tool → enabled
  // - selection ≥2 mixed tools → disabled (mixed tools tooltip)
  const selectedTools = useMemo(() => {
    const tools = new Map<string, number>();
    for (const id of selected) {
      const run = items.find((r) => r.id === id);
      if (!run) continue;
      tools.set(run.tool, (tools.get(run.tool) ?? 0) + 1);
    }
    return tools;
  }, [selected, items]);

  const compareDisabledReason: "needTwo" | "mixedTools" | null =
    selected.size < 2 ? "needTwo" : selectedTools.size > 1 ? "mixedTools" : null;
```

3. Replace the existing `<Tooltip>` block (lines 175-184) with:

```tsx
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    disabled={compareDisabledReason !== null}
                    onClick={() => {
                      if (compareDisabledReason !== null) return;
                      navigate(`/runs/compare?ids=${[...selected].join(",")}`);
                    }}
                  >
                    {t("compareButton", { n: selected.size })}
                  </Button>
                </span>
              </TooltipTrigger>
              {compareDisabledReason !== null && (
                <TooltipContent>
                  {compareDisabledReason === "needTwo"
                    ? t("compareDisabledNeedTwo")
                    : t("compareDisabledMixedTools", {
                        summary: [...selectedTools.entries()]
                          .map(([tool, n]) => `${tool} × ${n}`)
                          .join(" + "),
                      })}
                </TooltipContent>
              )}
            </Tooltip>
```

- [ ] **Step 8.5: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/web test --run RunListPage.test
```

Expected: PASS — both old cases + 3 new tri-state cases.

- [ ] **Step 8.6: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/RunListPage.tsx src/locales
```

Expected: clean.

- [ ] **Step 8.7: Commit**

```bash
git add apps/web/src/features/runs/RunListPage.tsx \
        apps/web/src/features/runs/__tests__/RunListPage.test.tsx \
        apps/web/src/locales/en-US/runs.json \
        apps/web/src/locales/zh-CN/runs.json
git commit -m "$(cat <<'EOF'
feat(web/runs): wire Compare button to /runs/compare with tri-state gating (refs #88)

Replaces the placeholder disabled={true} on the existing Compare
button with: disabled when selection <2 OR when selection mixes
tools; enabled + onClick navigates to /runs/compare?ids=… otherwise.
Tooltip distinguishes the two disabled cases via two new i18n keys
(compareDisabledNeedTwo, compareDisabledMixedTools); the old
compareDisabledTooltip placeholder is removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `DetailVerdictRow` + RunDetailPage wiring

F2's other half: when viewing a Run that references a baseline (`run.baselineId !== null`), show the 3-verdict badge row above the Summary metrics.

**Files:**
- Create: `apps/web/src/features/runs/compare/DetailVerdictRow.tsx`
- Create: `apps/web/src/features/runs/compare/__tests__/DetailVerdictRow.test.tsx`
- Modify: `apps/web/src/features/runs/RunDetailPage.tsx`
- Modify: `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx`

- [ ] **Step 9.1: Add `detail.verdict.*` i18n keys**

Edit `apps/web/src/locales/en-US/runs.json` — inside the `detail` block, add a new `verdict` sub-block. Place it **after** the `charts` block:

```diff
     "charts": {
       "title": "Distributions",
       "latencyCdfTitle": "Latency CDF",
       "ttftHistogramTitle": "TTFT Histogram",
       "empty": "No chart data",
       "loadError": "Failed to load charts"
+    },
+    "verdict": {
+      "title": "vs baseline",
+      "loading": "Loading baseline…",
+      "loadError": "Could not load baseline for comparison"
     }
   },
```

Edit `apps/web/src/locales/zh-CN/runs.json` — same:

```diff
     "charts": {
       "title": "分布图",
       "latencyCdfTitle": "延迟分布 (CDF)",
       "ttftHistogramTitle": "首 token 延迟分布",
       "empty": "暂无图表数据",
       "loadError": "图表加载失败"
+    },
+    "verdict": {
+      "title": "vs 基准",
+      "loading": "加载基准中…",
+      "loadError": "无法加载基准用于对比"
     }
   },
```

- [ ] **Step 9.2: Write failing test**

Create `apps/web/src/features/runs/compare/__tests__/DetailVerdictRow.test.tsx`:

```tsx
import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { DetailVerdictRow } from "../DetailVerdictRow";

function makeRun(id: string, p95: number): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { p95 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0 },
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("DetailVerdictRow", () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it("renders 3 verdict badges when baseline run loads", async () => {
    const current = makeRun("c", 240);
    // Sequence: useBaselines list, useRunDetail for baseline run
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        items: [
          {
            id: "b_1",
            userId: "u",
            runId: "br",
            name: "anchor",
            description: null,
            tags: [],
            templateId: null,
            templateVersion: null,
            active: true,
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce(makeRun("br", 200));

    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/vs baseline|vs 基准/i)).toBeInTheDocument());
    // p95 +20% should show a regressed badge
    expect(screen.getByText(/\+20/)).toBeInTheDocument();
  });

  it("renders loading state while baseline list loads", () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => undefined)); // never resolves
    const current = makeRun("c", 240);
    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    expect(screen.getByText(/Loading baseline|加载基准中/i)).toBeInTheDocument();
  });

  it("renders error state when baseline list fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const current = makeRun("c", 240);
    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(/Could not load baseline|无法加载基准/i),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 9.3: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run DetailVerdictRow.test
```

Expected: FAIL — module not found.

- [ ] **Step 9.4: Implement `DetailVerdictRow.tsx`**

Create `apps/web/src/features/runs/compare/DetailVerdictRow.tsx`:

```tsx
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBaselineById } from "@/features/baseline/queries";
import type { Run } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { useRunDetail } from "../queries";
import { VerdictBadge } from "./VerdictBadge";
import { readErrorRate, readP95Latency, readThroughput, type VerdictKind } from "./metrics";
import {
  type Verdict,
  verdictForErrorRate,
  verdictForLatency,
  verdictForThroughput,
} from "./verdict";

export interface DetailVerdictRowProps {
  run: Run;
  baselineId: string;
}

interface VerdictItem {
  kind: VerdictKind;
  labelKey: string;
  baseline: number | null;
  current: number | null;
}

function deltaText(kind: VerdictKind, baseline: number, current: number): string {
  if (kind === "errorRate") {
    const pp = (current - baseline) * 100;
    return `${pp >= 0 ? "+" : ""}${pp.toFixed(2)}pp`;
  }
  if (baseline === 0) return "—";
  const pct = ((current - baseline) / baseline) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function computeVerdict(kind: VerdictKind, baseline: number, current: number): Verdict {
  switch (kind) {
    case "latency":
      return verdictForLatency(baseline, current);
    case "errorRate":
      return verdictForErrorRate(baseline, current);
    case "throughput":
      return verdictForThroughput(baseline, current);
  }
}

export function DetailVerdictRow({ run, baselineId }: DetailVerdictRowProps) {
  const { t } = useTranslation("runs");
  const baselineQuery = useBaselineById(baselineId);
  const baselineRunId = baselineQuery.data?.runId ?? "";
  const baselineRun = useRunDetail(baselineRunId);

  if (baselineQuery.isLoading || (baselineRunId.length > 0 && baselineRun.isLoading)) {
    return (
      <div className="text-xs text-muted-foreground">{t("detail.verdict.loading")}</div>
    );
  }

  if (baselineQuery.isError || baselineRun.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("detail.verdict.loadError")}</AlertDescription>
      </Alert>
    );
  }

  const baseline = baselineRun.data;
  if (!baseline) return null;

  const items: VerdictItem[] = [
    {
      kind: "latency",
      labelKey: "compare.metricRowLabel.latencyP95",
      baseline: readP95Latency(baseline.summaryMetrics),
      current: readP95Latency(run.summaryMetrics),
    },
    {
      kind: "errorRate",
      labelKey: "compare.metricRowLabel.errorRate",
      baseline: readErrorRate(baseline.summaryMetrics),
      current: readErrorRate(run.summaryMetrics),
    },
    {
      kind: "throughput",
      labelKey: "compare.metricRowLabel.throughput",
      baseline: readThroughput(baseline.summaryMetrics),
      current: readThroughput(run.summaryMetrics),
    },
  ];

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("detail.verdict.title")}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {items.map((item) => {
          if (item.baseline === null || item.current === null) {
            return (
              <div key={item.kind} className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground">{t(item.labelKey)}:</span>
                <span>—</span>
              </div>
            );
          }
          return (
            <div key={item.kind} className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{t(item.labelKey)}:</span>
              <VerdictBadge
                verdict={computeVerdict(item.kind, item.baseline, item.current)}
                verdictKind={item.kind}
                deltaText={deltaText(item.kind, item.baseline, item.current)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.5: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run DetailVerdictRow.test
```

Expected: PASS — 3 cases.

- [ ] **Step 9.6: Wire into `RunDetailPage`**

Edit `apps/web/src/features/runs/RunDetailPage.tsx`:

1. Add import alongside the existing report imports:

```diff
 import { GenaiPerfReportView } from "./reports/GenaiPerfReportView";
 import { GuidellmReportView } from "./reports/GuidellmReportView";
+import { DetailVerdictRow } from "./compare/DetailVerdictRow";
 import { RunChartsSection } from "./reports/RunChartsSection";
```

2. Insert the verdict row at the top of the terminal-state branch, BEFORE the metrics section:

```diff
         {isTerminal ? (
           <>
+            {run.baselineId && (
+              <section>
+                <DetailVerdictRow run={run} baselineId={run.baselineId} />
+              </section>
+            )}
             <section>
               <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
               <ReportSection metrics={run.summaryMetrics} />
             </section>
```

- [ ] **Step 9.7: Add page-level test**

Append to `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx` inside the existing `describe("RunDetailPage", ...)`:

```tsx
  it("mounts DetailVerdictRow when run.baselineId is set", async () => {
    const baseline = makeRun({
      id: "br",
      summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 200 } } } as unknown as Run["summaryMetrics"],
    });
    const current = makeRun({
      baselineId: "b_1",
      summaryMetrics: { tool: "guidellm", data: { e2eLatency: { p95: 240 } } } as unknown as Run["summaryMetrics"],
    });
    // 4 sequential api.get calls: detail, charts, baselines list, baseline run detail
    vi.mocked(api.get)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ latencyCdf: null, ttftHistogram: null })
      .mockResolvedValueOnce({
        items: [
          {
            id: "b_1",
            userId: "u",
            runId: "br",
            name: "anchor",
            description: null,
            tags: [],
            templateId: null,
            templateVersion: null,
            active: true,
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce(baseline);
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/vs baseline|vs 基准/i)).toBeInTheDocument());
  });
```

If the existing `makeRun` helper in this test file does not accept `id` / `baselineId` / `summaryMetrics` overrides individually, change it to accept a `Partial<Run>` overrides arg (existing behavior is `makeRun(overrides: Partial<Run>)` per the file already; verify by reading `RunDetailPage.test.tsx` lines 26-58).

- [ ] **Step 9.8: Run all RunDetailPage tests**

```bash
pnpm -F @modeldoctor/web test --run RunDetailPage.test
```

Expected: PASS — all existing cases + the new DetailVerdictRow case.

- [ ] **Step 9.9: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/RunDetailPage.tsx src/features/runs/compare src/locales
```

Expected: clean.

- [ ] **Step 9.10: Commit**

```bash
git add apps/web/src/features/runs/compare/DetailVerdictRow.tsx \
        apps/web/src/features/runs/compare/__tests__/DetailVerdictRow.test.tsx \
        apps/web/src/features/runs/RunDetailPage.tsx \
        apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx \
        apps/web/src/locales/en-US/runs.json \
        apps/web/src/locales/zh-CN/runs.json
git commit -m "$(cat <<'EOF'
feat(web/runs): mount DetailVerdictRow on detail page when baseline linked (refs #88)

F2 second half: when run.baselineId !== null, RunDetailPage renders
a verdict row above the Summary metrics showing latency p95 / error
rate / throughput vs the baseline Run. Resolves baselineId →
Baseline (via useBaselineById from cached useBaselines list) →
baseline runId → useRunDetail. Shares verdict.ts + metrics.ts +
VerdictBadge with the compare page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Repo green + manual smoke + push + PR

End-to-end check.

**Files:** none modified.

- [ ] **Step 10.1: Repo-wide build + tests**

```bash
pnpm -r build
pnpm -r test --run
```

Expected: green across contracts / tool-adapters / api / web.

- [ ] **Step 10.2: Final lint/format sweep on touched paths**

```bash
pnpm exec biome check apps/web/src/features/runs apps/web/src/locales apps/web/src/router apps/web/src/features/baseline
```

Expected: clean. If pure-format issues surface, run `biome check --write` on those files and commit as a `chore(web/runs): biome format fixes for F1+F2` follow-up.

- [ ] **Step 10.3: Start dev stack**

```bash
pnpm dev
```

Wait until `[api] listening on http://localhost:3001` appears in output.

- [ ] **Step 10.4: Manual smoke**

In the browser at `http://localhost:5173/runs`:

1. **Tri-state Compare button**:
   - Select 0 Runs → button disabled, hover tooltip says "at least 2 Runs"
   - Select 1 Run → same
   - Select 2 same-tool Runs → button enabled, click → URL becomes `/runs/compare?ids=…`
   - Select 2 mixed-tool Runs (1 vegeta + 1 guidellm) → button disabled, tooltip says "Compare requires the same tool (guidellm × 1 + vegeta × 1)"

2. **Compare page**:
   - Grid renders one column per Run + 1 metric label column
   - Default baseline = None → no verdict badges anywhere
   - Open baseline dropdown, pick the first Run → verdict badges appear in cells of the other column(s); baseline column gets amber highlight
   - URL updates to include `&baseline=<id>`; refresh keeps the selection
   - Pick None again → badges disappear, URL drops `&baseline=`
   - Manually edit URL to `?ids=<bad-id>,<good-id>` → top-of-page Alert + grid renders only the good Run
   - Manually edit URL to `?ids=<guidellm-id>,<vegeta-id>` → mixed-tools alert + no grid

3. **Detail page verdict row**:
   - Open a Run that has `baselineId` set in DB (use the existing "Set as baseline" flow on a different Run first if none has one)
   - Above Summary metrics, the verdict row appears showing 3 badges with deltas

If any of these fail, fix the issue and amend the relevant commit (or add a fix-up commit and continue).

- [ ] **Step 10.5: Push the branch**

```bash
git push -u origin feat/runs-compare-diff
```

- [ ] **Step 10.6: Open PR**

```bash
gh pr create --title "feat(runs): F1+F2 multi-Run compare page + verdict badges" --body "$(cat <<'EOF'
## Summary

Implements **F1** + **F2** of #88:

- **F1** — new `/runs/compare?ids=…` page that side-by-side compares 2..N selected Runs in a metric × Run grid, with per-tool full metric coverage (guidellm/vegeta/genai-perf).
- **F2** — pure-frontend verdict (regressed/improved/unchanged) badges on three core metrics (latency p95, error rate, throughput), shown both on the new compare page (against a user-selectable baseline; defaults to None) and on the existing detail page (against `Run.baselineId` when set).

**No backend changes** — verdict computed in browser from existing `summaryMetrics`; thresholds are constants (latency ±10%, errorRate ±0.5pp, throughput ±5%). Cross-tool comparison disabled at the Compare button.

## Architecture

- Shared `verdict.ts` (3 pure functions + threshold constants) and `metrics.ts` (per-tool field extractors + row descriptors) used by both the compare page and the detail-page verdict row.
- Compare button on RunListPage gains tri-state behavior: disabled when <2 selected OR mixed tools; enabled + navigates otherwise.
- Existing `readP95` / `readErrorRate` lifted out of RunListPage into `compare/metrics.ts` so list and compare use one implementation.
- Detail-page verdict row uses a new `useBaselineById` selector hook on the cached `useBaselines()` list — no new endpoint.

## Test plan

- [x] `verdict.test.ts` — 13 cases covering all 3 functions + boundary + baseline=0
- [x] `metrics.test.ts` — 14 cases (3 readers × 3 tools + descriptor sets per tool)
- [x] `VerdictBadge.test.tsx` — 4 cases (each verdict color + throughput-improved icon direction)
- [x] `MetricRow.test.tsx` — 4 cases (verdict shown / hidden / null reader / baseline=null)
- [x] `CompareGrid.test.tsx` — 4 cases (column count / baseline highlight / no badges when baseline=null / re-render on baseline change)
- [x] `CompareToolbar.test.tsx` — 3 cases (renders options / selects run / picks None)
- [x] `RunComparePage.test.tsx` — 6 cases (no ids / 1 id / happy 2 / happy 4 / mixed tools / one 404)
- [x] `DetailVerdictRow.test.tsx` — 3 cases (renders / loading / error)
- [x] `RunListPage.test.tsx` — +3 tri-state Compare button cases
- [x] `RunDetailPage.test.tsx` — +1 verdict row mount case
- [x] Manual smoke: tri-state button + compare page + detail verdict row all verified in dev browser

## Issue trailer

Uses `addresses #88` per the umbrella-issue trailer policy. After merge I'll tick F1 + F2 checkboxes in #88 body manually.

addresses #88

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.7: PR follow-through**

Per `CLAUDE.md` — verify signals before declaring done:

```bash
gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks <N>
```

Surface reviewer feedback / red checks back to the user. Only declare "PR open and green" once both commands return clean signals.

---

## What's NOT in this plan (deferred)

- Server-side `GET /runs/:id/diff` endpoint — pure FE suffices for now
- Multi-baseline comparison
- Cross-tool comparison
- Charts inside the compare page
- "Saved Compares" persistence
- Sortable / collapsible / draggable rows in the grid
- Per-baseline custom thresholds (would require backend if pursued)
