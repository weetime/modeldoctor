import { z } from "zod";

// ─── Hero ────────────────────────────────────────────────────────────────
// First visual row of the report: eyebrow chip + h1 + subtitle + meta row.
// All strings are short — narrative density lives in `sections[].bodyMarkdown`.

export const heroMetaItemSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
});
export type HeroMetaItem = z.infer<typeof heroMetaItemSchema>;

export const heroSchema = z.object({
  eyebrow: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  subtitle: z.string().min(1).max(500),
  metaItems: z.array(heroMetaItemSchema).min(0).max(8),
});
export type Hero = z.infer<typeof heroSchema>;

// ─── Summary cards ───────────────────────────────────────────────────────
// 2-4 KPI cards across the top. `tone` drives the top color stripe.

export const summaryCardToneSchema = z.enum(["success", "danger", "attention", "info"]);
export type SummaryCardTone = z.infer<typeof summaryCardToneSchema>;

export const summaryCardSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(40),
  unit: z.string().max(20).optional(),
  tone: summaryCardToneSchema,
  trend: z.string().max(160).optional(),
  foot: z.string().max(200).optional(),
});
export type SummaryCard = z.infer<typeof summaryCardSchema>;

// ─── Sections ────────────────────────────────────────────────────────────
// Fixed 6-section skeleton, mirroring ~/vllm/repots style guide §3.
// LLM fills `bodyMarkdown` per section. Markdown allows tables + inline HTML
// for Δ pills. Renderer post-processes Δ pill syntax (see report-markdown.ts
// in apps/web).

export const sectionIdSchema = z.enum([
  "summary", // 01 结论摘要
  "scope", // 02 测试目的与范围
  "method", // 03 测试方法
  "results", // 04 关键结果
  "caveats", // 05 异常与边界
  "advice", // 06 选型建议
]);
export type SectionId = z.infer<typeof sectionIdSchema>;

export const reportSectionSchema = z.object({
  id: sectionIdSchema,
  num: z.string().regex(/^0[1-6]$/),
  // Title MUST be a conclusion, not a topic (per style guide §2.1).
  title: z.string().min(4).max(200),
  // Markdown body. Tables, inline HTML for Δ pills, code blocks are allowed.
  bodyMarkdown: z.string().min(1).max(20_000),
});
export type ReportSection = z.infer<typeof reportSectionSchema>;

// ─── Figures ─────────────────────────────────────────────────────────────
// LLM picks which existing chart component to embed by refId, and writes
// the caption. The chart itself is rendered React-side from the SavedCompare
// data, so style stays 100% consistent.

export const figureRefIdSchema = z.enum([
  "stage-bars-throughput",
  "stage-bars-error-rate",
  "stage-bars-ttft-p95",
  // Inter-token latency (TPOT). ITL only carries p50/p95 (not p90/p99), so
  // this figure renders those two percentiles.
  "stage-bars-tpot-p95",
  "stage-bars-e2e-p95",
  // Prefix-cache figures — populated from serverMetrics.prefixCache, only
  // available for lb-strategy runs. hit = cache hit-rate %,
  // top-pod = the busiest pod's share of queries (routing concentration).
  "stage-bars-prefix-cache-hit",
  "stage-bars-top-pod-share",
  // Engine-metrics figures — populated from the durable serverMetrics.engineMetrics
  // snapshot (Prometheus, reduced to avg/peak scalars). kv-cache = KV cache
  // utilization peak %, preemption = preemption rate, queue = request queue-time
  // peak. Cross-run bars; available when every run carries that engine scalar.
  "stage-bars-kv-cache",
  "stage-bars-preemption",
  "stage-bars-queue",
  "compare-grid",
  // Phase-1 figures — rendered from serverMetrics.prefixCache.perPod and
  // cold/warm delta computations.
  "pod-traffic-distribution",
  "pod-hit-rate",
  "cold-warm-delta",
  // Capacity-planning figure — rendered from summaryMetrics.data.capacityCurve
  // (guidellm sweep runs only). Available when any run carries a capacity curve.
  "throughput-vs-concurrency",
  // Phase-2 figure — rendered from HydratedBenchmarkRef.latencyCdf.samples;
  // shows the e2e latency CDF across runs for guidellm/vegeta tools.
  "latency-distribution",
]);
export type FigureRefId = z.infer<typeof figureRefIdSchema>;

export const reportFigureSchema = z.object({
  id: z.string().min(1).max(40),
  refId: figureRefIdSchema,
  caption: z.string().min(1).max(400),
  // Optional section id this figure should anchor to (for ordering hints).
  anchorSection: sectionIdSchema.optional(),
});
export type ReportFigure = z.infer<typeof reportFigureSchema>;

// ─── Lint warnings ───────────────────────────────────────────────────────
// Server-side enforced style rules carried alongside the narrative so the
// UI can surface "the AI got close but tripped these rules" hints.

export const lintWarningCodeSchema = z.enum([
  "decorative-emoji",
  "tick-cross-in-table",
  "literal-tldr-marker",
  "executive-summary-en-in-cn",
  "bold-density",
  "decimal-precision",
  "ai-filler-phrase",
  "residual-markdown-bold",
  "banned-adverb",
  "three-word-parallelism",
  "llm-self-reference",
  "repo-path-in-prose",
]);
export type LintWarningCode = z.infer<typeof lintWarningCodeSchema>;

export const lintWarningSchema = z.object({
  code: lintWarningCodeSchema,
  sectionId: sectionIdSchema.optional(),
  sample: z.string().max(200),
});
export type LintWarning = z.infer<typeof lintWarningSchema>;

// ─── Top-level narrative ─────────────────────────────────────────────────

export const compareNarrativeSchema = z.object({
  schemaVersion: z.literal(2),
  locale: z.enum(["zh-CN", "en-US"]),
  hero: heroSchema,
  summaryCards: z.array(summaryCardSchema).min(2).max(4),
  sections: z
    .array(reportSectionSchema)
    .min(6)
    .max(6)
    .refine(
      (sections) => {
        const ids = sections.map((s) => s.id);
        const expected: SectionId[] = [
          "summary",
          "scope",
          "method",
          "results",
          "caveats",
          "advice",
        ];
        return expected.every((id, i) => ids[i] === id);
      },
      { message: "sections must be in order: summary, scope, method, results, caveats, advice" },
    ),
  figures: z.array(reportFigureSchema).min(0).max(8),
  lintWarnings: z.array(lintWarningSchema).min(0).max(40),
});
export type CompareNarrative = z.infer<typeof compareNarrativeSchema>;

// ─── Request/response ────────────────────────────────────────────────────

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
