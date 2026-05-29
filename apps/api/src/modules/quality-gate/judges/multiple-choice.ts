import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "multiple-choice" }>;

const DEFAULT_LABELS = ["A", "B", "C", "D"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the option label the model picked from its free-form answer.
 * Common shapes handled: "C", "C.", "(C)", "答案是 C", "正确答案：C", "C. 北京".
 * Strategy: prefer a label that follows an explicit answer marker; otherwise take
 * the first label that appears standalone (not glued to other alphanumeric chars).
 */
export function extractChoice(text: string, labels: string[]): string | null {
  // Longest-first so a label that is a prefix of another (e.g. "APP" vs "APPLE")
  // can't shadow the longer one in the regex alternation.
  const alt = [...labels]
    .map((l) => escapeRegExp(l.toUpperCase()))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const up = text.toUpperCase();

  // 1) marker-based: "答案/正确答案/正确选项/选项/应选/选/answer (is)" ... <label>.
  // Boundary `[A-Z0-9]` avoids matching "A" in "A1" or a digit label in "10".
  const marker = new RegExp(
    `(?:正确答案|正确选项|答案|选项|应选|选择|选|答|ANSWER(?:\\s+IS)?)\\s*(?:是|为|应该是|应为|:|：|\\.)?\\s*[（(\\[【]?\\s*(${alt})(?![A-Z0-9])`,
    "i",
  );
  const mm = up.match(marker);
  if (mm) return mm[1];

  // 2) first standalone label (not surrounded by other alphanumeric characters)
  const standalone = new RegExp(`(?<![A-Z0-9])(${alt})(?![A-Z0-9])`, "i");
  const sm = up.match(standalone);
  if (sm) return sm[1];

  return null;
}

export const multipleChoiceJudge: Judge<Config> = {
  kind: "multiple-choice",
  async evaluate(config, ctx) {
    const labels = config.labels ?? DEFAULT_LABELS;
    const choice = extractChoice(ctx.answer, labels);
    if (choice == null) {
      return {
        passed: false,
        reason: `未能从输出中识别选项（labels: ${labels.join("/")}）`,
      };
    }
    const passed = choice.toUpperCase() === config.answer.trim().toUpperCase();
    return {
      passed,
      reason: passed ? `选中 ${choice}` : `选中 ${choice}，正确答案 ${config.answer.toUpperCase()}`,
    };
  },
};
