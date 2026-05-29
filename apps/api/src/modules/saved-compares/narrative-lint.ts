import type { CompareNarrative, LintWarning } from "@modeldoctor/contracts";

// ─── Detector helpers ────────────────────────────────────────────────────

const DECORATIVE_EMOJI_RE =
  /[\u{1F947}-\u{1F949}\u{1F525}\u{1F680}\u{1F3AF}\u{1F4A1}\u{1F31F}⭐❗‼]/u;

const AI_FILLER_PHRASES = [
  "值得注意的是",
  "综上所述",
  "let's dive",
  "it is worth noting",
  "in conclusion",
] as const;

const BANNED_ADVERBS = [
  // English
  "significantly",
  "robust",
  "seamlessly",
  "leverage",
  "unlock",
  "empower",
  "comprehensive",
  // Chinese
  "显著地",
  "鲁棒",
  "无缝",
  "充分利用",
  "释放",
  "赋能",
  "全面深入",
] as const;

const LLM_SELF_REFERENCE_RES = [
  /Generated with Claude/i,
  /🤖/u,
  /as an AI/i,
  /as a language model/i,
] as const;

// Repo paths: file or dir that starts with apps/ or packages/ followed by /
// at least one segment. Limited to lowercase + digits + dash for safety.
const REPO_PATH_RE = /\b(?:apps|packages)\/[a-z0-9-]+(?:\/[a-z0-9-]+){1,}(?:\.[a-z]{1,5})?\b/;

// Numbers with ≥3 decimal places, optionally signed, optional %/unit suffix.
const HIGH_DECIMAL_RE = /[+-]?\d+\.\d{3,}/;

// ─── Markdown parsing helpers ────────────────────────────────────────────

/**
 * Split a markdown body into paragraphs (separated by blank line), but skip
 * fenced code blocks entirely — anything inside ``` ``` is excluded from prose
 * checks (so we don't flag `cd apps/api && pnpm dev` as a prose path).
 */
function paragraphsExcludingCode(body: string): string[] {
  const withoutFences = body.replace(/```[\s\S]*?```/g, "");
  return withoutFences
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Extract markdown table cell contents. A line looks like a table row when it
 * starts with `|` and contains at least one more `|`. Returns flat list of
 * cell contents from all detected tables.
 */
function tableCells(body: string): string[] {
  const cells: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || (trimmed.match(/\|/g)?.length ?? 0) < 2) continue;
    // Skip header-separator rows (|---|---|).
    if (/^\|[\s|:-]+\|$/.test(trimmed)) continue;
    for (const cell of trimmed.slice(1, -1).split("|")) {
      cells.push(cell.trim());
    }
  }
  return cells;
}

function countBoldSpans(paragraph: string): number {
  const mdBold = paragraph.match(/\*\*[^*]+\*\*/g)?.length ?? 0;
  const htmlBold = paragraph.match(/<strong\b[^>]*>[\s\S]*?<\/strong>/gi)?.length ?? 0;
  return mdBold + htmlBold;
}

// ─── Main entry ──────────────────────────────────────────────────────────

/**
 * Run style-guide lint over a fully-parsed narrative. Returns warnings; never
 * throws. The caller decides whether to retry the LLM or persist with warnings.
 *
 * `inputNumbers` reserved for future number-cross-check (verifies LLM did not
 * invent figures absent from the source data). Not yet enforced — kept on the
 * signature so call sites land in the right shape now.
 */
export function lintNarrative(narrative: CompareNarrative, _inputNumbers: number[]): LintWarning[] {
  const warnings: LintWarning[] = [];
  const isZh = narrative.locale === "zh-CN";

  for (const section of narrative.sections) {
    const title = section.title;
    const body = section.bodyMarkdown;

    // Literal "TL;DR(N 条)" anywhere in title or body.
    if (/TL\s*;\s*DR\s*[（(][^)）]*[条 ]/i.test(`${title}\n${body}`)) {
      warnings.push({
        code: "literal-tldr-marker",
        sectionId: section.id,
        sample: title.slice(0, 80),
      });
    }

    // Executive Summary in zh-CN report.
    if (isZh && /Executive Summary/i.test(`${title}\n${body}`)) {
      warnings.push({
        code: "executive-summary-en-in-cn",
        sectionId: section.id,
        sample: title.slice(0, 80),
      });
    }

    // Decorative emoji anywhere.
    const emojiMatch = `${title}\n${body}`.match(DECORATIVE_EMOJI_RE);
    if (emojiMatch) {
      warnings.push({
        code: "decorative-emoji",
        sectionId: section.id,
        sample: emojiMatch[0],
      });
    }

    // Tick/cross inside markdown table cells.
    const cells = tableCells(body);
    if (cells.some((c) => c.includes("✅") || c.includes("❌"))) {
      warnings.push({
        code: "tick-cross-in-table",
        sectionId: section.id,
        sample: cells.find((c) => c.includes("✅") || c.includes("❌"))?.slice(0, 80) ?? "",
      });
    }

    const paragraphs = paragraphsExcludingCode(body);

    for (const para of paragraphs) {
      // Bold density per paragraph.
      if (countBoldSpans(para) >= 3) {
        warnings.push({
          code: "bold-density",
          sectionId: section.id,
          sample: para.slice(0, 120),
        });
      }

      // Decimal precision ≥3.
      if (HIGH_DECIMAL_RE.test(para)) {
        const hit = para.match(HIGH_DECIMAL_RE)?.[0] ?? "";
        warnings.push({
          code: "decimal-precision",
          sectionId: section.id,
          sample: hit,
        });
      }

      // AI filler phrases (anywhere in paragraph).
      for (const phrase of AI_FILLER_PHRASES) {
        if (para.toLowerCase().includes(phrase.toLowerCase())) {
          warnings.push({
            code: "ai-filler-phrase",
            sectionId: section.id,
            sample: phrase,
          });
          break;
        }
      }

      // Banned adverbs — case-insensitive word match for English, substring
      // for Chinese (no word boundaries in CJK).
      const lower = para.toLowerCase();
      for (const adverb of BANNED_ADVERBS) {
        const isCn = /[一-鿿]/.test(adverb);
        if (isCn ? para.includes(adverb) : new RegExp(`\\b${adverb}\\b`, "i").test(lower)) {
          warnings.push({
            code: "banned-adverb",
            sectionId: section.id,
            sample: adverb,
          });
          break;
        }
      }

      // LLM self-reference.
      for (const re of LLM_SELF_REFERENCE_RES) {
        if (re.test(para)) {
          warnings.push({
            code: "llm-self-reference",
            sectionId: section.id,
            sample: para.match(re)?.[0] ?? "",
          });
          break;
        }
      }

      // Repo path in prose (excludes code fences via paragraphsExcludingCode).
      if (REPO_PATH_RE.test(para)) {
        warnings.push({
          code: "repo-path-in-prose",
          sectionId: section.id,
          sample: para.match(REPO_PATH_RE)?.[0] ?? "",
        });
      }
    }
  }

  return warnings;
}

/**
 * Classify warnings into "blocking" (worth a one-shot LLM retry) vs "soft"
 * (write through, surface in UI). Subjective rules like banned adverbs and
 * filler phrases are blocking; rare/low-impact ones like decimal precision
 * are soft.
 */
export function isBlockingWarning(code: LintWarning["code"]): boolean {
  switch (code) {
    case "decorative-emoji":
    case "tick-cross-in-table":
    case "literal-tldr-marker":
    case "executive-summary-en-in-cn":
    case "llm-self-reference":
    case "ai-filler-phrase":
    case "banned-adverb":
      return true;
    case "bold-density":
    case "decimal-precision":
    case "residual-markdown-bold":
    case "three-word-parallelism":
    case "repo-path-in-prose":
      return false;
  }
}
