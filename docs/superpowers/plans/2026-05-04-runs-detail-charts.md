# F3 Run Detail Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chart section to `RunDetailPage` that renders Latency CDF + TTFT Histogram for guidellm Runs, and Latency CDF for vegeta Runs. Server derives the chart data from existing `rawOutput.files.*` blobs via a new `GET /api/runs/:id/charts` endpoint.

**Architecture:** New backend service (`RunChartsService`) re-parses the raw report file stored in `Run.rawOutput.files.*` to extract per-request latency samples + TTFT histogram buckets. New endpoint serves these on demand only for terminal Runs. New FE component (`RunChartsSection`) consumes the endpoint via a react-query hook and reuses the existing `LatencyCDF` and `TTFTHistogram` chart components from `@/components/charts` (originally validated in `/dev/charts` per PR #66).

**Tech Stack:** TypeScript, NestJS + Prisma 6, Zod, vitest@2 (api) + vitest@1 (web), React Query 5, React + Vite, biome, vegeta CLI 12.13.0 (already in runner image).

**Spec:** `docs/superpowers/specs/2026-05-04-runs-detail-charts-design.md`

**Branch:** `feat/runs-detail-charts` (already exists; HEAD is the spec doc, `e4128b2`)

---

## File Structure

### New

- `apps/api/src/modules/run/run-charts.service.ts` — extraction logic + `getCharts` entry point
- `apps/api/src/modules/run/run-charts.service.spec.ts` — unit tests for extraction (guidellm + vegeta + degraded paths)
- `apps/api/src/modules/run/__fixtures__/guidellm-with-requests.json` — small guidellm report fixture WITH per-request array (Task 3 discovery may rename/relocate this file based on what real guidellm emits)
- `apps/api/src/modules/run/__fixtures__/vegeta-attack.ndjson` — small NDJSON fixture (5–10 lines)
- `apps/web/src/features/runs/reports/RunChartsSection.tsx`
- `apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx`

### Modified

- `packages/contracts/src/run.ts` — add `runChartsResponseSchema` + `RunChartsResponse` type + `histogramBucketSchema`
- `packages/tool-adapters/src/vegeta/runtime.ts` — append `vegeta encode -to=json` to cmd; add `latencies: "attack.ndjson"` to outputFiles
- `packages/tool-adapters/src/vegeta/runtime.spec.ts` — assert new outputFile + new cmd suffix
- `apps/api/src/modules/run/run.controller.ts` — add `getCharts` route handler + `Header` import
- `apps/api/src/modules/run/run.module.ts` — register `RunChartsService` as a provider
- `apps/api/src/modules/run/run.controller.spec.ts` — add 4 cases for the new route
- `apps/web/src/features/runs/api.ts` — add `getCharts` client method to `runApi`
- `apps/web/src/features/runs/queries.ts` — add `runKeys.charts` + `useRunCharts` hook
- `apps/web/src/features/runs/RunDetailPage.tsx` — render `<RunChartsSection>` between metrics and raw output
- `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx` — assert `RunChartsSection` mounts when terminal
- `apps/web/src/locales/en-US/runs.json` — `detail.charts.*` keys
- `apps/web/src/locales/zh-CN/runs.json` — `detail.charts.*` keys

---

## Task 0: Worktree bootstrap

This worktree was just created. Per the project memory note `project_worktree_build_first.md`, `apps/api` typecheck cannot run until the workspace packages have been built once — `git worktree add` does not copy `packages/*/dist/`.

**Files:** none modified

- [ ] **Step 0.1: Install dependencies**

```bash
cd /Users/fangyong/vllm/modeldoctor/feat-runs-detail-charts
pnpm install --frozen-lockfile
```

Expected: install completes; no errors.

- [ ] **Step 0.2: Build all workspace packages once**

```bash
pnpm -r build
```

Expected: each `packages/*/dist/` populated; build exits 0.

- [ ] **Step 0.3: Smoke baseline tests pass**

```bash
pnpm -F @modeldoctor/contracts test --run
pnpm -F @modeldoctor/tool-adapters test --run
```

Expected: both green. (Catches a broken pre-existing baseline before we touch anything.)

- [ ] **Step 0.4: Commit nothing — workspace state only**

No git changes here. Move on to Task 1.

---

## Task 1: Add `runChartsResponseSchema` to contracts

Establish the wire format first so both API and Web can import the same type. TDD: spec the schema, then implement.

**Files:**
- Modify: `packages/contracts/src/run.ts`
- Create: `packages/contracts/src/run-charts.spec.ts`

- [ ] **Step 1.1: Write the failing schema spec**

Create `packages/contracts/src/run-charts.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runChartsResponseSchema } from "./run.js";

describe("runChartsResponseSchema", () => {
  it("accepts both fields populated", () => {
    const ok = runChartsResponseSchema.safeParse({
      latencyCdf: { samples: [10, 20, 30] },
      ttftHistogram: {
        buckets: [
          { lower: 0, upper: 10, count: 2 },
          { lower: 10, upper: 20, count: 5 },
        ],
      },
    });
    expect(ok.success).toBe(true);
  });

  it("accepts both fields null (degraded shape)", () => {
    const ok = runChartsResponseSchema.safeParse({
      latencyCdf: null,
      ttftHistogram: null,
    });
    expect(ok.success).toBe(true);
  });

  it("accepts ttftHistogram null while latencyCdf populated (vegeta shape)", () => {
    const ok = runChartsResponseSchema.safeParse({
      latencyCdf: { samples: [1, 2, 3] },
      ttftHistogram: null,
    });
    expect(ok.success).toBe(true);
  });

  it("rejects negative bucket counts", () => {
    const bad = runChartsResponseSchema.safeParse({
      latencyCdf: null,
      ttftHistogram: { buckets: [{ lower: 0, upper: 1, count: -1 }] },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects samples that are not numbers", () => {
    const bad = runChartsResponseSchema.safeParse({
      latencyCdf: { samples: ["10" as unknown as number] },
      ttftHistogram: null,
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/contracts test --run run-charts.spec
```

Expected: FAIL with `runChartsResponseSchema` is not exported from `./run.js`.

- [ ] **Step 1.3: Implement the schema**

Append to `packages/contracts/src/run.ts` (at the very end, after `runFinishCallbackSchema`):

```ts
// ============================================================
// Chart data response (F3 of #88)
// Returned by GET /api/runs/:id/charts. Server derives these from
// rawOutput.files.* on demand; not persisted.
// ============================================================

export const histogramBucketSchema = z.object({
  lower: z.number(),
  upper: z.number(),
  count: z.number().int().nonnegative(),
});
export type HistogramBucket = z.infer<typeof histogramBucketSchema>;

export const runChartsResponseSchema = z.object({
  // Latency samples in milliseconds. Null when the source file is missing,
  // unparseable, or the tool has no per-request latency concept.
  latencyCdf: z.object({ samples: z.array(z.number()) }).nullable(),
  // TTFT bucket counts, equal-width bins in milliseconds. Null for tools
  // without a TTFT concept (vegeta) or when extraction fails.
  ttftHistogram: z.object({ buckets: z.array(histogramBucketSchema) }).nullable(),
});
export type RunChartsResponse = z.infer<typeof runChartsResponseSchema>;
```

- [ ] **Step 1.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/contracts test --run run-charts.spec
```

Expected: PASS — 5 cases.

- [ ] **Step 1.5: Rebuild contracts so downstream packages see the new type**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: `packages/contracts/dist/run.{js,d.ts}` updated.

- [ ] **Step 1.6: Commit**

```bash
git add packages/contracts/src/run.ts packages/contracts/src/run-charts.spec.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add runChartsResponseSchema for F3 (refs #88)

Wire-shape for GET /api/runs/:id/charts. Both top-level fields nullable
so each chart degrades independently when its source file is missing or
unparseable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Vegeta runtime — emit `attack.ndjson` for new Runs

One-line shell change so future vegeta Runs ship per-request latencies as NDJSON. `vegeta encode` is already in the runner image. Old Runs without `attack.ndjson` are out of scope (user confirmed dev DB is disposable).

**Files:**
- Modify: `packages/tool-adapters/src/vegeta/runtime.ts`
- Modify: `packages/tool-adapters/src/vegeta/runtime.spec.ts`

- [ ] **Step 2.1: Write the failing test for new outputFile**

Add to `packages/tool-adapters/src/vegeta/runtime.spec.ts` inside the existing `describe("vegeta.buildCommand")` block (after the existing `"declares output files for report and attack stream"` case):

```ts
  it("declares an attack.ndjson output file for per-request latencies (F3 #88)", () => {
    const r = buildCommand({
      runId: "r1",
      params: { apiType: "chat", rate: 10, duration: 30 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.outputFiles.latencies).toBe("attack.ndjson");
  });

  it("appends 'vegeta encode -to=json' to the shell pipeline (F3 #88)", () => {
    const r = buildCommand({
      runId: "r1",
      params: { apiType: "chat", rate: 10, duration: 30 },
      connection: baseConn,
      callback: { url: "http://api/", token: "tk" },
    });
    expect(r.argv[2]).toContain("vegeta encode -to=json < attack.bin > attack.ndjson");
  });
```

- [ ] **Step 2.2: Run tests, verify failure**

```bash
pnpm -F @modeldoctor/tool-adapters test --run vegeta/runtime.spec
```

Expected: FAIL on the two new cases (`outputFiles.latencies` is undefined; cmd does not contain the new pipeline segment).

- [ ] **Step 2.3: Implement runtime change**

Edit `packages/tool-adapters/src/vegeta/runtime.ts` line 58:

```diff
-  const cmd = `cat targets.txt | vegeta attack -rate=${params.rate} -duration=${params.duration}s | tee attack.bin | vegeta report > report.txt`;
+  const cmd = `cat targets.txt | vegeta attack -rate=${params.rate} -duration=${params.duration}s | tee attack.bin | vegeta report > report.txt && vegeta encode -to=json < attack.bin > attack.ndjson`;
```

And edit the `outputFiles` object at lines 68-71:

```diff
     outputFiles: {
       report: "report.txt",
       attack: "attack.bin",
+      latencies: "attack.ndjson",
     },
```

- [ ] **Step 2.4: Run tests, verify pass**

```bash
pnpm -F @modeldoctor/tool-adapters test --run vegeta/runtime.spec
```

Expected: PASS — all existing cases + the 2 new ones.

- [ ] **Step 2.5: Rebuild tool-adapters**

```bash
pnpm -F @modeldoctor/tool-adapters build
```

Expected: `packages/tool-adapters/dist/vegeta/runtime.{js,d.ts}` updated.

- [ ] **Step 2.6: Commit**

```bash
git add packages/tool-adapters/src/vegeta/runtime.ts packages/tool-adapters/src/vegeta/runtime.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters/vegeta): emit attack.ndjson for per-request latencies (refs #88)

Adds 'vegeta encode -to=json < attack.bin > attack.ndjson' to the runner
shell pipeline so the API can derive a Latency CDF from per-request
samples. Used by the F3 charts endpoint (next commits). vegeta CLI is
already in the runner image; no Dockerfile change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `RunChartsService` — extraction logic

Pure-function service that takes a Run row and returns `RunChartsResponse`. No HTTP, no DB writes. TDD with handwritten fixtures so the test runs in isolation.

**Discovery note (read before Step 3.1):** The guidellm `report.json` per-request structure is *believed* to be `benchmarks[0].requests[] = { request_latency: <seconds>, time_to_first_token_ms: <ms>, ... }`, but the existing fixture `apps/benchmark-runner/tests/fixtures/guidellm_report.json` only has aggregate metrics and does not exercise this path. Before writing the service test, run a real small guidellm against a local OpenAI-compatible endpoint (or a stub), inspect `report.json`, and confirm the path. If the actual key is different, **report the deviation** and update the fixture + extraction code together — do not silently rewrite this plan.

**Files:**
- Create: `apps/api/src/modules/run/run-charts.service.ts`
- Create: `apps/api/src/modules/run/run-charts.service.spec.ts`
- Create: `apps/api/src/modules/run/__fixtures__/guidellm-with-requests.json`
- Create: `apps/api/src/modules/run/__fixtures__/vegeta-attack.ndjson`

- [ ] **Step 3.1: Discovery — confirm guidellm per-request shape**

If a recent dev guidellm Run is in the local DB, dump its `rawOutput.files.report` and inspect:

```bash
psql modeldoctor -t -c "SELECT raw_output->'files'->>'report' FROM runs WHERE tool='guidellm' AND status='completed' ORDER BY completed_at DESC LIMIT 1" | base64 -d | jq '.benchmarks[0] | keys, (.requests // .request_results // .successful_requests // null) | type, length' 2>/dev/null | head -40
```

Otherwise spin up a fast 30-request guidellm against `http://localhost:8000/v1` (any OpenAI-compatible mock) and re-run the inspection. Note the key name + per-element shape. If the guess (`benchmarks[0].requests[]` with `request_latency` in seconds + `time_to_first_token_ms` in ms) is wrong, fix it before Step 3.2 and proceed; document the actual path in a code comment in the service file.

- [ ] **Step 3.2: Create the vegeta NDJSON fixture**

Create `apps/api/src/modules/run/__fixtures__/vegeta-attack.ndjson`:

```jsonl
{"attack":"","seq":0,"code":200,"timestamp":"2026-05-04T00:00:00Z","latency":12000000,"bytes_out":50,"bytes_in":120,"error":"","body":""}
{"attack":"","seq":1,"code":200,"timestamp":"2026-05-04T00:00:00.1Z","latency":15000000,"bytes_out":50,"bytes_in":120,"error":"","body":""}
{"attack":"","seq":2,"code":200,"timestamp":"2026-05-04T00:00:00.2Z","latency":18500000,"bytes_out":50,"bytes_in":120,"error":"","body":""}
{"attack":"","seq":3,"code":500,"timestamp":"2026-05-04T00:00:00.3Z","latency":42000000,"bytes_out":50,"bytes_in":80,"error":"500","body":""}
{"attack":"","seq":4,"code":200,"timestamp":"2026-05-04T00:00:00.4Z","latency":11000000,"bytes_out":50,"bytes_in":120,"error":"","body":""}
```

The `latency` field is **nanoseconds** (vegeta's native unit). Conversion to ms = `÷1_000_000`. The 5 latencies above are: 12, 15, 18.5, 42, 11 ms.

- [ ] **Step 3.3: Create the guidellm fixture**

Create `apps/api/src/modules/run/__fixtures__/guidellm-with-requests.json` based on the actual shape confirmed in Step 3.1. As a baseline (adjust if Step 3.1 reveals different key names):

```json
{
  "benchmarks": [
    {
      "metrics": {
        "request_totals": { "successful": 5, "errored": 0, "incomplete": 0, "total": 5 }
      },
      "requests": [
        { "request_latency": 0.012, "time_to_first_token_ms": 100 },
        { "request_latency": 0.015, "time_to_first_token_ms": 110 },
        { "request_latency": 0.018, "time_to_first_token_ms": 120 },
        { "request_latency": 0.020, "time_to_first_token_ms": 130 },
        { "request_latency": 0.025, "time_to_first_token_ms": 200 }
      ]
    }
  ]
}
```

Latencies in seconds: 0.012, 0.015, 0.018, 0.020, 0.025 → ms: 12, 15, 18, 20, 25. TTFTs in ms: 100, 110, 120, 130, 200.

- [ ] **Step 3.4: Write the failing service spec**

Create `apps/api/src/modules/run/run-charts.service.spec.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunChartsService } from "./run-charts.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readFixtureBase64(rel: string): string {
  return fs.readFileSync(path.join(__dirname, "__fixtures__", rel)).toString("base64");
}

const guidellmFile = readFixtureBase64("guidellm-with-requests.json");
const vegetaFile = readFixtureBase64("vegeta-attack.ndjson");

function makeRow(tool: string, files: Record<string, string> | null) {
  return {
    id: "r1",
    tool,
    status: "completed",
    rawOutput: files ? { stdout: "", stderr: "", files } : null,
  } as const;
}

describe("RunChartsService", () => {
  const svc = new RunChartsService();

  describe("guidellm", () => {
    it("extracts CDF samples in milliseconds + 30-bucket TTFT histogram", () => {
      const result = svc.extract(makeRow("guidellm", { report: guidellmFile }));
      expect(result.latencyCdf?.samples).toEqual([12, 15, 18, 20, 25]);
      expect(result.ttftHistogram?.buckets).toHaveLength(30);
      const totalCount = result.ttftHistogram?.buckets.reduce((s, b) => s + b.count, 0) ?? 0;
      expect(totalCount).toBe(5);
      // Buckets should span min..max of TTFT samples (100..200)
      const first = result.ttftHistogram!.buckets[0];
      const last = result.ttftHistogram!.buckets[29];
      expect(first.lower).toBeCloseTo(100, 5);
      expect(last.upper).toBeCloseTo(200, 5);
    });

    it("returns both nulls when report file is absent", () => {
      const result = svc.extract(makeRow("guidellm", {}));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });

    it("returns both nulls when report JSON is malformed", () => {
      const bad = Buffer.from("{not json", "utf8").toString("base64");
      const result = svc.extract(makeRow("guidellm", { report: bad }));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("vegeta", () => {
    it("extracts CDF samples in milliseconds (ns ÷ 1e6) and null histogram", () => {
      const result = svc.extract(makeRow("vegeta", { latencies: vegetaFile }));
      expect(result.latencyCdf?.samples).toEqual([12, 15, 18.5, 42, 11]);
      expect(result.ttftHistogram).toBeNull();
    });

    it("skips lines that are not valid JSON without throwing", () => {
      const mixed = Buffer.from(
        '{"latency":1000000}\nNOT JSON\n{"latency":2000000}\n',
        "utf8",
      ).toString("base64");
      const result = svc.extract(makeRow("vegeta", { latencies: mixed }));
      expect(result.latencyCdf?.samples).toEqual([1, 2]);
    });

    it("returns null latencyCdf when attack.ndjson is absent (old Run)", () => {
      const result = svc.extract(makeRow("vegeta", {}));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("unknown tool / null rawOutput", () => {
    it("returns both nulls for unknown tool", () => {
      const result = svc.extract(makeRow("e2e", { report: guidellmFile }));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });

    it("returns both nulls when rawOutput is null", () => {
      const result = svc.extract(makeRow("guidellm", null));
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });

  describe("non-terminal Run", () => {
    it("returns both nulls when status is not terminal", () => {
      const row = { ...makeRow("guidellm", { report: guidellmFile }), status: "running" };
      const result = svc.extract(row);
      expect(result.latencyCdf).toBeNull();
      expect(result.ttftHistogram).toBeNull();
    });
  });
});
```

- [ ] **Step 3.5: Run test, verify failure**

```bash
pnpm -F @modeldoctor/api test --run run-charts.service.spec
```

Expected: FAIL — `RunChartsService` not found.

- [ ] **Step 3.6: Implement the service**

Create `apps/api/src/modules/run/run-charts.service.ts`:

```ts
import type { HistogramBucket, RunChartsResponse } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";

const HISTOGRAM_BIN_COUNT = 30;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);

interface ExtractInput {
  id: string;
  tool: string;
  status: string;
  rawOutput: { files?: Record<string, string> } | null;
}

@Injectable()
export class RunChartsService {
  private readonly log = new Logger(RunChartsService.name);

  /**
   * Pure derivation: takes a Run row, returns chart data. Errors in any one
   * extraction step degrade that field to null; the other field is unaffected.
   * No DB or HTTP side-effects.
   */
  extract(row: ExtractInput): RunChartsResponse {
    const empty: RunChartsResponse = { latencyCdf: null, ttftHistogram: null };

    if (!TERMINAL_STATES.has(row.status)) return empty;
    const files = row.rawOutput?.files;
    if (!files) return empty;

    if (row.tool === "guidellm") return this.extractGuidellm(row.id, files);
    if (row.tool === "vegeta") return this.extractVegeta(row.id, files);
    return empty;
  }

  private extractGuidellm(runId: string, files: Record<string, string>): RunChartsResponse {
    const reportB64 = files.report;
    if (!reportB64) return { latencyCdf: null, ttftHistogram: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(reportB64, "base64").toString("utf8"));
    } catch (e) {
      this.log.warn(`run ${runId}: guidellm report parse failed: ${(e as Error).message}`);
      return { latencyCdf: null, ttftHistogram: null };
    }

    // Path: benchmarks[0].requests[] (verified in Task 3 Step 3.1; if guidellm
    // ever changes this, update here and the fixture together).
    const root = parsed as Record<string, unknown>;
    const benches = root.benchmarks as Array<Record<string, unknown>> | undefined;
    const first = benches?.[0];
    const requests = first?.requests as Array<Record<string, unknown>> | undefined;

    if (!requests || requests.length === 0) {
      return { latencyCdf: null, ttftHistogram: null };
    }

    // request_latency in seconds → ms; time_to_first_token_ms is already ms.
    // Filter out nullish values (failed requests may omit them).
    const latencyMs = requests
      .map((r) => Number(r.request_latency))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((sec) => sec * 1000);

    const ttftMs = requests
      .map((r) => Number(r.time_to_first_token_ms))
      .filter((n) => Number.isFinite(n) && n >= 0);

    return {
      latencyCdf: latencyMs.length > 0 ? { samples: latencyMs } : null,
      ttftHistogram: ttftMs.length > 0 ? { buckets: bucketize(ttftMs, HISTOGRAM_BIN_COUNT) } : null,
    };
  }

  private extractVegeta(runId: string, files: Record<string, string>): RunChartsResponse {
    const ndjsonB64 = files.latencies;
    if (!ndjsonB64) return { latencyCdf: null, ttftHistogram: null };

    const text = Buffer.from(ndjsonB64, "base64").toString("utf8");
    const samplesMs: number[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { latency?: number };
        if (typeof obj.latency === "number" && obj.latency >= 0) {
          samplesMs.push(obj.latency / 1_000_000);
        }
      } catch {
        // Skip individual malformed lines silently — vegeta encode rarely
        // produces partial lines, but if it does we want the rest.
      }
    }

    if (samplesMs.length === 0) {
      this.log.warn(`run ${runId}: vegeta NDJSON yielded zero samples`);
      return { latencyCdf: null, ttftHistogram: null };
    }

    return { latencyCdf: { samples: samplesMs }, ttftHistogram: null };
  }
}

/**
 * Equal-width binning. Returns exactly `binCount` buckets spanning min..max,
 * with last bucket inclusive of the max sample.
 */
function bucketize(samples: number[], binCount: number): HistogramBucket[] {
  if (samples.length === 0) return [];
  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    // All samples equal — one non-empty bucket, rest empty
    return Array.from({ length: binCount }, (_, i) => ({
      lower: min,
      upper: max,
      count: i === 0 ? samples.length : 0,
    }));
  }
  const width = (max - min) / binCount;
  const buckets: HistogramBucket[] = Array.from({ length: binCount }, (_, i) => ({
    lower: min + i * width,
    upper: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of samples) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1; // include max in last bucket
    buckets[idx].count += 1;
  }
  return buckets;
}
```

- [ ] **Step 3.7: Run test, verify pass**

```bash
pnpm -F @modeldoctor/api test --run run-charts.service.spec
```

Expected: PASS — all 9 cases.

- [ ] **Step 3.8: Commit**

```bash
git add apps/api/src/modules/run/run-charts.service.ts \
        apps/api/src/modules/run/run-charts.service.spec.ts \
        apps/api/src/modules/run/__fixtures__/guidellm-with-requests.json \
        apps/api/src/modules/run/__fixtures__/vegeta-attack.ndjson
git commit -m "$(cat <<'EOF'
feat(api/run): RunChartsService for F3 chart extraction (refs #88)

Pure-function service that derives Latency CDF samples + TTFT
histogram buckets from rawOutput.files for guidellm and vegeta. Each
field degrades to null independently on parse failure or missing file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `GET /api/runs/:id/charts` route

Add the controller route + module provider + Cache-Control header. Reuses the existing `RunService.findByIdOrFail` for ownership + 404.

**Files:**
- Modify: `apps/api/src/modules/run/run.controller.ts`
- Modify: `apps/api/src/modules/run/run.module.ts`
- Modify: `apps/api/src/modules/run/run.controller.spec.ts`

- [ ] **Step 4.1: Write failing controller spec cases**

Open `apps/api/src/modules/run/run.controller.spec.ts`. After the existing `describe("RunController", ...)` block, add (still inside the file, at the bottom):

```ts
describe("RunController.getCharts (F3 #88)", () => {
  let controller: RunController;
  let prisma: PrismaService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [RunController],
      providers: [
        RunService,
        RunRepository,
        RunChartsService,
        PrismaService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === "DATABASE_URL") return process.env.DATABASE_URL;
              return ENV_DEFAULTS[key];
            },
          },
        },
        { provide: RUN_DRIVER, useValue: mockDriver },
        { provide: ConnectionService, useValue: mockConnections },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(RunController);
    prisma = moduleRef.get(PrismaService);

    await prisma.baseline.deleteMany();
    await prisma.run.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it("returns 200 with both nulls when Run has no rawOutput.files", async () => {
    const user = await prisma.user.create({
      data: { email: "f3@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "completed",
      },
    });
    const result = await controller.getCharts({ sub: user.id, roles: [] }, run.id);
    expect(result).toEqual({ latencyCdf: null, ttftHistogram: null });
  });

  it("returns 200 with extracted samples for a vegeta Run with attack.ndjson", async () => {
    const user = await prisma.user.create({
      data: { email: "f3v@example.com", passwordHash: "x" },
    });
    const ndjson = '{"latency":5000000}\n{"latency":10000000}\n';
    const run = await prisma.run.create({
      data: {
        userId: user.id,
        kind: "benchmark",
        tool: "vegeta",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "completed",
        rawOutput: {
          stdout: "",
          stderr: "",
          files: { latencies: Buffer.from(ndjson).toString("base64") },
        },
      },
    });
    const result = await controller.getCharts({ sub: user.id, roles: [] }, run.id);
    expect(result.latencyCdf?.samples).toEqual([5, 10]);
    expect(result.ttftHistogram).toBeNull();
  });

  it("404s when the Run belongs to a different user", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@example.com", passwordHash: "x" },
    });
    const other = await prisma.user.create({
      data: { email: "other@example.com", passwordHash: "x" },
    });
    const run = await prisma.run.create({
      data: {
        userId: owner.id,
        kind: "benchmark",
        tool: "guidellm",
        scenario: {},
        mode: "fixed",
        driverKind: "local",
        params: {},
        status: "completed",
      },
    });
    await expect(controller.getCharts({ sub: other.id, roles: [] }, run.id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("404s when Run does not exist", async () => {
    const user = await prisma.user.create({
      data: { email: "f3404@example.com", passwordHash: "x" },
    });
    await expect(
      controller.getCharts({ sub: user.id, roles: [] }, "nonexistent-id"),
    ).rejects.toThrow(/not found/i);
  });
});
```

Add `RunChartsService` to the imports at the top of the file:

```diff
 import { RunController } from "./run.controller.js";
+import { RunChartsService } from "./run-charts.service.js";
 import { RunRepository } from "./run.repository.js";
 import { RunService } from "./run.service.js";
```

Also add `afterAll` to the existing vitest import at the top if it's not already there:

```diff
-import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
+import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
```

(no-op if already present — this import statement was already shown above).

- [ ] **Step 4.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/api test --run run.controller.spec
```

Expected: FAIL — `controller.getCharts` is not a function.

- [ ] **Step 4.3a: Patch the EXISTING `describe("RunController")` providers**

Because Step 4.3b adds `RunChartsService` to `RunController`'s constructor, the existing test's TestingModule must also provide it — otherwise NestJS will fail to instantiate the controller and every existing test will throw at `moduleRef.get(RunController)`.

Edit `apps/api/src/modules/run/run.controller.spec.ts` — inside the EXISTING `describe("RunController", ...)` block's `beforeEach`, add `RunChartsService` to the providers array:

```diff
       providers: [
         RunService,
         RunRepository,
+        RunChartsService,
         PrismaService,
         {
           provide: ConfigService,
```

(Same edit at the equivalent spot inside the new `describe("RunController.getCharts (F3 #88)")` block already includes `RunChartsService` per Step 4.1 — no further change there.)

- [ ] **Step 4.3b: Add the route handler**

Edit `apps/api/src/modules/run/run.controller.ts`:

1. Update imports (lines 1-25):

```diff
 import {
   type CreateRunRequest,
   type ListRunsQuery,
   type ListRunsResponse,
   type Run,
+  type RunChartsResponse,
   createRunRequestSchema,
   listRunsQuerySchema,
 } from "@modeldoctor/contracts";
 import {
   Body,
   Controller,
   Delete,
   ForbiddenException,
   Get,
+  Header,
   HttpCode,
   Param,
   Post,
   Query,
   UseGuards,
 } from "@nestjs/common";
 import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
 import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
 import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
 import type { JwtPayload } from "../auth/jwt.strategy.js";
+import { RunChartsService } from "./run-charts.service.js";
 import { RunService } from "./run.service.js";
```

2. Add `RunChartsService` to the constructor:

```diff
 export class RunController {
-  constructor(private readonly service: RunService) {}
+  constructor(
+    private readonly service: RunService,
+    private readonly charts: RunChartsService,
+  ) {}
```

3. Add the new route handler after the `delete` method (after line 68, inside the class body):

```ts
  @Get(":id/charts")
  @Header("Cache-Control", "private, max-age=86400, immutable")
  async getCharts(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ): Promise<RunChartsResponse> {
    // findByIdOrFail enforces ownership + throws 404 on missing.
    const run = await this.service.findByIdOrFail(
      id,
      user.roles.includes("admin") ? undefined : user.sub,
    );
    return this.charts.extract({
      id: run.id,
      tool: run.tool,
      status: run.status,
      rawOutput: run.rawOutput as { files?: Record<string, string> } | null,
    });
  }
```

- [ ] **Step 4.4: Register the service in the module**

Edit `apps/api/src/modules/run/run.module.ts`:

```diff
 import { RunController } from "./run.controller.js";
+import { RunChartsService } from "./run-charts.service.js";
 import { RunRepository } from "./run.repository.js";
 import { RunService } from "./run.service.js";
 import { SseHub } from "./sse/sse-hub.service.js";

 @Module({
   imports: [ConfigModule, ConnectionModule],
   controllers: [RunController, RunCallbackController],
   providers: [
     PrismaService,
     RunRepository,
     RunService,
+    RunChartsService,
     SseHub,
     {
       provide: RUN_DRIVER,
       inject: [ConfigService],
       useFactory: (config: ConfigService<Env, true>) => createRunDriver(config),
     },
   ],
-  exports: [RunRepository, RunService, SseHub],
+  exports: [RunRepository, RunService, RunChartsService, SseHub],
 })
 export class RunModule {}
```

- [ ] **Step 4.5: Run test, verify pass**

```bash
pnpm -F @modeldoctor/api test --run run.controller.spec
```

Expected: PASS — both the existing block and the new `RunController.getCharts` block green.

- [ ] **Step 4.6: Type-check the API package**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: clean.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/src/modules/run/run.controller.ts \
        apps/api/src/modules/run/run.module.ts \
        apps/api/src/modules/run/run.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(api/run): GET /api/runs/:id/charts endpoint (refs #88)

Wires RunChartsService through the controller behind the existing
JwtAuthGuard + per-user ownership check. Cache-Control: private +
immutable since terminal-Run data does not change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: FE — `runApi.getCharts` + `useRunCharts` hook

Wire the client + react-query hook. No UI yet.

**Files:**
- Modify: `apps/web/src/features/runs/api.ts`
- Modify: `apps/web/src/features/runs/queries.ts`

- [ ] **Step 5.1: Add the API client method**

Edit `apps/web/src/features/runs/api.ts`:

```diff
 import { api } from "@/lib/api-client";
 import type {
   CreateRunRequest,
   ListRunsQuery,
   ListRunsResponse,
   Run,
+  RunChartsResponse,
 } from "@modeldoctor/contracts";

 // ... buildListQuery unchanged ...

 export const runApi = {
   list: (q: Partial<ListRunsQuery>) => api.get<ListRunsResponse>(`/api/runs${buildListQuery(q)}`),
   get: (id: string) => api.get<Run>(`/api/runs/${id}`),
   create: (body: CreateRunRequest) => api.post<Run>("/api/runs", body),
   cancel: (id: string) => api.post<Run>(`/api/runs/${id}/cancel`, {}),
   delete: (id: string) => api.del<void>(`/api/runs/${id}`),
+  getCharts: (id: string) => api.get<RunChartsResponse>(`/api/runs/${id}/charts`),
 };
```

- [ ] **Step 5.2: Add `runKeys.charts` and `useRunCharts` hook**

Edit `apps/web/src/features/runs/queries.ts`:

```diff
 export const runKeys = {
   all: ["runs"] as const,
   lists: () => [...runKeys.all, "list"] as const,
   list: (q: Partial<ListRunsQuery>) => [...runKeys.lists(), q] as const,
   details: () => [...runKeys.all, "detail"] as const,
   detail: (id: string) => [...runKeys.details(), id] as const,
+  charts: (id: string) => [...runKeys.detail(id), "charts"] as const,
 };
```

Append a new hook at the bottom of the file:

```ts
export function useRunCharts(runId: string) {
  return useQuery({
    queryKey: runKeys.charts(runId),
    queryFn: () => runApi.getCharts(runId),
    enabled: runId.length > 0,
    // Server returns Cache-Control: immutable for terminal Runs. Mirror that
    // here so the cached result is reused across remounts.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 5.3: Type-check the web package**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: clean.

- [ ] **Step 5.4: Commit**

```bash
git add apps/web/src/features/runs/api.ts apps/web/src/features/runs/queries.ts
git commit -m "$(cat <<'EOF'
feat(web/runs): runApi.getCharts + useRunCharts hook (refs #88)

Client + react-query hook for the new GET /api/runs/:id/charts
endpoint. staleTime: Infinity matches the server's immutable
Cache-Control for terminal Runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `RunChartsSection` component

Pure presentation: takes `runId` + `tool`, renders one or two chart cards with loading / empty / error states.

**Files:**
- Create: `apps/web/src/features/runs/reports/RunChartsSection.tsx`
- Create: `apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx`

- [ ] **Step 6.1: Write failing component tests**

Create `apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx`:

```tsx
import type { RunChartsResponse } from "@modeldoctor/contracts";
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

// ECharts uses canvas APIs not present in jsdom; stub the chart components.
vi.mock("@/components/charts", () => ({
  LatencyCDF: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div data-testid="latency-cdf" data-aria={props.ariaLabel} data-series-count={props.series.length} />
  ),
  TTFTHistogram: (props: { ariaLabel?: string; series: unknown[] }) => (
    <div data-testid="ttft-histogram" data-aria={props.ariaLabel} data-series-count={props.series.length} />
  ),
  assignRunColors: () => ({}),
}));

import { api } from "@/lib/api-client";
import { RunChartsSection } from "../RunChartsSection";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("RunChartsSection", () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it("renders both charts for guidellm Run with full data", async () => {
    const data: RunChartsResponse = {
      latencyCdf: { samples: [10, 20, 30] },
      ttftHistogram: {
        buckets: [
          { lower: 0, upper: 10, count: 3 },
          { lower: 10, upper: 20, count: 5 },
        ],
      },
    };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<RunChartsSection runId="r1" tool="guidellm" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId("latency-cdf")).toBeInTheDocument());
    expect(screen.getByTestId("ttft-histogram")).toBeInTheDocument();
  });

  it("renders only LatencyCDF for vegeta Run (no TTFT)", async () => {
    const data: RunChartsResponse = {
      latencyCdf: { samples: [5, 10, 15] },
      ttftHistogram: null,
    };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<RunChartsSection runId="r2" tool="vegeta" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId("latency-cdf")).toBeInTheDocument());
    expect(screen.queryByTestId("ttft-histogram")).not.toBeInTheDocument();
  });

  it("renders empty state when latencyCdf is null and tool has no other chart", async () => {
    const data: RunChartsResponse = { latencyCdf: null, ttftHistogram: null };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    render(<RunChartsSection runId="r3" tool="vegeta" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No chart data|暂无图表数据/i)).toBeInTheDocument(),
    );
  });

  it("renders error state when the endpoint rejects", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    render(<RunChartsSection runId="r4" tool="guidellm" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load charts|图表加载失败/i),
      ).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 6.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run RunChartsSection
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Add i18n keys**

Edit `apps/web/src/locales/en-US/runs.json` — inside the `"detail"` object (after the `"running"` block, before the closing `}`):

```diff
     "running": {
       "pending": "Waiting to start…",
       "title": "Running…",
       "elapsed": "{{sec}}s elapsed"
-    }
+    },
+    "charts": {
+      "title": "Distributions",
+      "latencyCdfTitle": "Latency CDF",
+      "ttftHistogramTitle": "TTFT Histogram",
+      "empty": "No chart data",
+      "loadError": "Failed to load charts"
+    }
   }
```

Edit `apps/web/src/locales/zh-CN/runs.json` — same shape (find the matching `running` block):

```diff
     "running": {
       "pending": "等待开始…",
       "title": "运行中…",
       "elapsed": "已运行 {{sec}}s"
-    }
+    },
+    "charts": {
+      "title": "分布图",
+      "latencyCdfTitle": "延迟分布 (CDF)",
+      "ttftHistogramTitle": "首 token 延迟分布",
+      "empty": "暂无图表数据",
+      "loadError": "图表加载失败"
+    }
   }
```

(Confirm the zh-CN `"running"` keys are exactly `pending` / `title` / `elapsed` first — if they differ, just add the `charts` block at the same nesting level after whatever block currently ends `detail`.)

- [ ] **Step 6.4: Implement the component**

Create `apps/web/src/features/runs/reports/RunChartsSection.tsx`:

```tsx
import { LatencyCDF, TTFTHistogram } from "@/components/charts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";
import { useRunCharts } from "../queries";

export interface RunChartsSectionProps {
  runId: string;
  tool: string;
}

export function RunChartsSection({ runId, tool }: RunChartsSectionProps) {
  const { t } = useTranslation("runs");
  const { data, isLoading, isError } = useRunCharts(runId);

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("detail.charts.loadError")}</AlertDescription>
      </Alert>
    );
  }

  const hasCdf = (data?.latencyCdf?.samples?.length ?? 0) > 0;
  const hasHistogram = (data?.ttftHistogram?.buckets?.length ?? 0) > 0;

  if (!isLoading && !hasCdf && !hasHistogram) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("detail.charts.empty")}
      </div>
    );
  }

  // vegeta has no TTFT — single chart spans full width on lg.
  const cdfClass = hasHistogram ? "" : "lg:col-span-2";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className={`rounded-md border border-border bg-card p-3 ${cdfClass}`.trim()}>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {t("detail.charts.latencyCdfTitle")}
        </div>
        <LatencyCDF
          ariaLabel={`${tool} latency CDF`}
          loading={isLoading}
          series={
            data?.latencyCdf
              ? [{ runId, runLabel: tool, samples: data.latencyCdf.samples }]
              : []
          }
        />
      </div>
      {hasHistogram && (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("detail.charts.ttftHistogramTitle")}
          </div>
          <TTFTHistogram
            ariaLabel={`${tool} TTFT histogram`}
            loading={isLoading}
            series={
              data?.ttftHistogram
                ? [{ runId, runLabel: tool, buckets: data.ttftHistogram.buckets }]
                : []
            }
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6.5: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run RunChartsSection
```

Expected: PASS — 4 cases.

- [ ] **Step 6.6: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/reports/RunChartsSection.tsx src/features/runs/reports/__tests__/RunChartsSection.test.tsx
```

Expected: both clean. If biome complains about formatting, run `biome check --write` on those files.

- [ ] **Step 6.7: Commit**

```bash
git add apps/web/src/features/runs/reports/RunChartsSection.tsx \
        apps/web/src/features/runs/reports/__tests__/RunChartsSection.test.tsx \
        apps/web/src/locales/en-US/runs.json \
        apps/web/src/locales/zh-CN/runs.json
git commit -m "$(cat <<'EOF'
feat(web/runs): RunChartsSection component for F3 (refs #88)

Pure-presentation component over useRunCharts. Renders LatencyCDF
(both tools) + TTFTHistogram (guidellm only). vegeta layout collapses
the single chart to full width on lg via col-span-2. i18n keys added
for both locales.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire `RunChartsSection` into `RunDetailPage`

Insert the new section between the existing metrics section and the raw-output section. Update the page test to assert it mounts.

**Files:**
- Modify: `apps/web/src/features/runs/RunDetailPage.tsx`
- Modify: `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx`

- [ ] **Step 7.1: Write the failing page test**

Add to `apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx`, inside the existing `describe("RunDetailPage", ...)` block (after the GenaiPerf case at the bottom):

```tsx
  it("mounts RunChartsSection when status is terminal", async () => {
    // First call: GET /api/runs/:id (run detail). Second: GET /api/runs/:id/charts.
    vi.mocked(api.get)
      .mockResolvedValueOnce(makeRun({ status: "completed" }))
      .mockResolvedValueOnce({
        latencyCdf: { samples: [10, 20] },
        ttftHistogram: { buckets: [{ lower: 0, upper: 10, count: 2 }] },
      });
    render(<RunDetailPage />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Distributions|分布图/i)).toBeInTheDocument(),
    );
  });

  it("does NOT mount RunChartsSection when status is non-terminal", async () => {
    vi.mocked(api.get).mockResolvedValueOnce(makeRun({ status: "running" }));
    render(<RunDetailPage />, { wrapper: Wrapper });
    await screen.findByText(/Running…|运行中…/i);
    expect(screen.queryByText(/Distributions|分布图/i)).not.toBeInTheDocument();
  });
```

- [ ] **Step 7.2: Run test, verify failure**

```bash
pnpm -F @modeldoctor/web test --run RunDetailPage
```

Expected: FAIL — `Distributions|分布图` text not found.

- [ ] **Step 7.3: Wire the section into the page**

Edit `apps/web/src/features/runs/RunDetailPage.tsx`:

1. Add the import (alongside the other report-view imports near line 37-40):

```diff
 import { GenaiPerfReportView } from "./reports/GenaiPerfReportView";
 import { GuidellmReportView } from "./reports/GuidellmReportView";
+import { RunChartsSection } from "./reports/RunChartsSection";
 import { UnknownReportView } from "./reports/UnknownReportView";
 import { VegetaReportView } from "./reports/VegetaReportView";
```

2. Insert the new section between metrics and raw-output (around line 224-234 — the existing `isTerminal` branch):

```diff
         {isTerminal ? (
           <>
             <section>
               <h3 className="mb-3 text-sm font-semibold">{t("detail.metrics.title")}</h3>
               <ReportSection metrics={run.summaryMetrics} />
             </section>
+            <section>
+              <h3 className="mb-3 text-sm font-semibold">{t("detail.charts.title")}</h3>
+              <RunChartsSection runId={run.id} tool={run.tool} />
+            </section>
             <section>
               <RunDetailRawOutput
                 rawOutput={run.rawOutput as Record<string, unknown> | null}
                 logs={run.logs}
               />
             </section>
           </>
         ) : (
           <RunningSection run={run} />
         )}
```

- [ ] **Step 7.4: Run test, verify pass**

```bash
pnpm -F @modeldoctor/web test --run RunDetailPage
```

Expected: PASS — both new cases + all existing cases. If the existing `"renders metadata, metrics, raw output toggle"` case starts failing because `api.get` is now consumed twice on the terminal path, switch its `mockResolvedValueOnce` to two `mockResolvedValueOnce` calls (the second returning `{ latencyCdf: null, ttftHistogram: null }`).

- [ ] **Step 7.5: Run the full web test suite**

```bash
pnpm -F @modeldoctor/web test --run
```

Expected: all green. Fix any cascading failures in the same way (any other RunDetailPage-mounting test that now needs a second `api.get` mock for the charts endpoint).

- [ ] **Step 7.6: Type-check + biome**

```bash
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web exec biome check src/features/runs/RunDetailPage.tsx src/features/runs/__tests__/RunDetailPage.test.tsx
```

Expected: both clean.

- [ ] **Step 7.7: Commit**

```bash
git add apps/web/src/features/runs/RunDetailPage.tsx \
        apps/web/src/features/runs/__tests__/RunDetailPage.test.tsx
git commit -m "$(cat <<'EOF'
feat(web/runs): mount RunChartsSection on detail page (refs #88, closes F3)

RunDetailPage renders the new section between summary metrics and raw
output, only when the Run is in a terminal state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual smoke + repo-wide green

End-to-end check against a real Run.

**Files:** none modified

- [ ] **Step 8.1: Repo-wide build + tests**

```bash
pnpm -r build
pnpm -r test --run
```

Expected: all green across contracts / tool-adapters / api / web.

- [ ] **Step 8.2: Start dev stack**

In one terminal:

```bash
pnpm -F @modeldoctor/api dev
```

In another:

```bash
pnpm -F @modeldoctor/web dev
```

- [ ] **Step 8.3: Trigger a fresh vegeta Run**

In the web UI: New Benchmark → tool: `vegeta` → connection: any local OpenAI-compatible target (e.g. `http://localhost:8000`) → rate `10`, duration `5` → submit.

Wait for status to flip to `completed`. Open the run detail page.

**Verify:**
- "Distributions" / "分布图" section appears
- LatencyCDF chart renders with a smooth curve, single series labeled with `vegeta`
- No TTFT chart
- DevTools Network → `/api/runs/<id>/charts` request returns 200 with `Cache-Control: private, max-age=86400, immutable`

- [ ] **Step 8.4: Trigger a fresh guidellm Run**

Same flow, tool: `guidellm`, profile: `throughput`, dataset: `random` (input/output token counts: 50/50), totalRequests: `30`, maxConcurrency: `5`. Submit. Wait for completion.

**Verify:**
- Both charts render
- LatencyCDF curve has the right value range (e.g. tens to hundreds of ms — sanity check, not exact match)
- TTFTHistogram has 30 bars; non-zero buckets cluster around the actual median TTFT
- Reload the page → Network tab shows `/charts` served from disk cache (304 or "from cache")

If the guidellm chart endpoint returns `{latencyCdf: null, ttftHistogram: null}` despite a successful Run, the per-request structure assumption from Step 3.1 was wrong → inspect the actual `report.json` and adjust `extractGuidellm` + the fixture together. Report the deviation; do not silently rewrite the plan.

- [ ] **Step 8.5: Final lint + format check**

```bash
pnpm exec biome check apps/api/src/modules/run apps/web/src/features/runs packages/contracts/src packages/tool-adapters/src/vegeta
```

Expected: clean.

- [ ] **Step 8.6: Push the branch**

```bash
git push -u origin feat/runs-detail-charts
```

- [ ] **Step 8.7: Open PR**

```bash
gh pr create --title "feat(runs): F3 detail-page chart section (vegeta + guidellm)" --body "$(cat <<'EOF'
## Summary

Closes the **F3** item in #88 — adds a `Distributions` section to `RunDetailPage` that renders Latency CDF + TTFT Histogram for guidellm Runs and Latency CDF for vegeta Runs. Server derives the chart data from the existing `rawOutput.files.*` blobs via a new `GET /api/runs/:id/charts` endpoint; no DB schema change.

genai-perf charts intentionally deferred per scope decision on 2026-05-04 (will revisit in a follow-up if needed).

## Per-tool data path

| Tool | Source file | What we extract |
|---|---|---|
| guidellm | `rawOutput.files.report` (base64 JSON) | `benchmarks[0].requests[].request_latency` (s→ms) for CDF; `time_to_first_token_ms` for 30-bucket histogram |
| vegeta | `rawOutput.files.latencies` (base64 NDJSON) — newly emitted by runner | per-line `latency` (ns→ms) for CDF |

vegeta runtime now appends `vegeta encode -to=json < attack.bin > attack.ndjson` to its shell pipeline. `vegeta` CLI is already in the runner image; no Dockerfile change.

## Test plan

- [x] `RunChartsService` unit tests: 9 cases (guidellm happy/missing/malformed, vegeta happy/mixed-lines/missing, unknown tool, null rawOutput, non-terminal Run)
- [x] Controller integration: 4 cases (200 with nulls, 200 with vegeta data, 404 cross-user, 404 missing Run)
- [x] FE component: 4 cases (guidellm both charts, vegeta CDF only, empty state, error state)
- [x] FE page wiring: 2 cases (mounts when terminal, hidden when running)
- [x] vegeta runtime: 2 cases (new outputFile, new cmd suffix)
- [x] Manual: fresh vegeta Run + fresh guidellm Run, both charts render with realistic shapes; Cache-Control header confirmed in DevTools

## Issue trailer

Uses `addresses #88` (per the umbrella-issue trailer policy added after PR #89 auto-closed #88 via `closes`). After merge I'll tick the F3 checkbox in the #88 body.

addresses #88

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8.8: PR follow-through**

Per `CLAUDE.md` — verify signals before declaring done:

```bash
gh pr view <N> --json comments,reviews,statusCheckRollup,mergeStateStatus
gh pr checks <N>
```

Surface reviewer feedback / red checks back to the user. Only declare "PR open and green" once both commands return clean signals.

---

## What's NOT in this plan (deferred)

- **F1** (multi-Run overlay) — separate spec
- **F2** (diff badges) — separate spec
- **genai-perf charts** — separate spec (cut from F3 scope on 2026-05-04)
- Old-Run backfill — disposable dev DB; not worth the engineering
- Configurable bin count / strategy — fixed 30 equal-width is intentional
