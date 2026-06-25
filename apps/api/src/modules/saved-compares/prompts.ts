import type { LintWarning } from "@modeldoctor/contracts";

// ────────────────────────────────────────────────────────────────────────
// Style guide encoded as a system prompt. Mirrors
// `docs/saved-compare-report-style.md` — keep both in sync.
// ────────────────────────────────────────────────────────────────────────

// The schema block's EXAMPLE strings are locale-specific: weaker judge models
// (e.g. deepseek-chat) mirror the language of the examples they're shown, so a
// Chinese eyebrow/meta/trend example made them emit a Chinese report under an
// en-US locale. Keep the en-US prompt 100% English so the model has no Chinese
// to copy.
function schemaBlock(locale: "zh-CN" | "en-US"): string {
  const zh = locale !== "en-US";
  const eyebrowEg = zh ? "MODELDOCTOR · 推理引擎对比" : "MODELDOCTOR · ENGINE COMPARISON";
  const metaEg = zh
    ? '{label:"硬件", value:"A100 80G × 1"}'
    : '{label:"Hardware", value:"A100 80G × 1"}';
  const trendEg = zh ? "领先 SGLang 38%" : "leads SGLang by 38%";
  return `Output a single JSON object matching this TypeScript shape exactly:

interface Narrative {
  schemaVersion: 2;
  locale: "zh-CN" | "en-US";
  hero: {
    eyebrow: string;     // ≤120 chars, mono-style category line (e.g. "${eyebrowEg}")
    title: string;       // ≤200 chars, headline that includes a number or directional verdict
    subtitle: string;    // 1-3 sentences, ≤500 chars, must include the single most important number
    metaItems: Array<{ label: string; value: string }>;  // 0-8 items, e.g. ${metaEg}
  };
  summaryCards: Array<{
    label: string;       // ≤80 chars
    value: string;       // ≤40 chars, the headline number
    unit?: string;       // ≤20 chars
    tone: "success" | "danger" | "attention" | "info";
    trend?: string;      // ≤160 chars, e.g. "${trendEg}"
    foot?: string;       // ≤200 chars, single-line caveat
  }>;                    // 2-4 cards, no more
  sections: [
    { id: "summary", num: "01", title: string, bodyMarkdown: string },
    { id: "scope",   num: "02", title: string, bodyMarkdown: string },
    { id: "method",  num: "03", title: string, bodyMarkdown: string },
    { id: "results", num: "04", title: string, bodyMarkdown: string },
    { id: "caveats", num: "05", title: string, bodyMarkdown: string },
    { id: "advice",  num: "06", title: string, bodyMarkdown: string },
  ];                     // exactly 6 sections in this order
  figures: Array<{
    id: string;
    refId: "stage-bars-throughput" | "stage-bars-error-rate" | "stage-bars-ttft-p95" | "stage-bars-tpot-p95" | "stage-bars-e2e-p95" | "stage-bars-prefix-cache-hit" | "stage-bars-top-pod-share" | "stage-bars-kv-cache" | "stage-bars-preemption" | "stage-bars-queue" | "pod-traffic-distribution" | "pod-hit-rate" | "cold-warm-delta" | "throughput-vs-concurrency" | "latency-distribution" | "compare-grid";
    caption: string;
    anchorSection?: "summary" | "scope" | "method" | "results" | "caveats" | "advice";
  }>;
  lintWarnings: [];      // always emit empty array; server fills this
}`;
}

// Style rules — most are language-neutral; the four banned-token lines (verdict
// labels, TL;DR string, AI-tell phrases, banned adverbs) carry locale-specific
// tokens, so the en-US prompt lists only English ones (no stray CJK to mirror).
function styleRules(locale: "zh-CN" | "en-US"): string {
  const zh = locale !== "en-US";
  const verdictTokens = zh ? '"推荐" / "不建议" / "—"' : '"Recommended" / "Not recommended" / "—"';
  const tldr = zh ? '"TL;DR(N 条)" or "TL;DR (N items)"' : '"TL;DR (N items)"';
  const aiTells = zh
    ? '"值得注意的是", "综上所述", "let\'s dive", "it is worth noting", "in conclusion"'
    : '"let\'s dive", "it is worth noting", "in conclusion"';
  const bannedAdverbs = zh
    ? "significantly, robust, seamlessly, leverage, unlock, empower, comprehensive, 显著地, 鲁棒, 无缝, 充分利用, 释放, 赋能, 全面深入"
    : "significantly, robust, seamlessly, leverage, unlock, empower, comprehensive";
  return `Style rules (the report will be auto-rejected if violated):

1. Section titles MUST be conclusions, not topics. Each title MUST contain at least one number or a directional verdict word.
   - Weak: "Performance comparison"
   - Strong: "vLLM throughput leads SGLang by 38% at par=32"
2. First paragraph of every section MUST start with a number + conclusion. No "in today's industry...", no "we often hear...".
3. Vary paragraph length deliberately. Mix 1-sentence, 4-sentence, 2-sentence paragraphs. Do NOT produce uniform 3-sentence paragraphs (that is the AI default — avoid it).
4. Numbers ≥3 decimal places are forbidden. "+135%" or "~+135% (N=8, σ=4.2%)" instead of "+135.275%".
5. Tables: max 6 columns. Prefer one figure (figures[].refId) + a short 3-5 number table over a 12-row wide table.
6. NEVER use decorative emoji (🥇🥈🥉🔥🚀🎯💡🌟⭐❗‼️). Use plain text or <strong>.
7. NEVER use ✅ or ❌ in tables. Use ${verdictTokens}.
8. NEVER write the literal string ${tldr}.
9. NEVER use these AI-tell phrases at paragraph start: ${aiTells}.
10. Banned adverbs (use a specific verb instead): ${bannedAdverbs}.
11. At most TWO bold spans (**...** or <strong>) per paragraph.
12. NEVER self-reference as an AI: no "Generated with Claude", no 🤖, no "as an AI", no "as a language model".
13. NEVER include repo paths like "apps/api/..." or "packages/..." in prose. Use feature names. Inside fenced code blocks paths are fine.
14. Every number you cite (req/s, ms, %, etc.) MUST come from the input data or be a derivative the reader can verify (Δ%, p95/p50 ratio). Never invent numbers.

Section size targets:
- 01 summary: ≤ 1 page, 3-5 conclusions of varying length, first sentence cites the most important number
- 02 scope:   ≤ half page, what this comparison answers, which stages compared
- 03 method:  1-2 pages, workload / hardware / tool / version / key aligned params
- 04 results: 2-4 pages, each subsection has 1 figure (via figures[]) + small table + 1-2 paragraphs
- 05 caveats: ≤ 1 page, data comparability boundaries, known issues, SLO limits
- 06 advice:  ≤ half page, scenario → config + 0-5 caveats
`;
}

function schemaInstructions(locale: "zh-CN" | "en-US"): string {
  if (locale === "en-US") {
    return `You are a senior LLM serving performance analyst. Given multiple benchmark runs, produce a deep report following the ModelDoctor SavedCompare report convention. The output must read like a human analyst wrote it (no AI tells).

${schemaBlock(locale)}

${styleRules(locale)}

Language: write every word of prose in English — the hero kicker/title/subtitle, every metaItem label and value, all section titles and bodies, table cells, and figure captions. Keep only established technical terms (vLLM, TTFT, p95, req/s) verbatim.
schemaVersion: 2, locale: "en-US".
Emit raw JSON only — no \`\`\`json fence, no preamble.`;
  }
  return `你是一位资深 LLM 推理服务性能分析师。给定多个 benchmark 的对比数据,你要按 ModelDoctor SavedCompare 报告规范产出一份**深度报告**(看起来像分析师手写,不要 AI 味)。

${schemaBlock(locale)}

${styleRules(locale)}

输出语言:全文严格简体中文(hero / 各 metaItem / 章节标题与正文 / 表格 / 图注),技术术语 vLLM / TTFT / p95 / req/s 等保留英文原文。
schemaVersion: 2, locale: "zh-CN"。
只输出 JSON 对象,不要 \`\`\`json fence,不要解释文字。`;
}

export function buildSystemPrompt(locale: "zh-CN" | "en-US", scenarioFragment: string): string {
  const base = schemaInstructions(locale);
  if (!scenarioFragment.trim()) return base;
  const header = locale === "en-US" ? "\n\n## Scenario guidance\n" : "\n\n## 场景专项要求\n";
  return `${base}${header}${scenarioFragment}`;
}

// ────────────────────────────────────────────────────────────────────────
// Retry prompt — used when lint pass on the first response flagged blocking
// warnings. Lists the violations and asks the model to regenerate.
// ────────────────────────────────────────────────────────────────────────

export function buildRetryFeedback(locale: "zh-CN" | "en-US", warnings: LintWarning[]): string {
  const zh = locale !== "en-US";
  const violations = warnings
    .map((w) => `  - [${w.sectionId ?? "?"}] ${w.code}: "${w.sample}"`)
    .join("\n");
  return zh
    ? `上一次输出命中以下风格规则违例,请改写后重新输出完整 JSON(不要部分输出,不要 diff,完整覆盖):\n${violations}`
    : `Your previous output triggered these style-rule violations. Regenerate the FULL JSON (no partial output, no diff):\n${violations}`;
}
