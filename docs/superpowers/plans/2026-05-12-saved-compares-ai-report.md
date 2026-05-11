# Saved Compares + AI Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Compare page with a persistent, AI-narrated, exportable report. Users pick N benchmark runs, save the selection as a named SavedCompare, click "Generate AI Analysis" to get TL;DR + analysis + recommendations, then "Export HTML" for a self-contained shareable file.

**Architecture:** New Postgres table `saved_compares` (owner-scoped). New NestJS module `saved-compares` that imports `LlmJudgeModule` and reuses the LRU cache + chatCompletion helpers from `insights/`. Frontend adds a Save dialog + AI panel onto the existing `BenchmarkComparePage`, and a new pair of pages at `/benchmarks/compare/saved` (list) and `/benchmarks/compare/saved/:id` (detail/report). One new chart component `StageBarChart` (categorical-X grouped bars). HTML export is client-side DOM serialization.

**Tech Stack:** NestJS 11 + Prisma + Postgres, Vitest 2, React 18 + React Router + react-query + Recharts + shadcn/ui + Tailwind, react-i18next (zh-CN + en-US). ESM with explicit `.js` suffixes on imports.

**Spec:** `docs/superpowers/specs/2026-05-12-saved-compares-ai-report-design.md`

---

## File Structure

**Backend (NestJS) — `apps/api/`:**
- `prisma/schema.prisma` — add `SavedCompare` model
- `prisma/migrations/<ts>_add_saved_compares/migration.sql` — generated
- `src/modules/saved-compares/saved-compares.module.ts` — module wiring
- `src/modules/saved-compares/saved-compares.service.ts` — CRUD + benchmark hydration
- `src/modules/saved-compares/saved-compares.service.spec.ts`
- `src/modules/saved-compares/saved-compares.controller.ts` — REST endpoints
- `src/modules/saved-compares/compare-synthesize.service.ts` — AI synth
- `src/modules/saved-compares/compare-synthesize.service.spec.ts`
- `src/modules/saved-compares/prompts.ts` — zh-CN + en-US system prompts
- `src/modules/saved-compares/metrics.ts` — server-side metric readers (port of frontend `compare/metrics.ts`)
- `src/modules/saved-compares/metrics.spec.ts`
- `src/app.module.ts` — register `SavedComparesModule`
- `test/e2e/saved-compares.e2e-spec.ts` — HTTP e2e

**Contracts — `packages/contracts/src/`:**
- `saved-compares/saved-compares.ts` — CRUD zod schemas + types
- `saved-compares/compare-narrative.ts` — synth request/response schemas
- `saved-compares/index.ts` — local re-exports
- `index.ts` — add `export * from "./saved-compares/index.js"`

**Frontend (React) — `apps/web/src/`:**
- `components/charts/StageBarChart.tsx` — new grouped-bar chart
- `components/charts/StageBarChart.test.tsx`
- `components/charts/index.ts` — add export
- `features/benchmarks/compare/queries.ts` — new file (does not exist today; current compare imports from `../queries.ts`)
- `features/benchmarks/compare/SaveCompareDialog.tsx`
- `features/benchmarks/compare/SaveCompareDialog.test.tsx`
- `features/benchmarks/compare/AiAnalysisPanel.tsx`
- `features/benchmarks/compare/AiAnalysisPanel.test.tsx`
- `features/benchmarks/compare/StageBarChartsSection.tsx` — the 4-chart block
- `features/benchmarks/compare/StageBarChartsSection.test.tsx`
- `features/benchmarks/compare/ReportSections.tsx` — 7-section layout shared by Compare + SavedCompareDetail
- `features/benchmarks/compare/SavedCompareDetailPage.tsx`
- `features/benchmarks/compare/SavedCompareDetailPage.test.tsx`
- `features/benchmarks/compare/SavedComparesListPage.tsx`
- `features/benchmarks/compare/SavedComparesListPage.test.tsx`
- `features/benchmarks/compare/exportHtml.ts`
- `features/benchmarks/compare/exportHtml.test.ts`
- `features/benchmarks/compare/BenchmarkComparePage.tsx` — add Save button + AiAnalysisPanel + ReportSections
- `router/index.tsx` — add 2 routes
- `locales/zh-CN/benchmarks.json` — add `savedCompare.*` keys
- `locales/en-US/benchmarks.json` — add `savedCompare.*` keys

**Browser e2e — `e2e/`:**
- `saved-compares.spec.ts` — Playwright

---

## Task 1: Add `SavedCompare` Prisma model + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append model)
- Create: `apps/api/prisma/migrations/<auto-timestamp>_add_saved_compares/migration.sql`

- [ ] **Step 1: Append SavedCompare model to schema.prisma**

Append after the `NotificationDelivery` model:

```prisma
model SavedCompare {
  id           String    @id @default(cuid())
  userId       String    @map("user_id")
  name         String
  benchmarkIds String[]  @map("benchmark_ids")
  stageLabels  Json      @map("stage_labels")
  baselineId   String?   @map("baseline_id")
  context      String?   @db.Text
  narrative    Json?
  narrativeAt  DateTime? @map("narrative_at") @db.Timestamptz(3)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("saved_compares")
}
```

Also add the back-relation onto the `User` model (find `model User { ... }` near the top and add a `savedCompares SavedCompare[]` line in the relations block).

- [ ] **Step 2: Generate migration**

Run: `pnpm -F @modeldoctor/api db:migrate:dev --name add_saved_compares -- --create-only`

Expected: a new directory `apps/api/prisma/migrations/<timestamp>_add_saved_compares/migration.sql` is written. Verify by `ls apps/api/prisma/migrations/ | tail -1`.

If a `--create-only` flag is not recognized, fall back to:
`DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor pnpm -F @modeldoctor/api exec prisma migrate dev --name add_saved_compares --create-only`

(per CLAUDE.md / memory: never hand-write SQL; always Prisma-generated)

- [ ] **Step 3: Apply migration + regenerate client**

Run: `DATABASE_URL=postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor pnpm -F @modeldoctor/api exec prisma migrate deploy`
Run: `pnpm -F @modeldoctor/api exec prisma generate`

Expected: no errors. `SavedCompare` is now a TypeScript-usable model.

- [ ] **Step 4: Verify**

Run: `psql -U modeldoctor -d modeldoctor -c "\d saved_compares"`
Expected: columns present, indexes `saved_compares_user_id_created_at_idx` present.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(api): add SavedCompare Prisma model

Single owner-scoped table referencing benchmark IDs by array; stage labels
and AI narrative carried as JSON columns to avoid extra tables in V1.

Refs: docs/superpowers/specs/2026-05-12-saved-compares-ai-report-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Contracts — SavedCompare CRUD schemas

**Files:**
- Create: `packages/contracts/src/saved-compares/saved-compares.ts`
- Create: `packages/contracts/src/saved-compares/index.ts`
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the schemas**

Create `packages/contracts/src/saved-compares/saved-compares.ts`:

```ts
import { z } from "zod";

export const stageLabelsSchema = z.record(z.string(), z.string().min(1).max(64));
export type StageLabels = z.infer<typeof stageLabelsSchema>;

export const savedCompareSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(200),
  benchmarkIds: z.array(z.string()).min(2).max(10),
  stageLabels: stageLabelsSchema,
  baselineId: z.string().nullable(),
  context: z.string().nullable(),
  narrative: z.unknown().nullable(),       // shape lives in compare-narrative.ts; kept loose here
  narrativeAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SavedCompare = z.infer<typeof savedCompareSchema>;

export const createSavedCompareRequestSchema = z.object({
  name: z.string().min(1).max(200),
  benchmarkIds: z.array(z.string()).min(2).max(10),
  stageLabels: stageLabelsSchema,
  baselineId: z.string().nullable().optional(),
  context: z.string().max(10_000).nullable().optional(),
});
export type CreateSavedCompareRequest = z.infer<typeof createSavedCompareRequestSchema>;

export const updateSavedCompareRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  stageLabels: stageLabelsSchema.optional(),
  baselineId: z.string().nullable().optional(),
  context: z.string().max(10_000).nullable().optional(),
});
export type UpdateSavedCompareRequest = z.infer<typeof updateSavedCompareRequestSchema>;

export const listSavedComparesResponseSchema = z.object({
  items: z.array(savedCompareSchema),
});
export type ListSavedComparesResponse = z.infer<typeof listSavedComparesResponseSchema>;
```

- [ ] **Step 2: Add local re-export**

Create `packages/contracts/src/saved-compares/index.ts`:

```ts
export * from "./saved-compares.js";
```

- [ ] **Step 3: Wire into top-level index**

In `packages/contracts/src/index.ts`, add after the existing exports (find where `insights` is exported and add a sibling):

```ts
export * from "./saved-compares/index.js";
```

- [ ] **Step 4: Build contracts**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: PASS, `packages/contracts/dist/saved-compares/` written.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/saved-compares/ packages/contracts/src/index.ts
git commit -m "$(cat <<'EOF'
feat(contracts): SavedCompare CRUD schemas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Contracts — Compare narrative schemas

**Files:**
- Create: `packages/contracts/src/saved-compares/compare-narrative.ts`
- Modify: `packages/contracts/src/saved-compares/index.ts`

- [ ] **Step 1: Write the schemas**

Create `packages/contracts/src/saved-compares/compare-narrative.ts`:

```ts
import { z } from "zod";

export const compareNarrativeSchema = z.object({
  tldr: z
    .array(z.object({ headline: z.string().min(1), oneLine: z.string().min(1) }))
    .min(1)
    .max(8),
  analysis: z
    .array(z.object({ metricLabel: z.string().min(1), body: z.string().min(1) }))
    .min(0)
    .max(20),
  conclusion: z.object({
    recommendation: z.string().min(1),
    caveats: z.array(z.string()).min(0).max(10),
  }),
});
export type CompareNarrative = z.infer<typeof compareNarrativeSchema>;

export const compareSynthesizeRequestSchema = z.object({
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
});
export type CompareSynthesizeRequest = z.infer<typeof compareSynthesizeRequestSchema>;

export const compareSynthesizeResponseSchema = z.object({
  narrative: compareNarrativeSchema,
  generatedAt: z.string().datetime(),
  fromCache: z.boolean(),
});
export type CompareSynthesizeResponse = z.infer<typeof compareSynthesizeResponseSchema>;
```

- [ ] **Step 2: Re-export**

Update `packages/contracts/src/saved-compares/index.ts` to:

```ts
export * from "./saved-compares.js";
export * from "./compare-narrative.js";
```

- [ ] **Step 3: Build**

Run: `pnpm -F @modeldoctor/contracts build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/saved-compares/
git commit -m "$(cat <<'EOF'
feat(contracts): compare narrative + synth schemas

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Backend — server-side metric readers

**Files:**
- Create: `apps/api/src/modules/saved-compares/metrics.ts`
- Create: `apps/api/src/modules/saved-compares/metrics.spec.ts`

Port the readers from `apps/web/src/features/benchmarks/compare/metrics.ts` to the backend, so synthesize input building does not depend on the frontend.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/saved-compares/metrics.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readErrorRate, readP95Latency, readThroughput, summarizeForPrompt } from "./metrics.js";

describe("metrics readers", () => {
  it("reads guidellm p95 latency from e2eLatency dist", () => {
    const m = { tool: "guidellm", data: { e2eLatency: { p95: 1234 } } };
    expect(readP95Latency(m)).toBe(1234);
  });

  it("reads vegeta error rate as 1 - success/100", () => {
    const m = { tool: "vegeta", data: { success: 91.3 } };
    const r = readErrorRate(m);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.087, 4);
  });

  it("returns null when summary metrics missing", () => {
    expect(readP95Latency(null)).toBeNull();
    expect(readErrorRate({ tool: "guidellm" })).toBeNull();
    expect(readThroughput({ tool: "unknown", data: {} })).toBeNull();
  });

  it("summarizeForPrompt picks per-tool key fields", () => {
    const m = {
      tool: "guidellm",
      data: {
        ttft: { p50: 100, p90: 200, p99: 500 },
        e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
        requestsPerSecond: { mean: 3.75 },
        requests: { total: 1000, error: 0 },
      },
    };
    const out = summarizeForPrompt(m);
    expect(out).toMatchObject({
      throughput: 3.75,
      errorRate: 0,
      ttft: { p50: 100, p90: 200, p99: 500 },
      e2e: { p50: 800, p90: 1500, p99: 3000 },
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm -F @modeldoctor/api test -- metrics.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement metrics.ts**

Create `apps/api/src/modules/saved-compares/metrics.ts`:

```ts
type Tagged = { tool?: string; data?: Record<string, unknown> };

export function asTagged(m: unknown): Tagged | null {
  if (!m || typeof m !== "object") return null;
  const t = m as Tagged;
  return t.data ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  return asFiniteNumber(dist?.[field]);
}

export function readP95Latency(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm":
      return fromDist(t.data, "e2eLatency", "p95");
    case "vegeta":
      return fromDist(t.data, "latencies", "p95");
    case "genai-perf":
      return fromDist(t.data, "requestLatency", "p95");
    default:
      return null;
  }
}

export function readErrorRate(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm": {
      const r = t.data.requests as { total?: number; error?: number } | undefined;
      const total = asFiniteNumber(r?.total);
      const error = asFiniteNumber(r?.error);
      if (total === null || error === null || total === 0) return null;
      return error / total;
    }
    case "vegeta": {
      const s = asFiniteNumber(t.data.success);
      return s === null ? null : 1 - s / 100;
    }
    default:
      return null;
  }
}

export function readThroughput(m: unknown): number | null {
  const t = asTagged(m);
  if (!t?.data) return null;
  switch (t.tool) {
    case "guidellm":
      return asFiniteNumber((t.data.requestsPerSecond as { mean?: number } | undefined)?.mean);
    case "vegeta":
      return asFiniteNumber((t.data.requests as { throughput?: number } | undefined)?.throughput);
    case "genai-perf":
      return asFiniteNumber((t.data.requestThroughput as { avg?: number } | undefined)?.avg);
    default:
      return null;
  }
}

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const t = asTagged(m);
  const tool = t?.tool;
  const ttftKey =
    tool === "guidellm" ? "ttft" : tool === "genai-perf" ? "timeToFirstToken" : null;
  const e2eKey =
    tool === "guidellm"
      ? "e2eLatency"
      : tool === "vegeta"
      ? "latencies"
      : tool === "genai-perf"
      ? "requestLatency"
      : null;

  return {
    throughput: readThroughput(m),
    errorRate: readErrorRate(m),
    ttft:
      t?.data && ttftKey
        ? {
            p50: fromDist(t.data, ttftKey, "p50"),
            p90: fromDist(t.data, ttftKey, "p90"),
            p99: fromDist(t.data, ttftKey, "p99"),
          }
        : null,
    e2e:
      t?.data && e2eKey
        ? {
            p50: fromDist(t.data, e2eKey, "p50"),
            p90: fromDist(t.data, e2eKey, "p90"),
            p99: fromDist(t.data, e2eKey, "p99"),
          }
        : null,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm -F @modeldoctor/api test -- metrics.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/saved-compares/metrics.ts apps/api/src/modules/saved-compares/metrics.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/saved-compares): server-side metric readers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Backend — SavedComparesService (CRUD)

**Files:**
- Create: `apps/api/src/modules/saved-compares/saved-compares.service.ts`
- Create: `apps/api/src/modules/saved-compares/saved-compares.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/saved-compares/saved-compares.service.spec.ts`:

```ts
import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaService } from "../../database/prisma.service.js";
import { SavedComparesService } from "./saved-compares.service.js";

describe("SavedComparesService", () => {
  let mod: TestingModule;
  let svc: SavedComparesService;
  let prisma: PrismaService;
  let userId: string;
  let otherUserId: string;
  let runIds: string[];

  beforeAll(async () => {
    mod = await Test.createTestingModule({
      providers: [SavedComparesService, PrismaService],
    }).compile();
    svc = mod.get(SavedComparesService);
    prisma = mod.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();

    const u1 = await prisma.user.create({
      data: { email: `a-${Date.now()}@x`, passwordHash: "x" },
    });
    const u2 = await prisma.user.create({
      data: { email: `b-${Date.now()}@x`, passwordHash: "x" },
    });
    userId = u1.id;
    otherUserId = u2.id;
    const b1 = await prisma.benchmark.create({
      data: { userId, scenario: "inference", tool: "guidellm", name: "r1", params: {} },
    });
    const b2 = await prisma.benchmark.create({
      data: { userId, scenario: "inference", tool: "guidellm", name: "r2", params: {} },
    });
    runIds = [b1.id, b2.id];
  });

  it("creates a SavedCompare and returns it", async () => {
    const sc = await svc.create(userId, {
      name: "Study A",
      benchmarkIds: runIds,
      stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
    });
    expect(sc.name).toBe("Study A");
    expect(sc.benchmarkIds).toEqual(runIds);
  });

  it("returns null from get() if owner mismatch", async () => {
    const sc = await svc.create(userId, {
      name: "n",
      benchmarkIds: runIds,
      stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
    });
    expect(await svc.get(otherUserId, sc.id)).toBeNull();
  });

  it("hydrates benchmarks, returning placeholder for missing ids", async () => {
    const sc = await svc.create(userId, {
      name: "n",
      benchmarkIds: [...runIds, "deleted-id"],
      stageLabels: {
        [runIds[0]]: "A",
        [runIds[1]]: "B",
        "deleted-id": "C",
      },
    });
    const hydrated = await svc.getHydrated(userId, sc.id);
    expect(hydrated).not.toBeNull();
    expect(hydrated!.benchmarks).toHaveLength(3);
    expect(hydrated!.benchmarks[2]).toMatchObject({ id: "deleted-id", missing: true });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm -F @modeldoctor/api test -- saved-compares.service.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/saved-compares/saved-compares.service.ts`:

```ts
import type {
  CreateSavedCompareRequest,
  SavedCompare,
  UpdateSavedCompareRequest,
} from "@modeldoctor/contracts";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";

export interface HydratedBenchmarkRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  // Present when missing === false:
  name?: string | null;
  tool?: string;
  scenario?: string;
  summaryMetrics?: unknown;
  params?: unknown;
  createdAt?: string;
}

export interface HydratedSavedCompare extends SavedCompare {
  benchmarks: HydratedBenchmarkRef[];
}

@Injectable()
export class SavedComparesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: {
    id: string;
    userId: string;
    name: string;
    benchmarkIds: string[];
    stageLabels: unknown;
    baselineId: string | null;
    context: string | null;
    narrative: unknown;
    narrativeAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): SavedCompare {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      benchmarkIds: row.benchmarkIds,
      stageLabels: row.stageLabels as Record<string, string>,
      baselineId: row.baselineId,
      context: row.context,
      narrative: row.narrative,
      narrativeAt: row.narrativeAt ? row.narrativeAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async create(userId: string, body: CreateSavedCompareRequest): Promise<SavedCompare> {
    if (new Set(body.benchmarkIds).size !== body.benchmarkIds.length) {
      throw new ForbiddenException("benchmarkIds must be unique");
    }
    const row = await this.prisma.savedCompare.create({
      data: {
        userId,
        name: body.name,
        benchmarkIds: body.benchmarkIds,
        stageLabels: body.stageLabels,
        baselineId: body.baselineId ?? null,
        context: body.context ?? null,
      },
    });
    return this.serialize(row);
  }

  async list(userId: string): Promise<SavedCompare[]> {
    const rows = await this.prisma.savedCompare.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((r) => this.serialize(r));
  }

  async get(userId: string, id: string): Promise<SavedCompare | null> {
    const row = await this.prisma.savedCompare.findUnique({ where: { id } });
    if (!row || row.userId !== userId) return null;
    return this.serialize(row);
  }

  async getHydrated(userId: string, id: string): Promise<HydratedSavedCompare | null> {
    const sc = await this.get(userId, id);
    if (!sc) return null;
    const benchmarks = await this.prisma.benchmark.findMany({
      where: { id: { in: sc.benchmarkIds } },
    });
    const byId = new Map(benchmarks.map((b) => [b.id, b]));
    const labels = sc.stageLabels;
    const hydrated: HydratedBenchmarkRef[] = sc.benchmarkIds.map((bid) => {
      const b = byId.get(bid);
      if (!b) return { id: bid, stageLabel: labels[bid] ?? "?", missing: true };
      return {
        id: b.id,
        stageLabel: labels[bid] ?? "?",
        missing: false,
        name: b.name,
        tool: b.tool,
        scenario: b.scenario,
        summaryMetrics: b.summaryMetrics,
        params: b.params,
        createdAt: b.createdAt.toISOString(),
      };
    });
    return { ...sc, benchmarks: hydrated };
  }

  async update(
    userId: string,
    id: string,
    body: UpdateSavedCompareRequest,
  ): Promise<SavedCompare> {
    const existing = await this.get(userId, id);
    if (!existing) throw new NotFoundException("SavedCompare not found");
    const row = await this.prisma.savedCompare.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        stageLabels: body.stageLabels ?? undefined,
        baselineId: body.baselineId === undefined ? undefined : body.baselineId,
        context: body.context === undefined ? undefined : body.context,
      },
    });
    return this.serialize(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.get(userId, id);
    if (!existing) throw new NotFoundException("SavedCompare not found");
    await this.prisma.savedCompare.delete({ where: { id } });
  }

  async setNarrative(id: string, narrative: unknown, generatedAt: Date): Promise<void> {
    await this.prisma.savedCompare.update({
      where: { id },
      data: { narrative, narrativeAt: generatedAt },
    });
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm -F @modeldoctor/api test -- saved-compares.service.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/saved-compares/saved-compares.service.ts apps/api/src/modules/saved-compares/saved-compares.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/saved-compares): CRUD service + hydration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Backend — Controller + Module + AppModule wiring

**Files:**
- Create: `apps/api/src/modules/saved-compares/saved-compares.controller.ts`
- Create: `apps/api/src/modules/saved-compares/saved-compares.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the controller**

Create `apps/api/src/modules/saved-compares/saved-compares.controller.ts`:

```ts
import {
  type CreateSavedCompareRequest,
  type UpdateSavedCompareRequest,
  createSavedCompareRequestSchema,
  updateSavedCompareRequestSchema,
} from "@modeldoctor/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { SavedComparesService } from "./saved-compares.service.js";

@UseGuards(JwtAuthGuard)
@Controller("saved-compares")
export class SavedComparesController {
  constructor(private readonly svc: SavedComparesService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return { items: await this.svc.list(user.sub) };
  }

  @Get(":id")
  async get(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    const sc = await this.svc.getHydrated(user.sub, id);
    if (!sc) throw new NotFoundException();
    return sc;
  }

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createSavedCompareRequestSchema)) body: CreateSavedCompareRequest,
  ) {
    return this.svc.create(user.sub, body);
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSavedCompareRequestSchema)) body: UpdateSavedCompareRequest,
  ) {
    return this.svc.update(user.sub, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async delete(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    await this.svc.delete(user.sub, id);
  }
}
```

- [ ] **Step 2: Write the module**

Create `apps/api/src/modules/saved-compares/saved-compares.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { SavedComparesController } from "./saved-compares.controller.js";
import { SavedComparesService } from "./saved-compares.service.js";

@Module({
  imports: [DatabaseModule, LlmJudgeModule],
  controllers: [SavedComparesController],
  providers: [SavedComparesService],
  exports: [SavedComparesService],
})
export class SavedComparesModule {}
```

- [ ] **Step 3: Register in AppModule**

Modify `apps/api/src/app.module.ts`. Find the `InsightsModule` import line and add a sibling import:

```ts
import { SavedComparesModule } from "./modules/saved-compares/saved-compares.module.js";
```

In the `@Module({ imports: [...] })` array, add `SavedComparesModule` adjacent to `InsightsModule`.

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @modeldoctor/api typecheck`
Expected: PASS. (If a fresh worktree fails, run `pnpm -r build` once first per memory.)

- [ ] **Step 5: Smoke-run the API**

Run: `pnpm -F @modeldoctor/api dev` (background). Wait for "Nest application successfully started" log.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/saved-compares`
Expected: `401` (auth required).

Kill the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/saved-compares/saved-compares.controller.ts apps/api/src/modules/saved-compares/saved-compares.module.ts apps/api/src/app.module.ts
git commit -m "$(cat <<'EOF'
feat(api/saved-compares): controller + module + AppModule wiring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Backend — CompareSynthesizeService (AI)

**Files:**
- Create: `apps/api/src/modules/saved-compares/prompts.ts`
- Create: `apps/api/src/modules/saved-compares/compare-synthesize.service.ts`
- Create: `apps/api/src/modules/saved-compares/compare-synthesize.service.spec.ts`
- Modify: `apps/api/src/modules/saved-compares/saved-compares.module.ts` — register the new provider

- [ ] **Step 1: Write the prompts**

Create `apps/api/src/modules/saved-compares/prompts.ts`:

```ts
export const COMPARE_SYS_PROMPT_ZH = `你是一位 LLM 服务性能顾问。给定多个 benchmark run 的对比数据（同一 workload, 不同配置），你要：
1. 写一份 3-5 条的 TL;DR：每条一个标题 + 一句话定量结论（必须引用具体数字或 Δ%）
2. 针对显著差异（>5% 或 verdict 不一致）的指标，每个写一段 2-3 句的分析（"为什么"，不只是描述差异）
3. 给出一段选型建议（"在 X 场景推荐 Y 配置"）+ 0-5 条注意事项 caveats
4. 仅基于提供的数据推断；不要编造未提供的数字
5. 全部用简体中文输出
6. 严格按 JSON schema 输出：{ "tldr": [{"headline","oneLine"}], "analysis": [{"metricLabel","body"}], "conclusion": {"recommendation","caveats":[]} }`;

export const COMPARE_SYS_PROMPT_EN = `You are an LLM serving performance advisor. Given comparison data across multiple benchmark runs (same workload, different configs), you must:
1. Produce a 3-5 entry TL;DR: each is a short headline + one quantified sentence (must cite a specific number or Δ%).
2. For each metric with significant divergence (>5% or differing verdicts), write a 2-3 sentence analysis explaining the WHY, not just the difference.
3. Output one selection recommendation paragraph ("for X scenario, recommend Y config") plus 0-5 caveats.
4. Only infer from the data provided; never invent numbers.
5. Respond entirely in English.
6. Strict JSON schema: { "tldr": [{"headline","oneLine"}], "analysis": [{"metricLabel","body"}], "conclusion": {"recommendation","caveats":[]} }`;
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/saved-compares/compare-synthesize.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      tldr: [{ headline: "QPS 提升", oneLine: "Y-CPU QPS 比 baseline 高 27%" }],
      analysis: [{ metricLabel: "QPS", body: "缓存命中提高使 prefill 减少。" }],
      conclusion: { recommendation: "在低错误率优先场景推荐 LMCache。", caveats: [] },
    }),
    latencyMs: 100,
  })),
}));

import { Test } from "@nestjs/testing";
import { PrismaService } from "../../database/prisma.service.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { SavedComparesService } from "./saved-compares.service.js";

describe("CompareSynthesizeService", () => {
  let svc: CompareSynthesizeService;
  let prisma: PrismaService;
  let userId: string;
  let savedCompareId: string;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CompareSynthesizeService,
        SavedComparesService,
        PrismaService,
        {
          provide: LlmJudgeService,
          useValue: {
            getActive: vi.fn(async () => ({
              id: "p",
              userId: "u",
              providerType: "openai",
              baseUrl: "http://x",
              model: "gpt-4",
              enabled: true,
              apiKey: "sk-test",
            })),
          },
        },
      ],
    }).compile();
    svc = mod.get(CompareSynthesizeService);
    prisma = mod.get(PrismaService);
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
    const u = await prisma.user.create({
      data: { email: `s-${Date.now()}@x`, passwordHash: "x" },
    });
    userId = u.id;
    const b1 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r1",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 100, p90: 200, p99: 500 },
            e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
            requestsPerSecond: { mean: 3 },
            requests: { total: 1000, error: 0 },
          },
        },
      },
    });
    const b2 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r2",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 80, p90: 160, p99: 400 },
            e2eLatency: { p50: 700, p90: 1300, p99: 2700 },
            requestsPerSecond: { mean: 3.8 },
            requests: { total: 1000, error: 10 },
          },
        },
      },
    });
    const sc = await prisma.savedCompare.create({
      data: {
        userId,
        name: "n",
        benchmarkIds: [b1.id, b2.id],
        stageLabels: { [b1.id]: "A", [b2.id]: "B" },
        baselineId: b1.id,
      },
    });
    savedCompareId = sc.id;
  });

  it("calls LLM and persists narrative", async () => {
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.narrative.tldr).toHaveLength(1);
    expect(r.fromCache).toBe(false);
    const refreshed = await prisma.savedCompare.findUnique({ where: { id: savedCompareId } });
    expect(refreshed?.narrative).not.toBeNull();
  });

  it("returns cached on second call", async () => {
    await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    const r = await svc.synthesize(userId, savedCompareId, { locale: "zh-CN" });
    expect(r.fromCache).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/api test -- compare-synthesize.service.spec`
Expected: FAIL — service not found.

- [ ] **Step 4: Implement the service**

Create `apps/api/src/modules/saved-compares/compare-synthesize.service.ts`:

```ts
import { createHash } from "node:crypto";
import {
  type CompareNarrative,
  type CompareSynthesizeRequest,
  type CompareSynthesizeResponse,
  compareNarrativeSchema,
} from "@modeldoctor/contracts";
import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { LruCache } from "../insights/cache.js";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";
import { summarizeForPrompt } from "./metrics.js";
import { COMPARE_SYS_PROMPT_EN, COMPARE_SYS_PROMPT_ZH } from "./prompts.js";
import {
  type HydratedSavedCompare,
  SavedComparesService,
} from "./saved-compares.service.js";

interface CacheEntry {
  generatedAt: string;
  narrative: CompareNarrative;
}

@Injectable()
export class CompareSynthesizeService {
  private cache = new LruCache<string, CacheEntry>(100, { ttlMs: 24 * 60 * 60 * 1000 });

  constructor(
    private readonly svc: SavedComparesService,
    private readonly llmJudge: LlmJudgeService,
  ) {}

  async synthesize(
    userId: string,
    id: string,
    body: CompareSynthesizeRequest,
  ): Promise<CompareSynthesizeResponse> {
    const sc = await this.svc.getHydrated(userId, id);
    if (!sc) throw new NotFoundException("SavedCompare not found");

    const provider = await this.llmJudge.getActive(userId);
    if (!provider || !provider.enabled) {
      throw new ServiceUnavailableException("LLM provider not configured");
    }

    const key = this.cacheKey(sc, body.locale);
    const hit = this.cache.get(key);
    if (hit) {
      return { narrative: hit.narrative, generatedAt: hit.generatedAt, fromCache: true };
    }

    const userPrompt = this.buildUserPrompt(sc, body.locale);
    const sys = body.locale === "en-US" ? COMPARE_SYS_PROMPT_EN : COMPARE_SYS_PROMPT_ZH;

    const out = await chatCompletion(provider, [
      { role: "system", content: sys },
      { role: "user", content: userPrompt },
    ]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(this.extractJson(out.content));
    } catch {
      throw new ServiceUnavailableException("LLM returned invalid JSON");
    }
    const narrative = compareNarrativeSchema.parse(parsed);

    const generatedAt = new Date();
    await this.svc.setNarrative(id, narrative, generatedAt);
    this.cache.set(key, { generatedAt: generatedAt.toISOString(), narrative });

    return { narrative, generatedAt: generatedAt.toISOString(), fromCache: false };
  }

  private cacheKey(sc: HydratedSavedCompare, locale: string): string {
    const runsDigest = createHash("sha256")
      .update(
        JSON.stringify(
          sc.benchmarks.map((b) => ({
            id: b.id,
            mh: b.missing
              ? null
              : createHash("sha256").update(JSON.stringify(b.summaryMetrics ?? {})).digest("hex"),
          })),
        ),
      )
      .digest("hex");
    return createHash("sha256")
      .update(
        JSON.stringify({
          id: sc.id,
          baselineId: sc.baselineId,
          stageLabels: sc.stageLabels,
          context: sc.context,
          runsDigest,
          locale,
        }),
      )
      .digest("hex");
  }

  private buildUserPrompt(sc: HydratedSavedCompare, locale: string): string {
    const lines: string[] = [];
    if (sc.context) lines.push(`Context: ${sc.context}`);
    lines.push(`Runs (${sc.benchmarks.length}):`);
    for (const b of sc.benchmarks) {
      if (b.missing) {
        lines.push(`- [${b.stageLabel}] (data deleted)`);
        continue;
      }
      const m = summarizeForPrompt(b.summaryMetrics);
      lines.push(
        `- [${b.stageLabel}] ${b.tool}/${b.scenario}: ` +
          `qps=${m.throughput ?? "—"} err=${m.errorRate ?? "—"} ` +
          `ttft p50/p90/p99=${m.ttft?.p50 ?? "—"}/${m.ttft?.p90 ?? "—"}/${m.ttft?.p99 ?? "—"} ` +
          `e2e p50/p90/p99=${m.e2e?.p50 ?? "—"}/${m.e2e?.p90 ?? "—"}/${m.e2e?.p99 ?? "—"}`,
      );
    }
    if (sc.baselineId) {
      const bl = sc.benchmarks.find((b) => b.id === sc.baselineId);
      if (bl) lines.push(`Baseline stage: ${bl.stageLabel}`);
    }
    lines.push(
      locale === "en-US"
        ? "Respond strictly as JSON matching the schema."
        : "严格按 JSON schema 输出。",
    );
    return lines.join("\n");
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    return fence ? fence[1].trim() : trimmed;
  }
}
```

- [ ] **Step 5: Register provider in the module**

Edit `apps/api/src/modules/saved-compares/saved-compares.module.ts`. Add the new service to `providers` and `exports`:

```ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { LlmJudgeModule } from "../llm-judge/llm-judge.module.js";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
import { SavedComparesController } from "./saved-compares.controller.js";
import { SavedComparesService } from "./saved-compares.service.js";

@Module({
  imports: [DatabaseModule, LlmJudgeModule],
  controllers: [SavedComparesController],
  providers: [SavedComparesService, CompareSynthesizeService],
  exports: [SavedComparesService, CompareSynthesizeService],
})
export class SavedComparesModule {}
```

- [ ] **Step 6: Run tests to confirm pass**

Run: `pnpm -F @modeldoctor/api test -- compare-synthesize.service.spec`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/saved-compares/prompts.ts apps/api/src/modules/saved-compares/compare-synthesize.service.ts apps/api/src/modules/saved-compares/compare-synthesize.service.spec.ts apps/api/src/modules/saved-compares/saved-compares.module.ts
git commit -m "$(cat <<'EOF'
feat(api/saved-compares): AI synthesize service with LRU cache

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Backend — Synthesize endpoint + HTTP e2e

**Files:**
- Modify: `apps/api/src/modules/saved-compares/saved-compares.controller.ts` — add synthesize endpoint
- Create: `apps/api/test/e2e/saved-compares.e2e-spec.ts`

- [ ] **Step 1: Add synthesize endpoint**

In `saved-compares.controller.ts`, add:

```ts
import {
  type CompareSynthesizeRequest,
  compareSynthesizeRequestSchema,
} from "@modeldoctor/contracts";
import { CompareSynthesizeService } from "./compare-synthesize.service.js";
```

Add `private readonly synth: CompareSynthesizeService` to the constructor, then:

```ts
@Post(":id/synthesize")
async synthesize(
  @CurrentUser() user: JwtPayload,
  @Param("id") id: string,
  @Body(new ZodValidationPipe(compareSynthesizeRequestSchema)) body: CompareSynthesizeRequest,
) {
  return this.synth.synthesize(user.sub, id, body);
}
```

- [ ] **Step 2: Write the e2e test**

Create `apps/api/test/e2e/saved-compares.e2e-spec.ts`:

```ts
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/modules/insights/llm-client.js", () => ({
  chatCompletion: vi.fn(async () => ({
    content: JSON.stringify({
      tldr: [{ headline: "QPS up", oneLine: "B is 27% faster" }],
      analysis: [{ metricLabel: "QPS", body: "Cache hit explains the gain." }],
      conclusion: { recommendation: "Pick B for throughput.", caveats: [] },
    }),
    latencyMs: 100,
  })),
}));

import { PrismaService } from "../../src/database/prisma.service.js";
import { type E2EContext, bootE2E, registerUser } from "../helpers/app.js";

describe("/api/saved-compares (e2e)", () => {
  let ctx: E2EContext;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  let runIds: string[];

  beforeAll(async () => {
    ctx = await bootE2E();
    prisma = ctx.app.get(PrismaService);
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany();
    await prisma.user.deleteMany();
    const u = await registerUser(ctx.app, "sc-e2e@example.com", "Password1!");
    token = u.token;
    userId = u.user.id;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  beforeEach(async () => {
    await prisma.savedCompare.deleteMany();
    await prisma.benchmark.deleteMany({ where: { userId } });
    const b1 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r1",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 100, p90: 200, p99: 500 },
            e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
            requestsPerSecond: { mean: 3 },
            requests: { total: 1000, error: 0 },
          },
        },
      },
    });
    const b2 = await prisma.benchmark.create({
      data: {
        userId,
        scenario: "inference",
        tool: "guidellm",
        name: "r2",
        params: {},
        summaryMetrics: {
          tool: "guidellm",
          data: {
            ttft: { p50: 80, p90: 160, p99: 400 },
            e2eLatency: { p50: 700, p90: 1300, p99: 2700 },
            requestsPerSecond: { mean: 3.8 },
            requests: { total: 1000, error: 10 },
          },
        },
      },
    });
    runIds = [b1.id, b2.id];
  });

  it("POST creates, GET hydrates with benchmarks", async () => {
    const created = await request(ctx.app.getHttpServer())
      .post("/api/saved-compares")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "test",
        benchmarkIds: runIds,
        stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
        baselineId: runIds[0],
      })
      .expect(201);

    const detail = await request(ctx.app.getHttpServer())
      .get(`/api/saved-compares/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(detail.body.benchmarks).toHaveLength(2);
    expect(detail.body.benchmarks[0].missing).toBe(false);
  });

  it("synthesize returns narrative and second call is fromCache", async () => {
    const sc = await request(ctx.app.getHttpServer())
      .post("/api/saved-compares")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "test",
        benchmarkIds: runIds,
        stageLabels: { [runIds[0]]: "A", [runIds[1]]: "B" },
      })
      .expect(201);

    await prisma.llmJudgeProvider.create({
      data: {
        userId,
        providerType: "openai",
        baseUrl: "http://x",
        model: "gpt-4",
        apiKeyCipher: "v1:a:b:c",
        enabled: true,
      },
    });

    const r1 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);

    expect(r1.body.fromCache).toBe(false);
    expect(r1.body.narrative.tldr).toHaveLength(1);

    const r2 = await request(ctx.app.getHttpServer())
      .post(`/api/saved-compares/${sc.body.id}/synthesize`)
      .set("Authorization", `Bearer ${token}`)
      .send({ locale: "zh-CN" })
      .expect(201);
    expect(r2.body.fromCache).toBe(true);
  });
});
```

- [ ] **Step 3: Run e2e tests**

Run: `pnpm -F @modeldoctor/api test:e2e -- saved-compares.e2e-spec`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/saved-compares/saved-compares.controller.ts apps/api/test/e2e/saved-compares.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(api/saved-compares): synthesize endpoint + e2e coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — react-query hooks

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/queries.ts`

- [ ] **Step 1: Implement hooks**

Create `apps/web/src/features/benchmarks/compare/queries.ts`:

```ts
import { api } from "@/lib/api-client";
import type {
  CompareSynthesizeRequest,
  CompareSynthesizeResponse,
  CreateSavedCompareRequest,
  ListSavedComparesResponse,
  SavedCompare,
  UpdateSavedCompareRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface HydratedBenchmarkRef {
  id: string;
  stageLabel: string;
  missing: boolean;
  name?: string | null;
  tool?: string;
  scenario?: string;
  summaryMetrics?: unknown;
  params?: unknown;
  createdAt?: string;
}

export type HydratedSavedCompare = SavedCompare & { benchmarks: HydratedBenchmarkRef[] };

export const savedCompareKeys = {
  all: ["saved-compares"] as const,
  list: () => [...savedCompareKeys.all, "list"] as const,
  detail: (id: string) => [...savedCompareKeys.all, "detail", id] as const,
};

export function useSavedCompares() {
  return useQuery<ListSavedComparesResponse>({
    queryKey: savedCompareKeys.list(),
    queryFn: () => api.get<ListSavedComparesResponse>("/api/saved-compares"),
  });
}

export function useSavedCompare(id: string) {
  return useQuery<HydratedSavedCompare>({
    queryKey: savedCompareKeys.detail(id),
    queryFn: () => api.get<HydratedSavedCompare>(`/api/saved-compares/${id}`),
    enabled: !!id,
  });
}

export function useCreateSavedCompare() {
  const qc = useQueryClient();
  return useMutation<SavedCompare, Error, CreateSavedCompareRequest>({
    mutationFn: (body) => api.post<SavedCompare>("/api/saved-compares", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.list() }),
  });
}

export function useUpdateSavedCompare(id: string) {
  const qc = useQueryClient();
  return useMutation<SavedCompare, Error, UpdateSavedCompareRequest>({
    mutationFn: (body) => api.patch<SavedCompare>(`/api/saved-compares/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: savedCompareKeys.detail(id) });
      qc.invalidateQueries({ queryKey: savedCompareKeys.list() });
    },
  });
}

export function useDeleteSavedCompare() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/saved-compares/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.list() }),
  });
}

export function useSynthesizeSavedCompare(id: string) {
  const qc = useQueryClient();
  return useMutation<CompareSynthesizeResponse, Error, CompareSynthesizeRequest>({
    mutationFn: (body) =>
      api.post<CompareSynthesizeResponse>(`/api/saved-compares/${id}/synthesize`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.detail(id) }),
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @modeldoctor/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/queries.ts
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): react-query hooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — `StageBarChart` component

**Files:**
- Create: `apps/web/src/components/charts/StageBarChart.tsx`
- Create: `apps/web/src/components/charts/StageBarChart.test.tsx`
- Modify: `apps/web/src/components/charts/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/charts/StageBarChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBarChart } from "./StageBarChart";

describe("StageBarChart", () => {
  it("renders one bar per stage per series", () => {
    render(
      <StageBarChart
        title="QPS"
        data={[
          { stage: "A", qps: 3.0 },
          { stage: "B", qps: 3.5 },
        ]}
        series={[{ key: "qps", label: "QPS", color: "#3498db" }]}
        height={200}
      />,
    );
    expect(screen.getByText("QPS")).toBeInTheDocument();
    // Recharts renders SVG <rect> per bar — total 2 stages × 1 series
    const rects = document.querySelectorAll("svg .recharts-bar-rectangle");
    expect(rects.length).toBe(2);
  });

  it("renders empty placeholder when data is empty", () => {
    render(
      <StageBarChart
        title="QPS"
        data={[]}
        series={[{ key: "qps", label: "QPS", color: "#3498db" }]}
        height={200}
      />,
    );
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web test -- StageBarChart.test`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/charts/StageBarChart.tsx`:

```tsx
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface StageBarSeries {
  key: string;
  label: string;
  color: string;
}

export interface StageBarDatum {
  stage: string;
  [seriesKey: string]: string | number | null;
}

export interface StageBarChartProps {
  title?: string;
  data: StageBarDatum[];
  series: StageBarSeries[];
  height?: number;
  yLabel?: string;
}

export function StageBarChart({
  title,
  data,
  series,
  height = 280,
  yLabel,
}: StageBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
        {title ? <div className="mb-2 font-medium text-foreground">{title}</div> : null}
        <div>No data</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border p-4">
      {title ? <div className="mb-2 text-sm font-medium">{title}</div> : null}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="stage" fontSize={12} />
          <YAxis fontSize={12} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft" } : undefined} />
          <Tooltip />
          {series.length > 1 ? <Legend /> : null}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Export from index**

Edit `apps/web/src/components/charts/index.ts` and add:

```ts
export * from "./StageBarChart";
```

(Match the existing `export * from "./BarChart";` style.)

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm -F @modeldoctor/web test -- StageBarChart.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/charts/StageBarChart.tsx apps/web/src/components/charts/StageBarChart.test.tsx apps/web/src/components/charts/index.ts
git commit -m "$(cat <<'EOF'
feat(web/charts): StageBarChart for categorical-X grouped bars

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend — i18n keys (zh-CN + en-US)

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`

- [ ] **Step 1: Add zh-CN keys**

Read the file `apps/web/src/locales/zh-CN/benchmarks.json`. Inside the top-level object, add a new sibling object key `savedCompare`:

```json
"savedCompare": {
  "saveButton": "保存对比",
  "savedListLink": "历史对比",
  "dialog": {
    "title": "保存为可分享对比报告",
    "nameLabel": "名称",
    "namePlaceholder": "如：Qwen3 + KV Cache 横评",
    "stageLabelsTitle": "档位标签",
    "stageLabelsHint": "给每个 run 一个简短标签（如 A / Y-CPU），会出现在图表 X 轴与表头",
    "contextLabel": "测试环境与上下文（可选）",
    "contextPlaceholder": "硬件、镜像版本、为什么对比、已知踩坑……",
    "submit": "保存并跳转",
    "cancel": "取消"
  },
  "list": {
    "title": "已保存的对比",
    "empty": "尚无已保存的对比。在 Compare 页点击「保存对比」开始。",
    "columnName": "名称",
    "columnRuns": "run 数",
    "columnCreated": "创建时间",
    "columnActions": "操作"
  },
  "detail": {
    "regenerate": "重新生成 AI 分析",
    "export": "导出 HTML",
    "editName": "编辑名称",
    "editContext": "编辑上下文",
    "deleteTitle": "删除该对比报告",
    "deleteBody": "此操作不可撤销。",
    "missingBenchmark": "数据已删除"
  },
  "report": {
    "sectionTldr": "概述 / TL;DR",
    "sectionMatrix": "测试矩阵",
    "sectionGrid": "关键指标对比",
    "sectionCharts": "图表",
    "sectionAnalysis": "分析",
    "sectionConclusion": "结论与选型建议",
    "sectionEnv": "测试环境",
    "chartQpsTitle": "QPS",
    "chartErrTitle": "错误率",
    "chartTtftTitle": "TTFT 分位（ms）",
    "chartE2eTitle": "e2e 延迟分位（ms）",
    "chartExtraTitle": "缓存命中 / 额外指标",
    "narrativeMissing": "尚未生成 AI 分析。",
    "generateButton": "生成 AI 分析"
  },
  "errors": {
    "providerMissing": "未配置 LLM 服务",
    "providerGoSettings": "前往设置",
    "synthFailed": "生成 AI 分析失败"
  }
}
```

- [ ] **Step 2: Add en-US keys**

Read `apps/web/src/locales/en-US/benchmarks.json`. Add a sibling `savedCompare` object:

```json
"savedCompare": {
  "saveButton": "Save comparison",
  "savedListLink": "Saved comparisons",
  "dialog": {
    "title": "Save as a shareable report",
    "nameLabel": "Name",
    "namePlaceholder": "e.g. Qwen3 + KV Cache shootout",
    "stageLabelsTitle": "Stage labels",
    "stageLabelsHint": "Short label per run (A / Y-CPU). Appears as the X axis on charts.",
    "contextLabel": "Test environment & context (optional)",
    "contextPlaceholder": "Hardware, image tags, motivation, known issues…",
    "submit": "Save and view",
    "cancel": "Cancel"
  },
  "list": {
    "title": "Saved comparisons",
    "empty": "No saved comparisons yet. Click \"Save comparison\" on the Compare page.",
    "columnName": "Name",
    "columnRuns": "Runs",
    "columnCreated": "Created",
    "columnActions": "Actions"
  },
  "detail": {
    "regenerate": "Regenerate AI analysis",
    "export": "Export HTML",
    "editName": "Edit name",
    "editContext": "Edit context",
    "deleteTitle": "Delete this report",
    "deleteBody": "This cannot be undone.",
    "missingBenchmark": "Data deleted"
  },
  "report": {
    "sectionTldr": "Overview / TL;DR",
    "sectionMatrix": "Test matrix",
    "sectionGrid": "Key metrics",
    "sectionCharts": "Charts",
    "sectionAnalysis": "Analysis",
    "sectionConclusion": "Conclusion & recommendation",
    "sectionEnv": "Test environment",
    "chartQpsTitle": "QPS",
    "chartErrTitle": "Error rate",
    "chartTtftTitle": "TTFT percentiles (ms)",
    "chartE2eTitle": "e2e latency percentiles (ms)",
    "chartExtraTitle": "Cache hit / extra metrics",
    "narrativeMissing": "AI analysis not generated yet.",
    "generateButton": "Generate AI analysis"
  },
  "errors": {
    "providerMissing": "LLM provider not configured",
    "providerGoSettings": "Go to settings",
    "synthFailed": "Failed to generate AI analysis"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/locales/zh-CN/benchmarks.json apps/web/src/locales/en-US/benchmarks.json
git commit -m "$(cat <<'EOF'
feat(web/i18n): savedCompare keys (zh-CN + en-US)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend — `AiAnalysisPanel`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/AiAnalysisPanel.tsx`
- Create: `apps/web/src/features/benchmarks/compare/AiAnalysisPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/AiAnalysisPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiAnalysisPanel } from "./AiAnalysisPanel";

describe("AiAnalysisPanel", () => {
  it("renders narrative sections when provided", () => {
    render(
      <AiAnalysisPanel
        narrative={{
          tldr: [{ headline: "QPS 升", oneLine: "B 比 A 高 27%" }],
          analysis: [{ metricLabel: "QPS", body: "缓存命中提高。" }],
          conclusion: { recommendation: "选 B", caveats: ["err 率略高"] },
        }}
        onGenerate={() => {}}
        canGenerate
        isGenerating={false}
      />,
    );
    expect(screen.getByText("QPS 升")).toBeInTheDocument();
    expect(screen.getByText(/缓存命中提高/)).toBeInTheDocument();
    expect(screen.getByText(/选 B/)).toBeInTheDocument();
    expect(screen.getByText(/err 率略高/)).toBeInTheDocument();
  });

  it("renders generate button when narrative is null", () => {
    render(
      <AiAnalysisPanel narrative={null} onGenerate={() => {}} canGenerate isGenerating={false} />,
    );
    expect(screen.getByRole("button", { name: /生成|generate/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/web/src/features/benchmarks/compare/AiAnalysisPanel.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CompareNarrative } from "@modeldoctor/contracts";
import { RefreshCw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface AiAnalysisPanelProps {
  narrative: CompareNarrative | null;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
  errorMessage?: string;
}

export function AiAnalysisPanel({
  narrative,
  onGenerate,
  canGenerate,
  isGenerating,
  errorMessage,
}: AiAnalysisPanelProps) {
  const { t } = useTranslation("benchmarks");

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {t("savedCompare.report.sectionAnalysis")}
        </h3>
        {narrative && canGenerate ? (
          <Button variant="ghost" size="sm" onClick={onGenerate} disabled={isGenerating}>
            <RefreshCw className={`mr-1 h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
            {t("savedCompare.detail.regenerate")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!narrative && !isGenerating ? (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{t("savedCompare.report.narrativeMissing")}</div>
            <Button onClick={onGenerate} disabled={!canGenerate} className="gap-1.5">
              <Sparkles className="h-4 w-4" /> {t("savedCompare.report.generateButton")}
            </Button>
            {!canGenerate ? (
              <div className="text-xs text-muted-foreground">{t("savedCompare.errors.providerMissing")}</div>
            ) : null}
          </div>
        ) : null}
        {isGenerating ? (
          <div className="space-y-2">
            <div className="h-3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : null}
        {errorMessage ? <div className="text-sm text-rose-600">{errorMessage}</div> : null}
        {narrative ? (
          <div className="space-y-4">
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("savedCompare.report.sectionTldr")}
              </h4>
              <ul className="space-y-2">
                {narrative.tldr.map((row, i) => (
                  <li key={i} className="rounded-md border border-border p-3">
                    <div className="font-medium">{row.headline}</div>
                    <div className="text-sm text-muted-foreground">{row.oneLine}</div>
                  </li>
                ))}
              </ul>
            </section>
            {narrative.analysis.length > 0 ? (
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  {t("savedCompare.report.sectionAnalysis")}
                </h4>
                <div className="space-y-3">
                  {narrative.analysis.map((row, i) => (
                    <div key={i}>
                      <div className="text-sm font-medium">{row.metricLabel}</div>
                      <div className="text-sm text-muted-foreground">{row.body}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("savedCompare.report.sectionConclusion")}
              </h4>
              <p className="text-sm">{narrative.conclusion.recommendation}</p>
              {narrative.conclusion.caveats.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                  {narrative.conclusion.caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm -F @modeldoctor/web test -- AiAnalysisPanel.test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/AiAnalysisPanel.tsx apps/web/src/features/benchmarks/compare/AiAnalysisPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): AiAnalysisPanel component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Frontend — `SaveCompareDialog`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/SaveCompareDialog.tsx`
- Create: `apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SaveCompareDialog } from "./SaveCompareDialog";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SaveCompareDialog", () => {
  const runs = [
    { id: "r1", name: "run-a", tool: "guidellm" },
    { id: "r2", name: "run-b", tool: "guidellm" },
  ];

  it("renders one stage-label input per run", () => {
    render(
      wrap(
        <SaveCompareDialog
          open
          onOpenChange={() => {}}
          runs={runs}
          baselineId="r1"
          context=""
        />,
      ),
    );
    expect(screen.getByLabelText(/run-a/)).toBeInTheDocument();
    expect(screen.getByLabelText(/run-b/)).toBeInTheDocument();
  });

  it("submit is disabled until name and all labels provided", async () => {
    const u = userEvent.setup();
    render(
      wrap(
        <SaveCompareDialog
          open
          onOpenChange={() => {}}
          runs={runs}
          baselineId="r1"
          context=""
        />,
      ),
    );
    const submit = screen.getByRole("button", { name: /保存|save/i });
    expect(submit).toBeDisabled();

    await u.type(screen.getByPlaceholderText(/Qwen3|横评/i), "Study A");
    await u.type(screen.getByLabelText(/run-a/), "A");
    await u.type(screen.getByLabelText(/run-b/), "B");
    expect(submit).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/web/src/features/benchmarks/compare/SaveCompareDialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useCreateSavedCompare } from "./queries";

export interface SaveCompareDialogRun {
  id: string;
  name: string | null;
  tool: string;
}

export interface SaveCompareDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  runs: SaveCompareDialogRun[];
  baselineId: string | null;
  context: string;
}

export function SaveCompareDialog({
  open,
  onOpenChange,
  runs,
  baselineId,
  context,
}: SaveCompareDialogProps) {
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const create = useCreateSavedCompare();
  const [name, setName] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ctx, setCtx] = useState(context);

  const allLabelled = runs.every((r) => labels[r.id]?.trim());
  const canSubmit = name.trim().length > 0 && allLabelled && !create.isPending;

  async function submit() {
    if (!canSubmit) return;
    const sc = await create.mutateAsync({
      name: name.trim(),
      benchmarkIds: runs.map((r) => r.id),
      stageLabels: Object.fromEntries(runs.map((r) => [r.id, labels[r.id].trim()])),
      baselineId: baselineId ?? undefined,
      context: ctx.trim() || undefined,
    });
    onOpenChange(false);
    navigate(`/benchmarks/compare/saved/${sc.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("savedCompare.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="sc-name">{t("savedCompare.dialog.nameLabel")}</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("savedCompare.dialog.namePlaceholder")}
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-1">
              {t("savedCompare.dialog.stageLabelsTitle")}
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              {t("savedCompare.dialog.stageLabelsHint")}
            </div>
            <div className="space-y-2">
              {runs.map((r) => (
                <div key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Label htmlFor={`label-${r.id}`} className="text-sm font-normal">
                    {r.name ?? r.id}
                  </Label>
                  <Input
                    id={`label-${r.id}`}
                    aria-label={r.name ?? r.id}
                    className="w-32"
                    value={labels[r.id] ?? ""}
                    onChange={(e) => setLabels((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="sc-ctx">{t("savedCompare.dialog.contextLabel")}</Label>
            <Textarea
              id="sc-ctx"
              rows={4}
              value={ctx}
              onChange={(e) => setCtx(e.target.value)}
              placeholder={t("savedCompare.dialog.contextPlaceholder")}
            />
          </div>
          {create.error ? (
            <div className="text-sm text-rose-600">{create.error.message}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("savedCompare.dialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("savedCompare.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm -F @modeldoctor/web test -- SaveCompareDialog.test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/SaveCompareDialog.tsx apps/web/src/features/benchmarks/compare/SaveCompareDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): SaveCompareDialog with stage-label inputs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Frontend — `StageBarChartsSection` + `ReportSections`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/StageBarChartsSection.tsx`
- Create: `apps/web/src/features/benchmarks/compare/StageBarChartsSection.test.tsx`
- Create: `apps/web/src/features/benchmarks/compare/ReportSections.tsx`

`StageBarChartsSection` derives 4 chart datasets from the benchmarks; `ReportSections` is the 7-section layout shared by ad-hoc Compare and SavedCompareDetail.

- [ ] **Step 1: Write the chart-section test**

Create `apps/web/src/features/benchmarks/compare/StageBarChartsSection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBarChartsSection } from "./StageBarChartsSection";

const guidellmMetrics = (qps: number, errPct: number) => ({
  tool: "guidellm",
  data: {
    ttft: { p50: 100, p90: 200, p99: 500 },
    e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
    requestsPerSecond: { mean: qps },
    requests: { total: 1000, error: Math.round((errPct / 100) * 1000) },
  },
});

describe("StageBarChartsSection", () => {
  it("renders 3 chart panels for guidellm runs", () => {
    render(
      <StageBarChartsSection
        runs={[
          { id: "a", stageLabel: "A", tool: "guidellm", summaryMetrics: guidellmMetrics(3, 0) },
          { id: "b", stageLabel: "B", tool: "guidellm", summaryMetrics: guidellmMetrics(3.5, 0.5) },
        ]}
      />,
    );
    expect(screen.getByText(/QPS/)).toBeInTheDocument();
    expect(screen.getByText(/TTFT/i)).toBeInTheDocument();
    expect(screen.getByText(/e2e/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `StageBarChartsSection.tsx`**

Create the file:

```tsx
import { StageBarChart, type StageBarDatum } from "@/components/charts/StageBarChart";
import { useTranslation } from "react-i18next";
import { summarizeForPrompt } from "./client-metrics";

export interface StageRun {
  id: string;
  stageLabel: string;
  tool: string;
  summaryMetrics: unknown;
}

export function StageBarChartsSection({ runs }: { runs: StageRun[] }) {
  const { t } = useTranslation("benchmarks");
  const summaries = runs.map((r) => ({ r, s: summarizeForPrompt(r.summaryMetrics) }));

  const qpsErr: StageBarDatum[] = summaries.map(({ r, s }) => ({
    stage: r.stageLabel,
    qps: s.throughput ?? 0,
    err: (s.errorRate ?? 0) * 100,
  }));

  const ttft: StageBarDatum[] = summaries
    .filter(({ s }) => s.ttft)
    .map(({ r, s }) => ({
      stage: r.stageLabel,
      p50: s.ttft!.p50 ?? 0,
      p90: s.ttft!.p90 ?? 0,
      p99: s.ttft!.p99 ?? 0,
    }));

  const e2e: StageBarDatum[] = summaries
    .filter(({ s }) => s.e2e)
    .map(({ r, s }) => ({
      stage: r.stageLabel,
      p50: s.e2e!.p50 ?? 0,
      p90: s.e2e!.p90 ?? 0,
      p99: s.e2e!.p99 ?? 0,
    }));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <StageBarChart
        title={t("savedCompare.report.chartQpsTitle")}
        data={qpsErr}
        series={[{ key: "qps", label: "QPS", color: "#2980b9" }]}
        yLabel="req/s"
      />
      <StageBarChart
        title={t("savedCompare.report.chartErrTitle")}
        data={qpsErr}
        series={[{ key: "err", label: "%", color: "#c0392b" }]}
        yLabel="%"
      />
      <StageBarChart
        title={t("savedCompare.report.chartTtftTitle")}
        data={ttft}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
      />
      <StageBarChart
        title={t("savedCompare.report.chartE2eTitle")}
        data={e2e}
        series={[
          { key: "p50", label: "p50", color: "#27ae60" },
          { key: "p90", label: "p90", color: "#e67e22" },
          { key: "p99", label: "p99", color: "#c0392b" },
        ]}
        yLabel="ms"
      />
    </div>
  );
}
```

- [ ] **Step 3: Add client-side `client-metrics.ts`**

Create `apps/web/src/features/benchmarks/compare/client-metrics.ts` (mirror of `apps/api/src/modules/saved-compares/metrics.ts`):

```ts
type Tagged = { tool?: string; data?: Record<string, unknown> };

function asTagged(m: unknown): Tagged | null {
  if (!m || typeof m !== "object") return null;
  const t = m as Tagged;
  return t.data ? t : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fromDist(data: Record<string, unknown>, key: string, field: string): number | null {
  const dist = data[key] as Record<string, unknown> | undefined;
  return asFiniteNumber(dist?.[field]);
}

export interface PromptMetricsSummary {
  throughput: number | null;
  errorRate: number | null;
  ttft: { p50: number | null; p90: number | null; p99: number | null } | null;
  e2e: { p50: number | null; p90: number | null; p99: number | null } | null;
}

export function summarizeForPrompt(m: unknown): PromptMetricsSummary {
  const t = asTagged(m);
  const tool = t?.tool;
  const ttftKey = tool === "guidellm" ? "ttft" : tool === "genai-perf" ? "timeToFirstToken" : null;
  const e2eKey =
    tool === "guidellm"
      ? "e2eLatency"
      : tool === "vegeta"
      ? "latencies"
      : tool === "genai-perf"
      ? "requestLatency"
      : null;

  const throughput =
    tool === "guidellm"
      ? asFiniteNumber((t!.data!.requestsPerSecond as { mean?: number } | undefined)?.mean)
      : tool === "vegeta"
      ? asFiniteNumber((t!.data!.requests as { throughput?: number } | undefined)?.throughput)
      : tool === "genai-perf"
      ? asFiniteNumber((t!.data!.requestThroughput as { avg?: number } | undefined)?.avg)
      : null;

  let errorRate: number | null = null;
  if (t?.data) {
    if (tool === "guidellm") {
      const r = t.data.requests as { total?: number; error?: number } | undefined;
      const total = asFiniteNumber(r?.total);
      const err = asFiniteNumber(r?.error);
      errorRate = total !== null && total > 0 && err !== null ? err / total : null;
    } else if (tool === "vegeta") {
      const s = asFiniteNumber(t.data.success);
      errorRate = s === null ? null : 1 - s / 100;
    }
  }

  return {
    throughput,
    errorRate,
    ttft:
      t?.data && ttftKey
        ? {
            p50: fromDist(t.data, ttftKey, "p50"),
            p90: fromDist(t.data, ttftKey, "p90"),
            p99: fromDist(t.data, ttftKey, "p99"),
          }
        : null,
    e2e:
      t?.data && e2eKey
        ? {
            p50: fromDist(t.data, e2eKey, "p50"),
            p90: fromDist(t.data, e2eKey, "p90"),
            p99: fromDist(t.data, e2eKey, "p99"),
          }
        : null,
  };
}
```

- [ ] **Step 4: Implement `ReportSections.tsx`**

Create `apps/web/src/features/benchmarks/compare/ReportSections.tsx`:

```tsx
import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import { CompareGrid } from "./CompareGrid";
import { StageBarChartsSection, type StageRun } from "./StageBarChartsSection";

export interface ReportRun extends StageRun {
  // Benchmark fields needed by CompareGrid:
  benchmark: Benchmark | null;        // null => missing/deleted
  paramsSummary: { workload?: string; concurrency?: number; duration?: number };
  scenario: string;
}

export interface ReportSectionsProps {
  runs: ReportRun[];
  baselineId: string | null;
  narrative: CompareNarrative | null;
  context: string | null;
  environmentLines: string[];           // auto-derived: per-run "connection / model / tool / version"
}

export function ReportSections({
  runs,
  baselineId,
  narrative,
  context,
  environmentLines,
}: ReportSectionsProps) {
  const { t } = useTranslation("benchmarks");
  const livingRuns = runs.filter((r) => r.benchmark !== null);

  return (
    <div data-report-root className="space-y-8">
      {/* 1. TL;DR */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionTldr")}</h2>
        {narrative ? (
          <ul className="space-y-2">
            {narrative.tldr.map((row, i) => (
              <li key={i} className="rounded-md border border-border p-3">
                <div className="font-medium">{row.headline}</div>
                <div className="text-sm text-muted-foreground">{row.oneLine}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">{t("savedCompare.report.narrativeMissing")}</div>
        )}
      </section>

      {/* 2. Test matrix */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionMatrix")}</h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">stage</th>
                <th className="px-3 py-2">name</th>
                <th className="px-3 py-2">tool</th>
                <th className="px-3 py-2">scenario</th>
                <th className="px-3 py-2">workload</th>
                <th className="px-3 py-2">concurrency</th>
                <th className="px-3 py-2">duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{r.stageLabel}</td>
                  <td className="px-3 py-2">
                    {r.benchmark === null
                      ? t("savedCompare.detail.missingBenchmark")
                      : r.benchmark.name}
                  </td>
                  <td className="px-3 py-2">{r.benchmark?.tool ?? "—"}</td>
                  <td className="px-3 py-2">{r.scenario}</td>
                  <td className="px-3 py-2">{r.paramsSummary.workload ?? "—"}</td>
                  <td className="px-3 py-2">{r.paramsSummary.concurrency ?? "—"}</td>
                  <td className="px-3 py-2">{r.paramsSummary.duration ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. CompareGrid */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionGrid")}</h2>
        <CompareGrid
          runs={livingRuns.map((r) => r.benchmark!) as Benchmark[]}
          baselineId={baselineId}
        />
      </section>

      {/* 4. Charts */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionCharts")}</h2>
        <StageBarChartsSection runs={livingRuns} />
      </section>

      {/* 5. Analysis */}
      {narrative && narrative.analysis.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionAnalysis")}</h2>
          <div className="space-y-3">
            {narrative.analysis.map((row, i) => (
              <div key={i}>
                <div className="text-sm font-medium">{row.metricLabel}</div>
                <div className="text-sm text-muted-foreground">{row.body}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* 6. Conclusion */}
      {narrative ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionConclusion")}</h2>
          <p>{narrative.conclusion.recommendation}</p>
          {narrative.conclusion.caveats.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
              {narrative.conclusion.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* 7. Test environment */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("savedCompare.report.sectionEnv")}</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {environmentLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        {context ? (
          <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-sm">
            {context}
          </div>
        ) : null}
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm -F @modeldoctor/web test -- StageBarChartsSection.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/StageBarChartsSection.tsx apps/web/src/features/benchmarks/compare/StageBarChartsSection.test.tsx apps/web/src/features/benchmarks/compare/ReportSections.tsx apps/web/src/features/benchmarks/compare/client-metrics.ts
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): ReportSections + chart panels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Frontend — Wire `BenchmarkComparePage` (Save + AI panel + Report)

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`

- [ ] **Step 1: Modify the page**

In `BenchmarkComparePage.tsx`, after `successfulBenchmarks` is computed and the gating alerts pass:

Add imports:

```ts
import { useLlmJudgeProvider } from "@/features/settings/queries";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AiAnalysisPanel } from "./AiAnalysisPanel";
import { ReportSections, type ReportRun } from "./ReportSections";
import { SaveCompareDialog } from "./SaveCompareDialog";
```

Inside the component body, add state and derived helpers:

```ts
const [saveOpen, setSaveOpen] = useState(false);
const provider = useLlmJudgeProvider();
const reportRuns: ReportRun[] = successfulBenchmarks.map((b, i) => ({
  id: b.id,
  stageLabel: b.name ?? `R${i + 1}`,
  tool: b.tool,
  scenario: b.scenario,
  summaryMetrics: b.summaryMetrics,
  benchmark: b,
  paramsSummary: extractParamsSummary(b.params),
}));
const environmentLines = successfulBenchmarks.map(
  (b) => `${b.name ?? b.id} · ${b.tool} · ${b.scenario}`,
);
```

Add a `function extractParamsSummary(params: unknown)` helper at module scope:

```ts
function extractParamsSummary(params: unknown): {
  workload?: string;
  concurrency?: number;
  duration?: number;
} {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    workload: typeof p.workload === "string" ? p.workload : undefined,
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
    duration: typeof p.duration === "number" ? p.duration : undefined,
  };
}
```

Where the page renders `<CompareGrid />`, **replace** that block (lines around the existing `<CompareGrid runs={successfulBenchmarks} baselineId={defaultBaseline} />`) with:

```tsx
<>
  <CompareToolbar
    runs={successfulBenchmarks.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
    baselineId={defaultBaseline}
    onBaselineChange={handleBaselineChange}
  />
  <div className="flex items-center justify-between">
    <Button variant="outline" asChild>
      <Link to="/benchmarks/compare/saved">{t("savedCompare.savedListLink")}</Link>
    </Button>
    <Button onClick={() => setSaveOpen(true)}>{t("savedCompare.saveButton")}</Button>
  </div>
  <ReportSections
    runs={reportRuns}
    baselineId={defaultBaseline}
    narrative={null}
    context={null}
    environmentLines={environmentLines}
  />
  <AiAnalysisPanel
    narrative={null}
    onGenerate={() => setSaveOpen(true)}
    canGenerate={!!provider.data?.enabled}
    isGenerating={false}
  />
  <SaveCompareDialog
    open={saveOpen}
    onOpenChange={setSaveOpen}
    runs={successfulBenchmarks.map((r) => ({ id: r.id, name: r.name, tool: r.tool }))}
    baselineId={defaultBaseline}
    context=""
  />
</>
```

(The page-level `<CompareGrid />` becomes redundant — `ReportSections` renders it. Remove the old `<CompareGrid runs={successfulBenchmarks} baselineId={defaultBaseline} />` line.)

In ad-hoc Compare mode, AI generation is gated through Save: clicking "Generate AI" routes the user to the Save dialog first (we need a SavedCompare row to persist the narrative against). That's why `onGenerate` opens the dialog.

- [ ] **Step 2: Update the existing test**

Open `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx` and ensure it still passes. If a test asserted "exactly one CompareGrid", relax it — the new `ReportSections` also embeds it. Run the test:

Run: `pnpm -F @modeldoctor/web test -- BenchmarkComparePage.test`
Expected: PASS (with any necessary `getAllByRole` adjustments).

- [ ] **Step 3: Smoke check the dev server**

Run: `pnpm dev` (background). Open `http://localhost:5173/benchmarks/inference`, pick 2 runs → Compare → confirm Save button + report sections render. Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/compare): Save button + ReportSections inline on Compare page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Frontend — `SavedCompareDetailPage` + route + delete

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx`
- Create: `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.test.tsx`
- Modify: `apps/web/src/router/index.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SavedCompareDetailPage } from "./SavedCompareDetailPage";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (path.startsWith("/api/saved-compares/")) {
        return {
          id: "sc1",
          userId: "u",
          name: "Study A",
          benchmarkIds: ["b1", "b2"],
          stageLabels: { b1: "A", b2: "B" },
          baselineId: "b1",
          context: "8x NPU",
          narrative: null,
          narrativeAt: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
          benchmarks: [
            {
              id: "b1",
              stageLabel: "A",
              missing: false,
              name: "r1",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 100, p90: 200, p99: 500 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
            {
              id: "b2",
              stageLabel: "B",
              missing: false,
              name: "r2",
              tool: "guidellm",
              scenario: "inference",
              params: {},
              summaryMetrics: { tool: "guidellm", data: { ttft: { p50: 80, p90: 160, p99: 400 } } },
              createdAt: "2026-05-12T00:00:00.000Z",
            },
          ],
        };
      }
      if (path === "/api/llm-judge-providers/active") {
        return { id: "p", enabled: true };
      }
      throw new Error("unmocked: " + path);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("SavedCompareDetailPage", () => {
  it("renders the report once data loads", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/benchmarks/compare/saved/sc1"]}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route
              path="/benchmarks/compare/saved/:id"
              element={<SavedCompareDetailPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());
    expect(screen.getByText(/8x NPU/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the page**

Create `apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLlmJudgeProvider } from "@/features/settings/queries";
import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { AiAnalysisPanel } from "./AiAnalysisPanel";
import { ReportSections, type ReportRun } from "./ReportSections";
import { exportPageAsHtml } from "./exportHtml";
import {
  useDeleteSavedCompare,
  useSavedCompare,
  useSynthesizeSavedCompare,
} from "./queries";

function extractParamsSummary(params: unknown): {
  workload?: string;
  concurrency?: number;
  duration?: number;
} {
  if (!params || typeof params !== "object") return {};
  const p = params as Record<string, unknown>;
  return {
    workload: typeof p.workload === "string" ? p.workload : undefined,
    concurrency: typeof p.concurrency === "number" ? p.concurrency : undefined,
    duration: typeof p.duration === "number" ? p.duration : undefined,
  };
}

export function SavedCompareDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation("benchmarks");
  const { t: tSidebar } = useTranslation("sidebar");
  const navigate = useNavigate();
  const query = useSavedCompare(id);
  const provider = useLlmJudgeProvider();
  const synth = useSynthesizeSavedCompare(id);
  const del = useDeleteSavedCompare();
  const [narrativeOverride, setNarrativeOverride] = useState<CompareNarrative | null>(null);

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="m-8 h-64 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }
  if (!query.data) return null;
  const sc = query.data;

  const reportRuns: ReportRun[] = sc.benchmarks.map((b) => ({
    id: b.id,
    stageLabel: b.stageLabel,
    tool: b.tool ?? "",
    scenario: b.scenario ?? "",
    summaryMetrics: b.summaryMetrics,
    benchmark: b.missing
      ? null
      : ({
          id: b.id,
          name: b.name ?? null,
          tool: b.tool!,
          scenario: b.scenario!,
          summaryMetrics: b.summaryMetrics,
          params: b.params,
        } as Benchmark),
    paramsSummary: extractParamsSummary(b.params),
  }));
  const environmentLines = sc.benchmarks.map(
    (b) =>
      `[${b.stageLabel}] ${b.missing ? t("savedCompare.detail.missingBenchmark") : `${b.name ?? b.id} · ${b.tool} · ${b.scenario}`}`,
  );
  const narrative = narrativeOverride ?? (sc.narrative as CompareNarrative | null);

  async function generate() {
    const r = await synth.mutateAsync({ locale: "zh-CN" });
    setNarrativeOverride(r.narrative);
  }

  async function onDelete() {
    await del.mutateAsync(id);
    navigate("/benchmarks/compare/saved");
  }

  function onExport() {
    const root = document.querySelector("[data-report-root]") as HTMLElement | null;
    if (root) void exportPageAsHtml(root, sc.name);
  }

  const breadcrumbs = [
    { label: tSidebar("groups.benchmarks") },
    { label: t("compare.title"), to: "/benchmarks/compare/saved" },
    { label: sc.name },
  ];

  return (
    <>
      <PageHeader
        title={sc.name}
        breadcrumbs={breadcrumbs}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onExport}>
              {t("savedCompare.detail.export")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">{t("compare.delete", { defaultValue: "Delete" })}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("savedCompare.detail.deleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("savedCompare.detail.deleteBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("savedCompare.dialog.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>
                    {t("savedCompare.detail.deleteTitle")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />
      <div className="space-y-6 px-8 py-6">
        <ReportSections
          runs={reportRuns}
          baselineId={sc.baselineId}
          narrative={narrative}
          context={sc.context}
          environmentLines={environmentLines}
        />
        <AiAnalysisPanel
          narrative={narrative}
          onGenerate={() => void generate()}
          canGenerate={!!provider.data?.enabled}
          isGenerating={synth.isPending}
          errorMessage={synth.error?.message}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Add the route**

Edit `apps/web/src/router/index.tsx`. Find the existing line:

```ts
{ path: "benchmarks/compare", element: <BenchmarkCompareGate /> },
```

Add after it:

```ts
{ path: "benchmarks/compare/saved", element: <SavedComparesListPage /> },
{ path: "benchmarks/compare/saved/:id", element: <SavedCompareDetailPage /> },
```

Add the corresponding imports at the top of the file:

```ts
import { SavedComparesListPage } from "@/features/benchmarks/compare/SavedComparesListPage";
import { SavedCompareDetailPage } from "@/features/benchmarks/compare/SavedCompareDetailPage";
```

(`SavedComparesListPage` lands in Task 17 — typecheck will fail until then. That's expected; we resolve before moving on.)

- [ ] **Step 4: Run unit test**

Run: `pnpm -F @modeldoctor/web test -- SavedCompareDetailPage.test`
Expected: PASS.

- [ ] **Step 5: Defer commit until Task 17 lands**

Stage the files but do not commit yet — typecheck will fail because `SavedComparesListPage` is referenced in router but doesn't exist:

```bash
git add apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.tsx apps/web/src/features/benchmarks/compare/SavedCompareDetailPage.test.tsx apps/web/src/router/index.tsx
```

(We'll commit at the end of Task 17.)

---

## Task 17: Frontend — `SavedComparesListPage`

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/SavedComparesListPage.tsx`
- Create: `apps/web/src/features/benchmarks/compare/SavedComparesListPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/SavedComparesListPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SavedComparesListPage } from "./SavedComparesListPage";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => ({
      items: [
        {
          id: "sc1",
          userId: "u",
          name: "Study A",
          benchmarkIds: ["a", "b"],
          stageLabels: {},
          baselineId: null,
          context: null,
          narrative: null,
          narrativeAt: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
    })),
    delete: vi.fn(),
  },
}));

describe("SavedComparesListPage", () => {
  it("renders saved compares with run count", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <SavedComparesListPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/web/src/features/benchmarks/compare/SavedComparesListPage.tsx`:

```tsx
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useDeleteSavedCompare, useSavedCompares } from "./queries";

export function SavedComparesListPage() {
  const { t } = useTranslation("benchmarks");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useSavedCompares();
  const del = useDeleteSavedCompare();

  if (isLoading) {
    return (
      <>
        <PageHeader title={t("savedCompare.list.title")} />
        <div className="m-8 h-32 animate-pulse rounded-md border border-border bg-muted/30" />
      </>
    );
  }

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader title={t("savedCompare.list.title")} />
      <div className="px-8 py-6">
        {items.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("savedCompare.list.empty")} />
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("savedCompare.list.columnName")}</TableHead>
                  <TableHead className="w-20 text-right">{t("savedCompare.list.columnRuns")}</TableHead>
                  <TableHead className="w-48">{t("savedCompare.list.columnCreated")}</TableHead>
                  <TableHead className="w-32 text-right">{t("savedCompare.list.columnActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link className="text-primary hover:underline" to={`/benchmarks/compare/saved/${item.id}`}>
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.benchmarkIds.length}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/benchmarks/compare/saved/${item.id}`}>
                          {tCommon("actions.detail", { defaultValue: "详情" })}
                        </Link>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {tCommon("actions.delete", { defaultValue: "删除" })}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("savedCompare.detail.deleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("savedCompare.detail.deleteBody")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("savedCompare.dialog.cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => del.mutate(item.id)}>
                              {t("savedCompare.detail.deleteTitle")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
```

(Per memory `feedback_list_page_actions_pattern.md`: first column is a `<Link>` to detail; trailing actions column has 详情 + 删除 with AlertDialog.)

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm -F @modeldoctor/web test -- SavedComparesListPage.test`
Run: `pnpm -F @modeldoctor/web typecheck`
Expected: both PASS.

- [ ] **Step 4: Commit Task 16 + 17 together**

```bash
git add apps/web/src/features/benchmarks/compare/SavedComparesListPage.tsx apps/web/src/features/benchmarks/compare/SavedComparesListPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): list + detail pages + routes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Frontend — `exportPageAsHtml` utility

**Files:**
- Create: `apps/web/src/features/benchmarks/compare/exportHtml.ts`
- Create: `apps/web/src/features/benchmarks/compare/exportHtml.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/benchmarks/compare/exportHtml.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildExportHtml } from "./exportHtml";

describe("buildExportHtml", () => {
  it("wraps cloned node in a full HTML document with inline styles", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h1>Report</h1><p>Body</p>";
    const html = buildExportHtml(root, "my-report", "body { font-family: sans-serif; }");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>my-report</title>");
    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain("font-family: sans-serif");
  });

  it("escapes the title", () => {
    const root = document.createElement("div");
    const html = buildExportHtml(root, "evil <script>", "");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm -F @modeldoctor/web test -- exportHtml.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/benchmarks/compare/exportHtml.ts`:

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectStylesheets(): string {
  const parts: string[] = [];
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sheet = document.styleSheets[i];
    try {
      // Throws on cross-origin sheets; we only care about same-origin Tailwind.
      const rules = sheet.cssRules;
      for (let j = 0; j < rules.length; j++) {
        parts.push(rules[j].cssText);
      }
    } catch {
      // skip cross-origin
    }
  }
  return parts.join("\n");
}

export function buildExportHtml(root: HTMLElement, title: string, css: string): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // Strip interactive controls — static document, no React.
  clone.querySelectorAll("button").forEach((btn) => {
    const span = document.createElement("span");
    span.innerHTML = btn.innerHTML;
    span.className = btn.className;
    btn.replaceWith(span);
  });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body class="bg-background text-foreground">${clone.outerHTML}</body>
</html>`;
}

export async function exportPageAsHtml(root: HTMLElement, name: string): Promise<void> {
  const css = collectStylesheets();
  const html = buildExportHtml(root, name, css);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-zA-Z0-9-_]+/g, "_")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm -F @modeldoctor/web test -- exportHtml.test`
Expected: PASS.

- [ ] **Step 5: Smoke-test the export button**

Run: `pnpm dev`, log in, navigate to a SavedCompare detail page, click "导出 HTML". Open the downloaded file in a fresh browser tab (incognito). Expected: title and charts visible without auth.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/benchmarks/compare/exportHtml.ts apps/web/src/features/benchmarks/compare/exportHtml.test.ts
git commit -m "$(cat <<'EOF'
feat(web/saved-compares): client-side HTML export

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Playwright browser e2e

**Files:**
- Create: `e2e/saved-compares.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `e2e/saved-compares.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { login, seedTwoBenchmarks } from "./helpers";

test("save a compare → detail page loads → has Export button", async ({ page, request }) => {
  await login(page);
  const ids = await seedTwoBenchmarks(request);

  await page.goto(`/benchmarks/compare?ids=${ids.join(",")}`);
  await expect(page.getByRole("button", { name: /保存对比|Save comparison/i })).toBeVisible();

  await page.getByRole("button", { name: /保存对比|Save comparison/i }).click();
  await page.getByPlaceholder(/横评|shootout/).fill("e2e study");

  // Fill stage labels
  const labelInputs = page.locator('input[id^="label-"]');
  await labelInputs.first().fill("A");
  await labelInputs.nth(1).fill("B");

  await page.getByRole("button", { name: /保存并跳转|Save and view/i }).click();
  await expect(page).toHaveURL(/\/benchmarks\/compare\/saved\/[a-z0-9]+/);
  await expect(page.getByRole("heading", { name: "e2e study" })).toBeVisible();
  await expect(page.getByRole("button", { name: /导出 HTML|Export HTML/i })).toBeVisible();
});
```

- [ ] **Step 2: Extend `e2e/helpers.ts`**

If `seedTwoBenchmarks` does not exist in the existing helpers file, add it:

```ts
import type { APIRequestContext } from "@playwright/test";

export async function seedTwoBenchmarks(request: APIRequestContext): Promise<[string, string]> {
  // The auth helper should have already populated cookies / token in `request`.
  const summary = {
    tool: "guidellm",
    data: {
      ttft: { p50: 100, p90: 200, p99: 500 },
      e2eLatency: { p50: 800, p90: 1500, p99: 3000 },
      requestsPerSecond: { mean: 3 },
      requests: { total: 1000, error: 0 },
    },
  };
  const b1 = await request
    .post("/api/benchmarks", {
      data: {
        name: "e2e-r1",
        scenario: "inference",
        tool: "guidellm",
        params: {},
        summaryMetrics: summary,
      },
    })
    .then((r) => r.json());
  const b2 = await request
    .post("/api/benchmarks", {
      data: {
        name: "e2e-r2",
        scenario: "inference",
        tool: "guidellm",
        params: {},
        summaryMetrics: summary,
      },
    })
    .then((r) => r.json());
  return [b1.id, b2.id];
}
```

If the existing API does not allow direct `POST /api/benchmarks` (Benchmark creation is normally async via the driver), seed via Prisma in `helpers.ts` using the existing seed pattern other e2e specs use. Match the surrounding helper style.

- [ ] **Step 3: Run the test**

Run: `pnpm test:e2e:browser -- saved-compares.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/saved-compares.spec.ts e2e/helpers.ts
git commit -m "$(cat <<'EOF'
test(e2e): saved compares end-to-end flow

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **Run the full backend test suite**

Run: `pnpm -F @modeldoctor/api test`
Expected: PASS.

- [ ] **Run the full backend e2e suite**

Run: `pnpm -F @modeldoctor/api test:e2e`
Expected: PASS.

- [ ] **Run the full web test suite**

Run: `pnpm -F @modeldoctor/web test`
Expected: PASS.

- [ ] **Typecheck the whole workspace**

Run: `pnpm -r typecheck`
Expected: PASS.

- [ ] **Lint**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Build**

Run: `pnpm build`
Expected: PASS, `apps/web/dist/` and `apps/api/dist/` written.

- [ ] **Push the branch + open PR**

```bash
git push -u origin feat/saved-compares-ai-report
gh pr create --title "feat: saved compares + AI report" --body "$(cat <<'EOF'
## Summary
- New SavedCompare entity persists Compare-page selections with stage labels + user context
- AI synthesize endpoint generates TL;DR / analysis / recommendation; reuses Insights LRU + LlmJudgeService
- New StageBarChart + 4-chart panel on the report
- Self-contained client-side HTML export

## Spec
docs/superpowers/specs/2026-05-12-saved-compares-ai-report-design.md

## Test plan
- [ ] Compare 2 inference runs → Save dialog opens → submit creates row
- [ ] Detail page shows 7 sections + AI panel
- [ ] Generate AI analysis populates TL;DR / Analysis / Conclusion sections; second click is cached
- [ ] Export HTML downloads a file that opens without auth and shows charts
- [ ] Delete from list page removes the row

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec coverage check (self-review)

Mapping the spec sections to plan tasks:

- **A1 Persistence shape:** Task 1 (Prisma) + Task 5 (Service)
- **A2 AI synthesis pipeline:** Task 4 (metrics) + Task 7 (CompareSynthesizeService) + Task 8 (endpoint)
- **A3 Frontend split:** Task 13 (SaveDialog) + Task 15 (Compare page wiring) + Task 16 (Detail) + Task 17 (List)
- **A4 HTML export:** Task 18
- **A5 StageBarChart:** Task 10
- **Report sections (7 fixed):** Task 14
- **API surface (6 endpoints):** Task 6 (5 CRUD) + Task 8 (synthesize)
- **Edge cases & error handling:** missing benchmark hydration in Task 5; LLM provider gating in Task 12 + Task 16; mixed tool/scenario rejection reuses existing Compare gate.
- **Testing (api spec, e2e, web unit, browser e2e):** Tasks 4, 5, 7, 8, 10, 12, 13, 14, 16, 17, 18, 19.
- **Migration / rollout:** Task 1.
