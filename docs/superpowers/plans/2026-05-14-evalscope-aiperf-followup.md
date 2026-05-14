# Evalscope + AIPerf Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every deferred / non-blocking item from PR #183. Bake all external datasets into runner images for air-gapped production; refactor metric readers so future tool additions can't silently miss a runtime switch; finish the user-facing surface (1 aiperf template + full report i18n); polish small leftovers.

**Architecture:** 4 phases, 15 bite-sized tasks. Phase 1 (image baking) is the user's highest priority — production has no internet egress. Phase 2 (exhaustiveness refactor) is the architectural fix for the class drift that caused 6 metric readers to silently miss new tools in PR #183. Phase 3 fills user-facing gaps. Phase 4 is polish.

**Tech stack:** unchanged from PR #183 — pnpm workspaces, Vitest 2, NestJS, Prisma, shadcn/ui, react-i18next, modelscope (evalscope), HuggingFace (aiperf).

---

## Phase 1 · Air-gapped image readiness

### Task 1 · Bake evalscope `openqa` dataset

**Files:**
- Modify: `apps/benchmark-runner/images/evalscope.Dockerfile`
- Modify: `packages/tool-adapters/src/evalscope/runtime.ts`
- Modify: `packages/tool-adapters/src/evalscope/runtime.spec.ts`

**Context:** evalscope's `openqa` plugin (see `evalscope/perf/plugin/datasets/openqa.py`) calls `dataset_snapshot_download('AI-ModelScope/HC3-Chinese', allow_patterns=['open_qa.jsonl'])` at runtime. Air-gapped clusters fail because modelscope hub is unreachable. The plugin honors `--dataset-path` when set — it skips the download entirely. So the fix is two-pronged: (a) bake the JSONL into the image, (b) make the adapter pass `--dataset-path` for `openqa` like it does for `longalpaca`.

- [ ] **Step 1 · Add openqa bake step to evalscope.Dockerfile**

After the existing LongAlpaca RUN, add:

```dockerfile
# Bake openqa (HC3-Chinese) for the inf-evalscope-short template + any
# openqa-driven manual runs. Only the open_qa.jsonl file is needed
# (a few MB), not the rest of HC3-Chinese.
RUN python -c "from modelscope import dataset_snapshot_download; \
    p = dataset_snapshot_download('AI-ModelScope/HC3-Chinese', allow_patterns=['open_qa.jsonl']); \
    import shutil; shutil.move(p, '/opt/evalscope-datasets/openqa-src'); \
    import os; \
    os.makedirs('/opt/evalscope-datasets/openqa', exist_ok=True); \
    shutil.copy('/opt/evalscope-datasets/openqa-src/open_qa.jsonl', '/opt/evalscope-datasets/openqa/open_qa.jsonl'); \
    shutil.rmtree('/opt/evalscope-datasets/openqa-src')"
```

This produces `/opt/evalscope-datasets/openqa/open_qa.jsonl` regardless of modelscope's internal sharded cache layout.

- [ ] **Step 2 · Update BAKED_DATASET_PATHS in adapter runtime**

In `packages/tool-adapters/src/evalscope/runtime.ts`, change `BAKED_DATASET_PATHS` from:

```ts
const BAKED_DATASET_PATHS: Record<string, string> = {
  longalpaca: "/opt/evalscope-datasets/longalpaca",
};
```

to:

```ts
const BAKED_DATASET_PATHS: Record<string, string> = {
  longalpaca: "/opt/evalscope-datasets/longalpaca",
  openqa: "/opt/evalscope-datasets/openqa/open_qa.jsonl",
};
```

(longalpaca's plugin auto-discovers JSONL files in the directory; openqa's plugin reads a single file, so pass the file path directly. Verify by reading the openqa plugin's `dataset_line_by_line` invocation; it accepts either path.)

- [ ] **Step 3 · Add a runtime.spec.ts test**

Open `packages/tool-adapters/src/evalscope/runtime.spec.ts`. Find the existing longalpaca test. Add a parallel one:

```ts
it("passes --dataset-path for openqa", () => {
  const result = adapter.buildCommand({
    runId: "r1",
    params: { ...defaults, dataset: "openqa" },
    connection: testConn,
    callback: testCb,
  });
  expect(result.argv).toContain("--dataset-path");
  expect(result.argv).toContain("/opt/evalscope-datasets/openqa/open_qa.jsonl");
});

it("does not pass --dataset-path for random (synthetic dataset)", () => {
  const result = adapter.buildCommand({
    runId: "r1",
    params: { ...defaults, dataset: "random" },
    connection: testConn,
    callback: testCb,
  });
  expect(result.argv).not.toContain("--dataset-path");
});
```

- [ ] **Step 4 · Run + verify**

```bash
pnpm -F @modeldoctor/tool-adapters test --run src/evalscope/runtime.spec.ts
```

Expected: existing 14 + 2 new tests all PASS.

- [ ] **Step 5 · Commit**

```bash
git add packages/tool-adapters/src/evalscope/runtime.ts \
        packages/tool-adapters/src/evalscope/runtime.spec.ts \
        apps/benchmark-runner/images/evalscope.Dockerfile
git commit -m "$(cat <<'EOF'
feat(runner): bake openqa dataset into evalscope image for air-gap

evalscope's openqa plugin calls dataset_snapshot_download at runtime,
unreachable on air-gapped clusters. Bake AI-ModelScope/HC3-Chinese's
open_qa.jsonl into /opt/evalscope-datasets/openqa/ and pass that path
via --dataset-path so the plugin skips its download attempt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2 · Bake aiperf `ShareGPT` dataset

**Files:**
- Modify: `apps/benchmark-runner/images/aiperf.Dockerfile`

**Context:** aiperf's `ShareGPTLoader` (see `aiperf/dataset/loader/sharegpt.py`) downloads `https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json` (~672 MB) to `.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json`. The path is relative (pathlib `Path(".cache/aiperf/datasets")`) — resolved from the container's CWD. The image's WORKDIR is `/app`, so the cache resolves to `/app/.cache/aiperf/datasets/`. Pre-populate that exact location.

- [ ] **Step 1 · Add ShareGPT bake step**

Insert before the `USER runner` line:

```dockerfile
# Bake ShareGPT V3 (~672 MB). aiperf's ShareGPTLoader resolves
# `.cache/aiperf/datasets/<filename>` relative to WORKDIR (/app), so
# pre-populate that exact path. Image size: ~1 GB → ~1.7 GB.
RUN mkdir -p /app/.cache/aiperf/datasets \
    && curl -fL --output /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json \
        https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json
```

Then update the chown to include the cache:

```dockerfile
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
```

The existing `chown -R runner:runner /app` already covers `/app/.cache/`, so no edit needed there — but verify after the move.

- [ ] **Step 2 · Verify integrity hint**

Add a comment noting the file size as a build-time sanity check (curl doesn't fail loudly if the response is shorter than expected unless `-f` is set, which it is):

```dockerfile
# Sanity: file should be ~640 MiB; build will surface curl errors with -f.
```

Optional: add a `RUN test "$(stat -c%s /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json)" -gt 600000000` step. Skip if it complicates layer caching.

- [ ] **Step 3 · Document the bake choice**

Add a header comment to the Dockerfile noting the trade-off:

```dockerfile
# Bakes ShareGPT V3 corpus (~672 MB) to make sharegpt-driven runs
# work on air-gapped clusters. Image goes from ~1 GB to ~1.7 GB.
# Synthetic-only deployments can use a slimmer variant by skipping
# the bake step (not currently published).
```

- [ ] **Step 4 · No runtime adapter change needed**

aiperf reads from `.cache/aiperf/datasets/` automatically when `--public-dataset sharegpt` is set; the cache check precedes the HTTP fetch. Verify by reading the `_load_dataset` method in `base_public_dataset.py` if you doubt this.

- [ ] **Step 5 · Commit**

```bash
git add apps/benchmark-runner/images/aiperf.Dockerfile
git commit -m "$(cat <<'EOF'
feat(runner): bake ShareGPT corpus into aiperf image for air-gap

aiperf's ShareGPTLoader downloads ~672 MB from HuggingFace on first
use; unreachable on air-gapped clusters. Pre-populate
/app/.cache/aiperf/datasets/ (aiperf's resolved relative cache path)
with the file so --public-dataset sharegpt works offline. Image goes
from ~1 GB to ~1.7 GB.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3 · Air-gap verification script

**Files:**
- Create: `apps/benchmark-runner/scripts/verify-airgap.sh`

**Context:** Without an automated check, future regressions can sneak in (e.g. someone adds a new dataset enum value, forgets to bake it). Provide a script that runs each Dockerfile with `--network none` and exercises the dataset path.

- [ ] **Step 1 · Write the script**

```bash
#!/usr/bin/env bash
# Verify the evalscope + aiperf runner images can boot and access
# every supported dataset enum value WITHOUT network egress. Run after
# building the images locally (or against pulled :latest images).
#
# Usage:
#   ./apps/benchmark-runner/scripts/verify-airgap.sh
#   IMAGE_EVALSCOPE=md-runner-evalscope:dev ./apps/benchmark-runner/scripts/verify-airgap.sh

set -euo pipefail

EVALSCOPE_IMAGE="${IMAGE_EVALSCOPE:-md-runner-evalscope:dev}"
AIPERF_IMAGE="${IMAGE_AIPERF:-md-runner-aiperf:dev}"

echo "==> evalscope longalpaca bake check"
docker run --rm --network none "$EVALSCOPE_IMAGE" \
  test -f /opt/evalscope-datasets/longalpaca/LongAlpaca-12k.json \
  || (echo "FAIL: longalpaca not baked" && exit 1)

echo "==> evalscope openqa bake check"
docker run --rm --network none "$EVALSCOPE_IMAGE" \
  test -f /opt/evalscope-datasets/openqa/open_qa.jsonl \
  || (echo "FAIL: openqa not baked" && exit 1)

echo "==> aiperf ShareGPT bake check"
docker run --rm --network none "$AIPERF_IMAGE" \
  test -f /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json \
  || (echo "FAIL: ShareGPT not baked" && exit 1)

echo "==> all baked datasets present; air-gapped runs supported"
```

(The exact LongAlpaca filename inside `/opt/evalscope-datasets/longalpaca/` may differ — adjust the `test -f` path after a local build. If modelscope's download produces a directory structure rather than a single JSON, switch to `test -d` and a non-empty directory check.)

- [ ] **Step 2 · Make executable + smoke test locally**

```bash
chmod +x apps/benchmark-runner/scripts/verify-airgap.sh
./tools/build-runner-images.sh --no-import
IMAGE_EVALSCOPE=md-runner-evalscope:<tag> IMAGE_AIPERF=md-runner-aiperf:<tag> \
  ./apps/benchmark-runner/scripts/verify-airgap.sh
```

If verification fails, fix the bake step in Task 1 or 2 before continuing.

- [ ] **Step 3 · Commit**

```bash
git add apps/benchmark-runner/scripts/verify-airgap.sh
git commit -m "$(cat <<'EOF'
build(runner): add air-gapped dataset verification script

Confirms every dataset enum value supported by evalscope + aiperf has
its source file present in the runner image, run with --network none.
Catches future regressions where someone adds a new dataset enum
value but forgets to bake it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4 · Document air-gapped operator workflow

**Files:**
- Modify: `apps/benchmark-runner/README.md`

**Context:** The operator deploying to production needs to know which datasets are baked, what's missing, and how to verify before rollout. A small README section is the cheapest place to put this.

- [ ] **Step 1 · Add an "Air-gapped clusters" section**

Find the existing README (it covers `tools/build-runner-images.sh` usage already). Add:

```markdown
## Air-gapped clusters

The evalscope + aiperf images bake their datasets at build time so runs
work without internet egress from the cluster:

| Image | Dataset enum value | Baked path | Source |
|---|---|---|---|
| evalscope | `longalpaca` | `/opt/evalscope-datasets/longalpaca/` | `AI-ModelScope/LongAlpaca-12k` (modelscope) |
| evalscope | `openqa` | `/opt/evalscope-datasets/openqa/open_qa.jsonl` | `AI-ModelScope/HC3-Chinese:open_qa.jsonl` |
| evalscope | `random` | n/a (synthetic) | — |
| aiperf | `sharegpt` | `/app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json` | `anon8231489123/ShareGPT_Vicuna_unfiltered` (HuggingFace) |
| aiperf | `synthetic` | n/a (built-in generator) | — |

After build + before deploy, run `apps/benchmark-runner/scripts/verify-airgap.sh`
to confirm every baked path is reachable with `--network none`.
```

- [ ] **Step 2 · Commit**

```bash
git add apps/benchmark-runner/README.md
git commit -m "$(cat <<'EOF'
docs(runner): document air-gapped dataset baking matrix

Lists every dataset enum value supported by evalscope and aiperf, its
baked path inside the image, and the upstream source — so the deploying
operator can verify before rollout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 · ToolName exhaustiveness refactor

### Task 5 · Adapter-level metric extractor interface

**Files:**
- Modify: `packages/tool-adapters/src/core/interface.ts`
- Create: `packages/tool-adapters/src/core/metric-extractor.ts`
- Modify: each adapter's `index.ts` to wire the new method

**Context:** Today, `apps/api/src/modules/insights/metrics.ts`, `apps/api/src/modules/saved-compares/metrics.ts`, `apps/api/src/modules/benchmark/metrics.ts`, `apps/web/src/features/benchmarks/compare/metrics.ts`, `apps/web/src/features/benchmarks/compare/client-metrics.ts`, and `apps/web/src/features/insights/checks/*.ts` all `switch (tool)` on the tool name to read the right field path. Adding a new tool means hunting every one of those six files. PR #183 review caught this — multiple files silently dropped genai-perf without adding evalscope/aiperf. Fix the class drift by moving the extraction into adapter responsibility.

- [ ] **Step 1 · Define MetricKind + ToolMetricExtractor**

Create `packages/tool-adapters/src/core/metric-extractor.ts`:

```ts
import type { z } from "zod";

// Standard inference-shape metrics every load-generator tool can expose.
// `null` = the tool doesn't carry this metric (e.g. vegeta has no TTFT).
export type MetricKind =
  | "ttft.p95"
  | "ttft.p99"
  | "itl.p95"
  | "e2e.p95"
  | "e2e.p99"
  | "errorRate"        // 0-1 fraction
  | "requestsPerSec"
  | "outputTokensPerSec"
  | "tailRatio";       // e2e.p99 / e2e.p50

export interface ToolMetricExtractor {
  /**
   * Pull one well-known metric out of the tool's persisted summary.
   * The `data` argument is the `.data` payload from `summaryMetrics`
   * (already discriminated by tool). Implementations return `null`
   * when the tool doesn't carry that metric, when the data is missing,
   * or when the value is non-finite.
   */
  readMetric(kind: MetricKind, data: Record<string, unknown>): number | null;
}
```

- [ ] **Step 2 · Extend ToolAdapter interface**

In `packages/tool-adapters/src/core/interface.ts`, add:

```ts
import type { ToolMetricExtractor } from "./metric-extractor.js";

export interface ToolAdapter extends ToolMetricExtractor {
  // ... existing fields ...
}
```

So every adapter must implement `readMetric`. The compile-time check is now "every Tool in the registry has every MetricKind covered."

- [ ] **Step 3 · Implement readMetric per adapter (5 adapters)**

In each adapter's `index.ts` (`guidellm/index.ts`, `vegeta/index.ts`, `prefix-cache-probe/index.ts`, `evalscope/index.ts`, `aiperf/index.ts`), add a `readMetric` function that returns the right field for each MetricKind based on the tool's report shape.

Example for guidellm:

```ts
function readMetric(kind: MetricKind, data: Record<string, unknown>): number | null {
  const fin = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const dist = (key: string, field: string): number | null => {
    const d = data[key] as Record<string, unknown> | undefined;
    return fin(d?.[field]);
  };
  switch (kind) {
    case "ttft.p95": return dist("ttft", "p95");
    case "ttft.p99": return dist("ttft", "p99");
    case "itl.p95":  return dist("itl", "p95");
    case "e2e.p95":  return dist("e2eLatency", "p95");
    case "e2e.p99":  return dist("e2eLatency", "p99");
    case "errorRate": {
      const r = data.requests as { total?: number; error?: number } | undefined;
      const t = fin(r?.total), e = fin(r?.error);
      return t === null || e === null || t === 0 ? null : e / t;
    }
    case "requestsPerSec": {
      const r = data.requestsPerSecond as { mean?: number } | undefined;
      return fin(r?.mean);
    }
    case "outputTokensPerSec": {
      const r = data.outputTokensPerSecond as { mean?: number } | undefined;
      return fin(r?.mean);
    }
    case "tailRatio": {
      const p50 = dist("e2eLatency", "p50"), p99 = dist("e2eLatency", "p99");
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    default: {
      const _exhaustive: never = kind;
      return null;
    }
  }
}

export const guidellmAdapter: ToolAdapter = { ..., readMetric };
```

For vegeta, most kinds return null except `e2e.p95` (latencies.p95), `errorRate` (1 - success/100), `requestsPerSec` (requests.throughput).

For prefix-cache-probe, all kinds return null.

For evalscope + aiperf: same as the FE compare/metrics.ts shape — `data.ttft|itl|e2eLatency.{p95,p99}`, `data.throughput.requestsPerSec`, etc.

- [ ] **Step 4 · Tests per adapter**

In each adapter's `index.ts.spec.ts` or its companion test, add a `describe("readMetric", () => { ... })` block exercising every MetricKind with the adapter's known fixture data. Total: 5 adapters × 9 MetricKinds = 45 small assertions. Catch field-path bugs at adapter level instead of consumer level.

- [ ] **Step 5 · Run + verify**

```bash
pnpm -F @modeldoctor/tool-adapters test --run
```

Expected: all existing tests + ~45 new assertions all PASS.

- [ ] **Step 6 · Commit**

```bash
git add packages/tool-adapters/src/core/metric-extractor.ts \
        packages/tool-adapters/src/core/interface.ts \
        packages/tool-adapters/src/{guidellm,vegeta,prefix-cache-probe,evalscope,aiperf}/index.ts \
        packages/tool-adapters/src/**/*.spec.ts
git commit -m "$(cat <<'EOF'
feat(tool-adapters): adapter-level readMetric(kind, data) interface

Replaces six runtime switch (tool) blocks scattered across api + web
with a single `adapter.readMetric(kind, data)` lookup. New MetricKind
enum lists every well-known inference metric (ttft.p95, e2e.p99,
errorRate, requestsPerSec, tailRatio, ...). Each of the 5 adapters
implements readMetric with its own field paths.

Compile-time check: adding a new MetricKind without updating an
adapter is a type error (exhaustive switch + `as never`). Consumers
that didn't already cover a new tool when added (the class-drift bug
caught in PR #183 review) is now impossible — there's only one site
to add a tool, not six.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6 · Refactor API metric reader modules

**Files:**
- Modify: `apps/api/src/modules/benchmark/metrics.ts`
- Modify: `apps/api/src/modules/insights/metrics.ts`
- Modify: `apps/api/src/modules/saved-compares/metrics.ts`

**Context:** With Task 5's `adapter.readMetric` in place, the three API modules can replace their `switch (tool)` with a one-liner.

- [ ] **Step 1 · Refactor `benchmark/metrics.ts`**

Replace the body of `readP95LatencyMs`:

```ts
import { byTool, type MetricKind, type ToolName } from "@modeldoctor/tool-adapters";

function readByKind(kind: MetricKind, metrics: Prisma.JsonValue | null): number | null {
  const m = asTagged(metrics);
  if (!m?.data || !m.tool) return null;
  try {
    return byTool(m.tool as ToolName).readMetric(kind, m.data);
  } catch {
    return null;  // unknown tool / parse error → null, not throw
  }
}

export function readP95LatencyMs(metrics: Prisma.JsonValue | null): number | null {
  return readByKind("e2e.p95", metrics);
}
```

(The `try/catch` is defensive: `byTool` throws on unknown tool names. Data could legitimately carry a tool name no longer registered.)

- [ ] **Step 2 · Refactor `insights/metrics.ts`**

Replace each per-metric switch with `readByKind` calls. The existing `extractMetric` function takes a metric id string ("ttft.p95", "e2e.p95", etc.) — map those directly to MetricKind. Drop the per-tool switches entirely.

- [ ] **Step 3 · Refactor `saved-compares/metrics.ts`**

`readP95Latency`, `readErrorRate`, `readThroughput` all become one-liners:

```ts
export const readP95Latency = (m: unknown) => readByKind("e2e.p95", m);
export const readErrorRate = (m: unknown) => readByKind("errorRate", m);
export const readThroughput = (m: unknown) => readByKind("requestsPerSec", m);
```

`summarizeForPrompt` similarly delegates each field to `readByKind`.

- [ ] **Step 4 · Run + verify**

```bash
pnpm -F @modeldoctor/api test --run
pnpm -F @modeldoctor/api type-check
```

Expected: all 647+ tests pass; no regressions.

- [ ] **Step 5 · Commit**

```bash
git add apps/api/src/modules/benchmark/metrics.ts \
        apps/api/src/modules/insights/metrics.ts \
        apps/api/src/modules/saved-compares/metrics.ts
git commit -m "$(cat <<'EOF'
refactor(api): metric readers delegate to adapter.readMetric

Three api modules (benchmark/metrics, insights/metrics, saved-compares/
metrics) had near-identical switch (tool) blocks. Replace each with
`byTool(tool).readMetric(kind, data)` — one source of truth, in the
tool-adapters package.

PR #183's class-drift bug — six switches updated for genai-perf
deletion but only two updated for evalscope+aiperf addition — is now
structurally impossible: adapters own their field paths, consumers
just pick a MetricKind.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7 · Refactor FE compare metric modules

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/metrics.ts`
- Modify: `apps/web/src/features/benchmarks/compare/client-metrics.ts`

**Context:** Same pattern as Task 6 but on the FE side. These two files also `switch (tool)`.

- [ ] **Step 1 · Refactor `compare/metrics.ts`**

Replace each top-level reader (`readP95Latency`, `readErrorRate`, `readThroughput`) with a one-liner that delegates to `byTool(tool).readMetric(kind, data)`. Mirror the API side from Task 6.

The `rowDescriptorsForTool` function should also be refactored: the row descriptors are essentially tuples of `(labelKey, MetricKind, formatHint)`. Build them per-tool by querying the adapter (i.e. each adapter could optionally expose `inferenceRowDescriptors(): MetricRowDescriptor[]`). Defer the deeper refactor to a follow-up if it grows the diff too much — the simpler fix is to keep `rowDescriptorsForTool` as-is but rewrite each row's `read` to use `readByKind`.

- [ ] **Step 2 · Refactor `client-metrics.ts`**

`summarizeForPrompt` is the main affected function. Replace each `tool === "..." ? ... : ...` chain with `readByKind` calls.

- [ ] **Step 3 · Run + verify**

```bash
pnpm -F web test --run apps/web/src/features/benchmarks/compare/
pnpm -F web type-check
```

- [ ] **Step 4 · Commit**

```bash
git add apps/web/src/features/benchmarks/compare/metrics.ts \
        apps/web/src/features/benchmarks/compare/client-metrics.ts \
        apps/web/src/features/benchmarks/compare/__tests__/metrics.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): compare metric readers delegate to adapter.readMetric

Mirrors the api-side refactor from the previous commit. FE compare/
metrics.ts and client-metrics.ts now call byTool(tool).readMetric
instead of carrying their own per-tool switches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8 · Refactor FE insights checks

**Files:**
- Modify: `apps/web/src/features/insights/checks/inference.ts`
- Modify: `apps/web/src/features/insights/checks/capacity.ts`

**Context:** Same pattern. Inference checks (`ttftP95`, `e2eP95`, etc.) each carry their own `toolFilter` + `read` function. Replace `read` with `readByKind`; collapse `toolFilter` to "tools where `readMetric(kind, fixture) !== null` for a sample fixture" (i.e. auto-derive from adapters), OR just keep toolFilter as a hardcoded list of supported-tool names.

The cleaner architecture is to derive `toolFilter` automatically — but that requires a sample fixture per adapter, which complicates this task. Simpler: keep toolFilter manual but replace the read function with a delegate.

- [ ] **Step 1 · Refactor each Check's `read` function**

```ts
{
  id: "ttft.p95",
  toolFilter: ["guidellm", "evalscope", "aiperf"] as ToolName[],
  read: (run) => readByKind("ttft.p95", run.summaryMetrics),
  threshold: 1500,
}
```

`readByKind` is the same helper from Task 6/7 (imported from a shared location, e.g. `apps/web/src/features/benchmarks/compare/metrics.ts` or extracted to a fresh `apps/web/src/features/benchmarks/_shared/metric-reader.ts`).

- [ ] **Step 2 · Run + verify**

```bash
pnpm -F web test --run apps/web/src/features/insights/
pnpm -F web type-check
```

- [ ] **Step 3 · Commit**

```bash
git add apps/web/src/features/insights/checks/inference.ts \
        apps/web/src/features/insights/checks/capacity.ts
git commit -m "$(cat <<'EOF'
refactor(web): insights checks read via adapter.readMetric

Each Check's `read` callback now delegates to readByKind instead of
its own switch (tool). toolFilter stays manual for now (auto-deriving
it requires a sample fixture per adapter — out of scope here).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9 · Extract `<InferenceMetricsGrid>` shared component

**Files:**
- Create: `apps/web/src/features/benchmarks/reports/_shared/InferenceMetricsGrid.tsx`
- Modify: `apps/web/src/features/benchmarks/reports/guidellm/InferenceMetrics.tsx`
- Modify: `apps/web/src/features/benchmarks/reports/evalscope/InferenceMetrics.tsx`
- Modify: `apps/web/src/features/benchmarks/reports/aiperf/InferenceMetrics.tsx`

**Context:** PR #183 created two near-duplicate `InferenceMetrics` files (evalscope, aiperf) that match the existing guidellm style. Each renders the same 5-6 MetricCards (TTFT, ITL, E2E, Throughput, Requests). Now that there are three files with ~80% overlap, the abstraction pays off.

- [ ] **Step 1 · Define a shared report shape**

The three tools agree on the inference metric shape: `ttft / itl / e2eLatency: {mean,p50,p90,p95,p99}`, `throughput: {requestsPerSec, outputTokensPerSec, totalTokensPerSec}` (guidellm uses `requestsPerSecond.mean` instead — adapt), `requests: {total, success, error, errorRate}`. Build a normalizer in the shared component.

```tsx
// apps/web/src/features/benchmarks/reports/_shared/InferenceMetricsGrid.tsx
import { MetricCard } from "../../components/MetricCard";

interface Dist { mean: number; p50: number; p90: number; p95: number; p99: number }
interface Requests { total: number; success: number; error: number; errorRate: number }
interface Throughput { requestsPerSec: number; outputTokensPerSec: number; totalTokensPerSec: number }
interface PrefixCache { hitRate: number }

interface NormalizedInferenceData {
  ttft: Dist;
  itl: Dist;
  e2e: Dist;
  throughput: Throughput;
  requests: Requests;
  prefixCache?: PrefixCache;
}

export function InferenceMetricsGrid({ data }: { data: NormalizedInferenceData }) {
  const fmt = (n: number, d = 1) => n.toFixed(d);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* TTFT MetricCard, ITL MetricCard, E2E MetricCard, Throughput MetricCard,
          Requests MetricCard, conditionally Prefix Cache MetricCard */}
    </div>
  );
}
```

- [ ] **Step 2 · Rewrite the three per-tool files as thin normalizers**

Each becomes ~15 lines:

```tsx
// evalscope/InferenceMetrics.tsx
import type { Benchmark } from "@modeldoctor/contracts";
import { evalscopeReportSchema } from "@modeldoctor/tool-adapters/schemas";
import { InferenceMetricsGrid } from "../_shared/InferenceMetricsGrid";
import { UnknownReport } from "../UnknownReport";

export function EvalscopeInferenceMetrics({ benchmark }: { benchmark: Benchmark }) {
  const tagged = benchmark.summaryMetrics as { data?: unknown } | null;
  const parsed = evalscopeReportSchema.safeParse(tagged?.data);
  if (!parsed.success) return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  const r = parsed.data;
  return (
    <InferenceMetricsGrid
      data={{
        ttft: r.ttft, itl: r.itl, e2e: r.e2eLatency,
        throughput: r.throughput,
        requests: r.requests,
        prefixCache: r.prefixCacheStats,
      }}
    />
  );
}
```

guidellm's normalizer maps `requestsPerSecond.mean → throughput.requestsPerSec` (with `outputTokensPerSec` from `outputTokensPerSecond.mean`, etc.). aiperf has no prefix cache — omit that field.

- [ ] **Step 3 · Run + verify**

```bash
pnpm -F web test --run
pnpm -F web type-check
```

- [ ] **Step 4 · Commit**

```bash
git add apps/web/src/features/benchmarks/reports/_shared/InferenceMetricsGrid.tsx \
        apps/web/src/features/benchmarks/reports/{guidellm,evalscope,aiperf}/InferenceMetrics.tsx
git commit -m "$(cat <<'EOF'
refactor(web): share InferenceMetricsGrid across guidellm/evalscope/aiperf

The three per-tool InferenceMetrics files had ~80% overlap (5
MetricCards each, identical layout). Extract the grid into
_shared/InferenceMetricsGrid.tsx; each per-tool file now just
normalizes its tool's data shape into the grid's NormalizedInferenceData
contract. Evalscope keeps its optional prefix-cache card; aiperf
omits it; guidellm maps requestsPerSecond.mean → throughput.requestsPerSec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 · User-facing completeness

### Task 10 · Add 1 official aiperf template

**Files:**
- Modify: `apps/api/prisma/seed.ts`

**Context:** Tool union has `aiperf` but 0 aiperf official templates. Users can pick aiperf manually but lose the "prefill from template" experience.

- [ ] **Step 1 · Append the template**

After the 2 inference evalscope templates, add:

```ts
{
  id: "tpl_inf_aiperf_baseline",
  name: "AIPerf · 综合基线",
  description:
    "AIPerf 通用基线:concurrency=8, 200 requests, synthetic 输入均值 1024 tokens / 输出均值 256 tokens。一发就有,适合横评。",
  scenario: "inference",
  tool: "aiperf",
  config: {
    concurrency: 8,
    requestCount: 200,
    inputTokensMean: 1024,
    inputTokensStddev: 128,
    outputTokensMean: 256,
    outputTokensStddev: 64,
    endpointType: "chat",
    streaming: true,
    dataset: "synthetic",
    seed: 42,
  },
  tags: ["inference", "aiperf", "baseline", "synthetic"],
},
```

- [ ] **Step 2 · Re-seed dev DB**

```bash
pnpm -F @modeldoctor/api db:seed
psql postgresql://modeldoctor:modeldoctor@localhost:5432/modeldoctor \
  -c "SELECT tool, COUNT(*) FROM benchmark_templates GROUP BY tool ORDER BY tool;"
```

Expected: 9 guidellm + 8 evalscope + 1 aiperf = 18 total.

- [ ] **Step 3 · Run tests**

```bash
pnpm -F @modeldoctor/api test --run
```

- [ ] **Step 4 · Commit**

```bash
git add apps/api/prisma/seed.ts
git commit -m "$(cat <<'EOF'
feat(api): 1 official aiperf inference template

tpl_inf_aiperf_baseline: concurrency=8, 200 requests, synthetic input
mean 1024 / output mean 256 — the obvious AIPerf landing baseline so
users coming from the genai-perf flow have a 1-click template equivalent.

Seed-time validator (touched in #183) now exercises all three tool
schemas (guidellm + evalscope + aiperf) since this is the first aiperf
template to flow through it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11 · Report i18n keys + wire useTranslation

**Files:**
- Modify: `apps/web/src/locales/zh-CN/benchmarks.json`
- Modify: `apps/web/src/locales/en-US/benchmarks.json`
- Modify: `apps/web/src/features/benchmarks/reports/_shared/InferenceMetricsGrid.tsx`
- Modify: `apps/web/src/features/benchmarks/reports/KvCacheStressReport.tsx`

**Context:** PR #183 left report-panel labels inline-English (e.g. `"TTFT (ms)"`, `"Throughput"`, `"Prefix cache"`). Chinese users see English. Form labels (Task 18 of #183) were i18n'd; report labels weren't.

- [ ] **Step 1 · Add i18n keys to both locales**

Add a `reports.shared.*` block (shared across the three inference report renders, since they all use InferenceMetricsGrid now):

```json
"reports": {
  "shared": {
    "ttftMs": "TTFT (ms)",
    "itlMs": "ITL (ms)",
    "e2eLatencyMs": "E2E latency (ms)",
    "throughput": "Throughput",
    "requests": "Requests",
    "prefixCache": "Prefix cache",
    "rps": "RPS",
    "outputTps": "Output TPS",
    "totalTps": "Total TPS",
    "totalLabel": "total",
    "successLabel": "success",
    "errorLabel": "error",
    "errorRateLabel": "error rate",
    "hitRate": "Hit rate"
  },
  "kvCacheStress": {
    "coldVsWarm": "Cold vs Warm",
    "cold": "Cold (R1)",
    "warm": "Warm (R2)",
    "delta": "Δ"
  }
}
```

zh-CN equivalents: `"TTFT (ms)"`, `"逐 token 延迟 (ms)"`, `"端到端延迟 (ms)"`, `"吞吐"`, `"请求"`, `"前缀缓存"`, `"RPS"`, `"输出 TPS"`, `"总 TPS"`, `"总数"`, `"成功"`, `"失败"`, `"错误率"`, `"命中率"`, `"冷态 vs 热态"`, `"冷态 (R1)"`, `"热态 (R2)"`, `"Δ"`.

- [ ] **Step 2 · Wire useTranslation in InferenceMetricsGrid**

```tsx
import { useTranslation } from "react-i18next";

export function InferenceMetricsGrid({ data }: { data: NormalizedInferenceData }) {
  const { t } = useTranslation("benchmarks");
  // ... use t("reports.shared.ttftMs") etc.
}
```

- [ ] **Step 3 · Same for KvCacheStressReport**

The component currently uses inline English. Add `useTranslation("benchmarks")` and replace `"TTFT P95 (ms)"` etc. with `t("reports.shared.ttftMs")`, `"Cold vs Warm"` with `t("reports.kvCacheStress.coldVsWarm")`, etc.

- [ ] **Step 4 · Run i18n parity check + tests**

```bash
cd apps/web && node scripts/check-i18n-parity.mjs
pnpm -F web test --run
pnpm -F web type-check
```

- [ ] **Step 5 · Commit**

```bash
git add apps/web/src/locales/{zh-CN,en-US}/benchmarks.json \
        apps/web/src/features/benchmarks/reports/_shared/InferenceMetricsGrid.tsx \
        apps/web/src/features/benchmarks/reports/KvCacheStressReport.tsx
git commit -m "$(cat <<'EOF'
feat(web): i18n keys for inference + KV-cache report panels

PR #183 left report-panel labels inline-English (TTFT (ms),
Throughput, Prefix cache, Cold vs Warm, etc.). Add reports.shared.*
and reports.kvCacheStress.* keys to zh-CN + en-US; wire useTranslation
in InferenceMetricsGrid + KvCacheStressReport.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 · Polish

### Task 12 · `numberField` form helper

**Files:**
- Create: `apps/web/src/features/benchmarks/forms/_shared/numberField.ts`
- Modify: `apps/web/src/features/benchmarks/forms/EvalscopeParamsForm.tsx`
- Modify: `apps/web/src/features/benchmarks/forms/AiperfParamsForm.tsx`

**Context:** The `value={field.value ?? ""}` + `onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}` pattern repeats ~7 times per form. Extract a helper.

- [ ] **Step 1 · Write the helper**

```ts
// apps/web/src/features/benchmarks/forms/_shared/numberField.ts
import type { ControllerRenderProps } from "react-hook-form";

/** Bind a react-hook-form numeric field with blank→undefined semantics.
 *  Avoids ~14 lines of inline boilerplate across each per-tool form. */
export function numberField<T extends Record<string, unknown>, K extends keyof T>(
  field: ControllerRenderProps<T, K>,
) {
  return {
    value: (field.value as number | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      field.onChange(raw === "" ? undefined : Number(raw));
    },
    onBlur: field.onBlur,
    name: field.name,
    ref: field.ref,
  };
}
```

- [ ] **Step 2 · Apply to EvalscopeParamsForm + AiperfParamsForm**

Replace each numeric `FormField`'s inline `value=...`/`onChange=...` with `<Input type="number" {...numberField(field)} />`.

- [ ] **Step 3 · Verify**

```bash
pnpm -F web test --run apps/web/src/features/benchmarks/forms/
pnpm -F web type-check
```

- [ ] **Step 4 · Commit**

```bash
git add apps/web/src/features/benchmarks/forms/_shared/numberField.ts \
        apps/web/src/features/benchmarks/forms/{Evalscope,Aiperf}ParamsForm.tsx
git commit -m "$(cat <<'EOF'
chore(web): extract numberField() helper for shadcn form integration

Removes ~14 lines of value+onChange boilerplate per numeric field (×7
fields × 2 forms = ~28 collapsed lines). Helper enforces the
blank→undefined contract uniformly so optional fields don't emit NaN.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13 · Clean stale Phase-N comments

**Files:**
- Modify: `apps/benchmark-runner/images/evalscope.Dockerfile`
- Modify: `apps/benchmark-runner/images/aiperf.Dockerfile`

**Context:** Header comments reference "Phase 1 of evalscope rollout" / "Replacement for the deprecated genai-perf image" (which is true historical context but reads oddly now that the migration is complete). Tighten to one sentence focused on what the image IS, not how it came to exist.

- [ ] **Step 1 · Rewrite evalscope.Dockerfile header**

Replace the multi-line "Phase 1 of evalscope rollout. … Image ~1.7 GB" comment with:

```dockerfile
# Modelscope evalscope perf load generator. Bakes LongAlpaca-12k +
# HC3-Chinese open_qa.jsonl at build time so the image runs on
# air-gapped clusters. Image ~1.75 GB.
```

- [ ] **Step 2 · Rewrite aiperf.Dockerfile header**

```dockerfile
# NVIDIA aiperf (ai-dynamo) perf load generator. Bakes ShareGPT V3
# corpus (~672 MB) at build time so --public-dataset sharegpt works
# on air-gapped clusters. Image ~1.7 GB.
```

- [ ] **Step 3 · Commit**

```bash
git add apps/benchmark-runner/images/{evalscope,aiperf}.Dockerfile
git commit -m "$(cat <<'EOF'
chore(runner): trim Dockerfile header comments to current state

Drop "Phase 1 of evalscope rollout" / "Replacement for genai-perf"
prose. Replace with one-sentence statement of what each image IS now
that the migration is merged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14 · `pnpm -r build` cleans dist/

**Files:**
- Modify: `packages/tool-adapters/package.json`
- Modify: `packages/contracts/package.json`

**Context:** `tsc` doesn't delete emit for files that were deleted from the source tree. Result: after Task 19/20 of #183, `packages/tool-adapters/dist/genai-perf/` and `dist/kv-cache-stress/` persisted as stale artifacts that grep would still match. Manual `rm -rf` cleared them, but the next deletion will reintroduce the same drift. Fix it by always cleaning dist before building.

- [ ] **Step 1 · Add rimraf to build scripts**

In `packages/tool-adapters/package.json`'s `scripts.build`:

```json
"build": "rimraf dist && tsc -p tsconfig.build.json",
```

Same in `packages/contracts/package.json` if it has its own dist (check).

- [ ] **Step 2 · Verify `rimraf` is already a dev dep**

```bash
pnpm -F @modeldoctor/tool-adapters list rimraf
```

If absent, add it: `pnpm -F @modeldoctor/tool-adapters add -D rimraf`. (It's probably already in the workspace from another package.)

- [ ] **Step 3 · Verify build still works**

```bash
pnpm -r build
ls packages/tool-adapters/dist/
```

Expected: dist has the current 5 adapter subdirs, no stale ones.

- [ ] **Step 4 · Commit**

```bash
git add packages/tool-adapters/package.json packages/contracts/package.json
git commit -m "$(cat <<'EOF'
chore(packages): clean dist/ before tsc to prevent stale-emit drift

After a file deletion (e.g. removing an adapter), tsc leaves the
previous .d.ts / .js in dist/ until something runs `rimraf`. PR #183
hit this twice (genai-perf and kv-cache-stress dist remnants).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15 · Final verification + PR

**Files:** none (process)

- [ ] **Step 1 · Run the full workspace gate**

```bash
pnpm -r build
pnpm -F @modeldoctor/tool-adapters test --run
pnpm -F @modeldoctor/api test --run
pnpm -F web test --run
pnpm -F @modeldoctor/api type-check
pnpm -F web type-check
pnpm -F @modeldoctor/tool-adapters lint
pnpm -F @modeldoctor/api lint
pnpm -F web lint
cd apps/web && node scripts/check-i18n-parity.mjs
```

All must be green.

- [ ] **Step 2 · Run the air-gap verification (if Docker available)**

```bash
./tools/build-runner-images.sh --no-import
./apps/benchmark-runner/scripts/verify-airgap.sh
```

Expected: all bake checks pass.

- [ ] **Step 3 · Push + open PR**

```bash
git push -u origin feat/evalscope-aiperf-followup
gh pr create --title "feat: evalscope+aiperf followup — air-gap, exhaustiveness refactor, polish" \
  --body "$(cat <<'EOF'
## Summary

Follow-up to PR #183 covering every deferred / non-blocking item from that branch's code review:

- **Air-gap readiness (Tasks 1-4)**: bake every external dataset (LongAlpaca-12k already done in #183; add HC3-Chinese open_qa.jsonl and ShareGPT V3) into the evalscope + aiperf runner images. Add a `verify-airgap.sh` script + README matrix so the deploying operator can validate before rollout.
- **ToolName exhaustiveness refactor (Tasks 5-9)**: replace six runtime `switch (tool)` blocks with a single `adapter.readMetric(kind, data)` interface. Adding a new tool now requires updating exactly one site (the adapter's `index.ts`) — the class drift that caused PR #183's review to find 6 missing branches is structurally impossible.
- **User-facing completeness (Tasks 10-11)**: 1 official aiperf inference template + full i18n for the inference + KV-cache report panels.
- **Polish (Tasks 12-14)**: `numberField()` form helper, stale Dockerfile header comments, `rimraf dist` to prevent stale-emit drift.

## Test plan

- [x] `pnpm -r build` clean
- [x] tool-adapters / api / web test suites all green
- [x] api / web type-check + lint clean
- [x] i18n parity OK
- [x] air-gap verification script passes against locally-built images
- [ ] Manual smoke against dev k3d cluster (operator follow-up — same as #183)

refs #179
🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4 · Watch CI**

Use Monitor (or `gh pr checks <N>` polling) until every check is in a terminal state. Fix any CI-only failures (biome stale cache, missing fixture deps, etc.) before declaring done.

---

## Self-Review Notes

- **Spec coverage:** every loose end from PR #183 (A/B/C categories listed in the conversation) maps to a task above. The "operator follow-up" items (push images / set env vars / smoke against cluster) are not engineer tasks — left for ops.
- **Migration policy:** the data-only Prisma migration from #183 stays (already applied + merged). CLAUDE.md's carve-out is the lasting fix. No follow-up needed here.
- **Three near-duplicate InferenceMetrics files:** addressed in Task 9 by extracting `InferenceMetricsGrid` — refactor justified now that three tools share the shape.
- **Tests:** Tasks 5 (adapter.readMetric tests, ~45 assertions) and 11 (i18n parity) carry most new test surface. Other tasks rely on existing test coverage to catch regressions.
