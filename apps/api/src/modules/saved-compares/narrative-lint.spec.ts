import type { CompareNarrative } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { lintNarrative } from "./narrative-lint.js";

const baseNarrative = (overrides: Partial<CompareNarrative> = {}): CompareNarrative => ({
  schemaVersion: 2,
  locale: "zh-CN",
  hero: {
    eyebrow: "MODELDOCTOR · 推理引擎对比",
    title: "vLLM 与 SGLang 在 par=32 高压档下的吞吐差距",
    subtitle: "Qwen2.5-7B 双引擎对比,固定 par=32 + 10 分钟稳态,vLLM 吞吐 12.4 req/s 领先 38%。",
    metaItems: [{ label: "硬件", value: "A100 80G × 1" }],
  },
  summaryCards: [
    {
      label: "vLLM 吞吐",
      value: "12.4",
      unit: "req/s",
      tone: "success",
      trend: "领先 SGLang 38%",
      foot: "par=32 稳态窗口",
    },
    { label: "SGLang 吞吐", value: "9.0", unit: "req/s", tone: "danger" },
  ],
  sections: [
    {
      id: "summary",
      num: "01",
      title: "vLLM 在 par=32 吞吐领先 SGLang 38%",
      bodyMarkdown: "vLLM 吞吐 12.4 req/s,SGLang 9.0 req/s,vLLM 领先 38%。其余 TTFT/E2E 走势一致。",
    },
    {
      id: "scope",
      num: "02",
      title: "本次对比聚焦 par=32 高压档稳态",
      bodyMarkdown: "对比 vLLM 0.8.5 与 SGLang main,各跑 10 分钟稳态,Qwen2.5-7B bf16。",
    },
    {
      id: "method",
      num: "03",
      title: "硬件与工具与版本对齐:A100 80G × 1,vegeta 10rps",
      bodyMarkdown: "硬件 A100 80G,工具 vegeta,持续 10 分钟。max-num-seqs=32。",
    },
    {
      id: "results",
      num: "04",
      title: "vLLM 在吞吐 / E2E p95 两项指标均第一",
      bodyMarkdown: "vLLM 吞吐 12.4 req/s 第一,E2E p95 1.2s。SGLang 吞吐 9.0,E2E p95 1.8s。",
    },
    {
      id: "caveats",
      num: "05",
      title: "本次未覆盖多卡 TP,结论仅适用单卡",
      bodyMarkdown: "仅单卡 TP=1,多卡 TP=2/4 未测。SGLang 版本是 main 分支,不是 release。",
    },
    {
      id: "advice",
      num: "06",
      title: "单卡 A100 高吞吐场景优先 vLLM",
      bodyMarkdown: "单卡 A100 长稳态压测优先 vLLM。SGLang 待 cuda-graph 优化释出后再评估。",
    },
  ],
  figures: [],
  lintWarnings: [],
  ...overrides,
});

const replaceSection = (
  base: CompareNarrative,
  id: CompareNarrative["sections"][number]["id"],
  overrides: Partial<CompareNarrative["sections"][number]>,
): CompareNarrative => ({
  ...base,
  sections: base.sections.map((s) => (s.id === id ? { ...s, ...overrides } : s)),
});

describe("narrative-lint — clean baseline", () => {
  it("emits no warnings for a clean narrative", () => {
    const out = lintNarrative(baseNarrative(), []);
    expect(out).toEqual([]);
  });
});

describe("narrative-lint — decorative emoji", () => {
  it.each(["🥇", "🥈", "🥉", "🔥", "🚀", "🎯", "💡", "🌟"])("flags %s in section body", (emoji) => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        bodyMarkdown: `vLLM ${emoji} 吞吐 12.4 req/s 第一,SGLang 9.0 第二。`,
      }),
      [],
    );
    expect(out.some((w) => w.code === "decorative-emoji")).toBe(true);
  });
});

describe("narrative-lint — tick/cross in tables", () => {
  it("flags ✅ inside a markdown table cell", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown:
          "| 引擎 | 推荐 |\n|---|---|\n| vLLM | ✅ |\n| SGLang | ❌ |\n\nvLLM 12.4 req/s,SGLang 9.0。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "tick-cross-in-table")).toBe(true);
  });

  it("does not flag ✅ outside tables (prose mentions)", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        bodyMarkdown: "vLLM 吞吐 12.4 req/s 第一(团队 ✅ 已验收),SGLang 9.0 第二。",
      }),
      [],
    );
    // Prose-level ✅ is not lint-blocked by this rule (still bad style but not table corruption).
    expect(out.some((w) => w.code === "tick-cross-in-table")).toBe(false);
  });
});

describe("narrative-lint — literal TL;DR marker", () => {
  it("flags 'TL;DR(N 条)' as a section title", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        title: "TL;DR(3 条)",
      }),
      [],
    );
    expect(out.some((w) => w.code === "literal-tldr-marker")).toBe(true);
  });
});

describe("narrative-lint — Executive Summary in zh-CN report", () => {
  it("flags 'Executive Summary' string in zh-CN report", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        title: "Executive Summary — vLLM 领先",
      }),
      [],
    );
    expect(out.some((w) => w.code === "executive-summary-en-in-cn")).toBe(true);
  });

  it("does not flag 'Executive Summary' in en-US report", () => {
    const out = lintNarrative(
      replaceSection({ ...baseNarrative(), locale: "en-US" }, "summary", {
        title: "Executive Summary — vLLM leads at 12.4 req/s",
      }),
      [],
    );
    expect(out.some((w) => w.code === "executive-summary-en-in-cn")).toBe(false);
  });
});

describe("narrative-lint — bold density", () => {
  it("flags a paragraph with ≥3 bold spans", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: "**vLLM** 吞吐 **12.4** req/s 领先 **38%**,SGLang 9.0 req/s 第二。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "bold-density")).toBe(true);
  });

  it("accepts 1-2 bold spans per paragraph", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: "vLLM 吞吐 **12.4 req/s** 第一,SGLang 9.0 req/s 第二。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "bold-density")).toBe(false);
  });
});

describe("narrative-lint — decimal precision", () => {
  it("flags ≥3-decimal percentages like +135.275%", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        bodyMarkdown: "vLLM 吞吐领先 SGLang +135.275% (par=32 稳态)。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "decimal-precision")).toBe(true);
  });

  it("flags ≥3-decimal latency numbers", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: "vLLM E2E p95 1234.5678 ms,SGLang 1800 ms,vLLM 第一。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "decimal-precision")).toBe(true);
  });

  it("accepts 0-2 decimal numbers", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: "vLLM E2E p95 1.20 s,SGLang 1.80 s,vLLM 第一。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "decimal-precision")).toBe(false);
  });
});

describe("narrative-lint — AI filler phrases", () => {
  it.each([
    "值得注意的是",
    "综上所述",
    "let's dive",
    "it is worth noting",
    "in conclusion",
  ])("flags '%s' at paragraph start", (phrase) => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: `${phrase},vLLM 吞吐领先 SGLang 38%。`,
      }),
      [],
    );
    expect(out.some((w) => w.code === "ai-filler-phrase")).toBe(true);
  });
});

describe("narrative-lint — banned adverbs", () => {
  it.each([
    "significantly faster",
    "robust performance",
    "seamlessly integrated",
    "leverage the cache",
    "unlock throughput",
    "empower teams",
    "显著地领先",
    "鲁棒地处理",
    "无缝衔接",
    "充分利用 cache",
    "释放并发",
    "赋能业务",
  ])("flags '%s'", (phrase) => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "results", {
        bodyMarkdown: `vLLM ${phrase},吞吐 12.4 req/s,SGLang 9.0。`,
      }),
      [],
    );
    expect(out.some((w) => w.code === "banned-adverb")).toBe(true);
  });
});

describe("narrative-lint — LLM self-reference", () => {
  it.each([
    "Generated with Claude",
    "🤖 generated",
    "as an AI",
    "as a language model",
  ])("flags '%s'", (phrase) => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "advice", {
        bodyMarkdown: `单卡场景推荐 vLLM。${phrase}。`,
      }),
      [],
    );
    expect(out.some((w) => w.code === "llm-self-reference")).toBe(true);
  });
});

describe("narrative-lint — repo path in prose", () => {
  it("flags 'apps/api/...' file path in prose", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "method", {
        bodyMarkdown: "测试方法见 apps/api/src/modules/saved-compares/prompts.ts,工具 vegeta。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "repo-path-in-prose")).toBe(true);
  });

  it("does not flag paths inside code fences", () => {
    const out = lintNarrative(
      replaceSection(baseNarrative(), "method", {
        bodyMarkdown: "测试方法见 vegeta,启动:\n\n```\ncd apps/api && pnpm dev\n```\n\n吞吐 12.4。",
      }),
      [],
    );
    expect(out.some((w) => w.code === "repo-path-in-prose")).toBe(false);
  });
});

describe("narrative-lint — number cross-check against input", () => {
  it("does not warn when narrative numbers are in input data set", () => {
    const inputNumbers = [12.4, 9.0, 38, 1.2, 1.8];
    const out = lintNarrative(
      replaceSection(baseNarrative(), "summary", {
        bodyMarkdown: "vLLM 吞吐 12.4 req/s,SGLang 9.0,领先 38%。",
      }),
      inputNumbers,
    );
    expect(out.some((w) => w.code === "decimal-precision")).toBe(false);
    // Note: number cross-check is a soft warning — current spec runs through
    // an additional rule, not implemented in this baseline test.
  });
});
