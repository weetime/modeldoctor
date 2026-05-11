# Saved Compares + AI Report — Design

Status: draft → review
Owner: weetime
Reference artifact: [theriseunion/repots](https://github.com/theriseunion/repots) (private) — long-form Markdown + matplotlib PNG comparison reports

## Goal

Let users persist a Compare-page selection as a named, shareable, AI-narrated report. The Compare page (currently transient — state in URL only) gains a "保存" action and an AI analysis section. Saved entries live at `/benchmarks/compare/saved/:id` and can be exported as a single self-contained `.html` file.

The reference report describes "same workload, N controlled configs, head-to-head" — that is the Compare scenario. This design extends Compare; it does not extend Test Insights (which is per-connection time-window monitoring, a different product).

Success criteria:

- From any Benchmark list, "勾选 N 个 run → Compare → 保存 → 报告自动可分享链接" reachable in under 1 minute.
- AI analysis generated synchronously (5–30s, same envelope as `/api/insights/.../synthesize`) and persisted in `narrative` column.
- "导出 HTML" produces a single `.html` file that opens offline with all charts, tables, AI text intact.

## Non-goals (V1)

- Public sharing (no-auth link). V1 share = "登录后可访问"; URL is otherwise stable.
- PDF export, MD+PNG zip export.
- Cross-tool / cross-scenario comparison (sharing the existing Compare gate; mixed sets are blocked).
- Free-form narrative editor. AI output is regenerable but not hand-editable in V1.
- Auto-regeneration on data change. AI is always manually triggered.
- Team / org visibility. Owner-only, like Benchmark.
- Versioning / history of past `narrative` runs. One `narrative` per `SavedCompare` row, overwritten on regenerate.
- "踩坑记录" / reproduction artifacts as dedicated sections. Users may stuff such notes into the `context` text field.
- Embedded image upload. No attachment table.

## Architecture decisions

### A1. Persistence shape: a single `SavedCompare` table

```prisma
model SavedCompare {
  id            String    @id @default(cuid())
  userId        String    @map("user_id")
  name          String
  benchmarkIds  String[]  @map("benchmark_ids")
  stageLabels   Json      @map("stage_labels")  // { [benchmarkId]: string }
  baselineId    String?   @map("baseline_id")
  context       String?   @db.Text
  narrative     Json?
  narrativeAt   DateTime? @map("narrative_at") @db.Timestamptz(3)
  createdAt     DateTime  @default(now())  @map("created_at") @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt        @map("updated_at") @db.Timestamptz(3)

  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@map("saved_compares")
}
```

Rationale:

- **Reference, do not snapshot, benchmark data.** `benchmarkIds` are foreign keys conceptually (no FK enforced — Postgres array cannot enforce per-element FK). On render, the API joins to `benchmarks` and any deleted run is rendered as a "数据已删除" placeholder column (the rest of the report still loads). This avoids 404s on any deletion and keeps storage minimal; the trade-off is the report changes if the underlying benchmark's `summaryMetrics` is mutated (which today only happens during a `rerun` workflow we don't expect on saved-into-compare runs).
- **`stageLabels` as JSON keyed by benchmarkId.** Same benchmark could (in principle) appear in multiple SavedCompares with different labels, so the label belongs to the SavedCompare, not the Benchmark.
- **No chart-render cache.** Charts always re-derive from current benchmark `summaryMetrics`. Chart code may improve over time; cached SVG would freeze the old rendering.
- **No `narrative` history.** A regenerate overwrites. If the user wants to "lock" a narrative they should use HTML export.

Owner-only RBAC: every controller method filters `userId = req.user.id`. Mirrors `BenchmarkService` pattern.

### A2. AI synthesis: new sibling module that reuses the Insights pipeline

New module at `apps/api/src/modules/saved-compares/`. **Reuses** without modification:

- `LlmJudgeService` (provider config, encryption, model dispatch)
- `LruCache` shape and TTL (24h) from `apps/api/src/modules/insights/cache.ts`
- `chatCompletion` HTTP client from `apps/api/src/modules/insights/llm-client.ts`
- The metric-reader pattern from `apps/web/src/features/benchmarks/compare/metrics.ts` (`readP95Latency`, `readErrorRate`, `readThroughput`) — promoted into a server-side equivalent (or imported as-is if dependency direction permits)

What's new:

- `compare-synthesize.service.ts` — analogous to `SynthesizeService` but with a Compare-shaped prompt
- `prompts.ts` — section-based prompt asking for 3 fields: `tldr`, `analysis`, `conclusion`
- `compare-narrative.schema.ts` — zod validation of LLM JSON

**Prompt input shape** (built server-side, not exposed):

```ts
{
  context: string,                              // user-provided
  runs: Array<{
    stageLabel: string,
    benchmarkName: string,
    tool: string,
    scenario: string,
    paramsSummary: { workload, concurrency, duration, ... },
    summaryMetricsSubset: { ttft, e2eLatency, errorRate, throughput, ... },
  }>,
  baselineDeltas: Array<{
    stageLabel: string,
    metric: string,
    baselineValue: number,
    currentValue: number,
    deltaPct: number,
  }>,
  locale: "zh-CN" | "en-US"
}
```

**Prompt output shape** (zod-validated):

```ts
{
  tldr: Array<{ headline: string; oneLine: string }>,         // 3-5 items
  analysis: Array<{ metricLabel: string; body: string }>,     // one paragraph per significant Δ
  conclusion: { recommendation: string; caveats: string[] }
}
```

Cache key: SHA-256 of `{ savedCompareId, baselineId, stageLabels, context, runsDigest, locale }`, where `runsDigest` is SHA-256 of the JSON `[{ id, summaryMetricsHash }]` array. Including `summaryMetricsHash` (not just IDs) means editing a benchmark's metrics invalidates cache implicitly without needing an explicit bust. Hits return `fromCache: true` (mirroring Insights' contract). Persisting to `narrative` happens whether it was a cache hit or fresh call.

### A3. Frontend split: Compare page extension + Saved-Compare detail page

Two routes, one shared rendering core:

- `/benchmarks/compare?ids=...&baseline=...` — **existing**. Adds:
  - "AI 分析" panel (collapsed by default; "生成"按钮 → 内联出 narrative; same loading/error UX as `AiDiagnosisCard`)
  - "保存" 按钮 → 打开 dialog: name + per-run stage-label inputs + context textarea → `POST /api/saved-compares` → 跳转到 `/benchmarks/compare/saved/:id`
- `/benchmarks/compare/saved/:id` — **new**. Reuses `CompareGrid`, `CompareToolbar`, the new `StageBarChart`, the AI panel; adds:
  - 顶部 `PageHeader` 带 breadcrumb（Benchmarks → Compare → 报告名）
  - 编辑 name / context / stageLabels 的 inline edit
  - "重新生成 AI 分析" 按钮
  - "导出 HTML" 按钮（A4）
  - "删除" 按钮（AlertDialog 确认；用户的"操作"列约定）

A small "历史对比" 入口加在 Compare 页 toolbar 右侧，链接到 `/benchmarks/compare/saved`（列表页）。**侧边栏不动**。

### A4. HTML export: client-side serialize the report DOM

Implemented in `apps/web/src/features/benchmarks/compare/exportHtml.ts`:

1. Identify the report root `<div data-report-root>` rendered around the report sections (everything below `PageHeader`).
2. Fetch all stylesheets currently applied to the document (`document.styleSheets`) and serialize each to a single `<style>` block. Cross-origin stylesheets are skipped (we only have first-party CSS — Vite-bundled Tailwind).
3. Clone the root `Node`. Walk it, removing interactive-only attributes (`onclick` no-ops in static HTML; React will not hydrate). Convert `<button>` to `<span>` to silently kill click affordance.
4. Wrap in `<!DOCTYPE html>...<html lang="zh-CN"><head>...<title>${name}</title><style>...</style></head><body>${cloneOuterHTML}</body></html>`.
5. `Blob` + `<a download>` to trigger save.

Charts are Recharts SVG — they render with inline style by default, so no separate inlining pass is needed for chart visuals. If a chart child uses Tailwind classes for color (rare), a follow-up walker can resolve `getComputedStyle(node).color` into inline `style="color: ..."`.

The export does not include navigation chrome, AI provider info, or any auth-bearing assets. Opens cleanly on a phone or in an offline browser.

### A5. New chart component: `StageBarChart`

`apps/web/src/components/charts/StageBarChart.tsx` — grouped bar chart, X axis = stage labels, Y axis = metric value, supports 1–4 series per stage (e.g., p50/p90/p99). Recharts `<BarChart>` + `<Bar>` per series. Used by all 4 V1 figures.

Existing chart components (`PercentileTimeseries`, `LatencyCDF`, `QPSTimeseries`, etc.) are time-axis or distribution-axis; none of them satisfies "categorical X (stage) × N grouped bars" without contortion. New component is ~60 lines; shared by all report figures.

## Report sections (V1)

Rendered top-to-bottom, identical between `/compare` and `/compare/saved/:id`:

1. **概述 / TL;DR** — AI-generated; falls back to "尚未生成 AI 分析" banner with a Generate button when `narrative` is null.
2. **测试矩阵** — data-only table; one row per run; columns = stage label, name, tool, scenario, key params (workload, concurrency, duration). Built from `benchmark.params` JSON; falls back to "—" for any unknown field.
3. **关键指标对比** — embed existing `<CompareGrid>` as-is.
4. **图表组** — 4 `<StageBarChart>`:
   1. QPS + Err (two side-by-side single-series charts)
   2. TTFT p50/p90/p99 (one chart, 3 series) — only renders when ≥1 run has TTFT data (guidellm/genai-perf)
   3. e2e Latency p50/p90/p99 (one chart, 3 series) — all tools
   4. Extra-metric chart — renders only when `serverMetrics` provides cache savings or hit rate; otherwise omitted entirely
5. **分析** — AI-generated; one paragraph per significant Δ (currently ">5% off baseline" or "differing verdicts in CompareGrid"); empty state hidden if narrative null
6. **结论与选型建议** — AI-generated; recommendation paragraph + caveats list
7. **测试环境** — auto fields (connection name, baseUrl, model, tool versions per run) followed by user-provided `context` text rendered as Markdown (sanitized)

## API surface

All under `/api/saved-compares`, owner-scoped:

| Method | Path | Body / Query | Notes |
|---|---|---|---|
| `POST` | `/` | `{ name, benchmarkIds[], stageLabels, baselineId?, context? }` | Returns `{ id }`. Does NOT auto-synthesize. |
| `GET` | `/` | `?limit=&cursor=` | Cursor-paginated list (createdAt DESC). |
| `GET` | `/:id` | — | Includes hydrated benchmark snippets (name, tool, scenario, summaryMetrics) for direct render. |
| `PATCH` | `/:id` | `{ name?, context?, stageLabels?, baselineId? }` | benchmarkIds immutable in V1 (re-save if you want a different set). |
| `DELETE` | `/:id` | — | Hard delete. |
| `POST` | `/:id/synthesize` | `{ locale }` | Returns `{ narrative, generatedAt, fromCache }`. Persists narrative on success. |

Validation: same `nestjs-zod` pattern used in `BenchmarkController`. Auth: same JWT guard.

## Data flow on a typical session

```
1. User picks 4 runs in Inference Performance → Compare button → /benchmarks/compare?ids=a,b,c,d
2. Page renders CompareGrid + new "AI 分析" panel (empty) + new "保存" button
3. User clicks 保存 → dialog: name="Qwen3 KV cache 横评", stage labels per run, context="8x 910B4 NPU; comparing offload tiers"
4. POST /api/saved-compares → 201 { id: "ck..." }
5. Frontend nav→ /benchmarks/compare/saved/ck... (full-page report; AI panel still empty)
6. User clicks "生成 AI 分析" → POST /api/saved-compares/ck.../synthesize
7. Server: build prompt input (joins benchmarks, computes deltas), calls LLM via LlmJudgeService, validates JSON, persists narrative
8. Response → page refreshes narrative sections in place
9. User clicks "导出 HTML" → exportHtml() runs in-browser → file download
```

## Edge cases & error handling

- **A referenced benchmark is deleted** between save and view: render that column as "数据已删除"; CompareGrid shows "—" for that column; `StageBarChart` omits the bar; AI prompt input filters out the missing run with a notice in `context`.
- **A referenced benchmark belongs to another user** (legacy data, unlikely): treated same as deleted.
- **Mixed-tool / mixed-scenario** at save time: same gate as Compare — refuse with the existing alert text. Cannot save a SavedCompare that wouldn't render.
- **`narrative` is stale relative to current benchmark data**: show "上次生成于 …" timestamp; banner if any benchmark's `summaryMetrics.updatedAt > narrativeAt` suggesting regenerate. No auto-regen.
- **LLM provider not configured** (`/llm-judge-providers` empty): AI panel renders the "前往设置" CTA exactly like `AiDiagnosisCard`. Save still works — narrative just stays null.
- **LLM returns invalid JSON / schema mismatch**: surface via existing `ServiceUnavailableException` path; user retries.
- **Cache invalidation when benchmark metrics change.** Cache key embeds `runsDigest` (per-run `summaryMetrics` hash), per A2. Editing or rerunning a referenced benchmark therefore implicitly busts the cache on next synthesize. No explicit invalidation API.

## Testing

- API: `saved-compares.service.spec.ts` covers CRUD, owner filtering, mixed-tool rejection, deleted-benchmark hydration. `compare-synthesize.service.spec.ts` covers prompt building, JSON validation, cache hit/miss, persistence on success.
- HTTP e2e: `apps/api/test/e2e/saved-compares.e2e-spec.ts` — full request lifecycle including synthesize against a stub LLM.
- Web unit: `SavedCompareDetailPage.test.tsx` (renders narrative, dispatches regenerate, fires export). `StageBarChart.test.tsx` (data → bars). `exportHtml.test.ts` (Blob shape, contains `<style>`, contains chart SVG nodes).
- Browser e2e: `e2e/saved-compares.spec.ts` — pick 2 runs → Compare → save → load saved page → verify section presence.

## Migration / rollout

- Single Prisma migration: `prisma migrate dev --create-only --name add_saved_compares`. No data backfill.
- No feature flag — Compare page additions render unconditionally; new routes available behind auth as soon as deployed.
- No CLAUDE.md update required (no new project-wide convention introduced).

## Future work (not V1)

- Public no-auth shareable links with read-only UUID
- PDF export via Puppeteer
- Free-form Markdown editor for narrative
- Versioned narrative history with diff view
- Cross-tool comparison via metric mapping
- Chart-level "screenshot to PNG" for embedding in external docs
- Auto-trigger synthesize when SavedCompare has no narrative and provider becomes configured
