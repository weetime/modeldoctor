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
 * the first label that appears standalone (not glued to other latin letters).
 */
export function extractChoice(text: string, labels: string[]): string | null {
  const alt = labels.map((l) => escapeRegExp(l.toUpperCase())).join("|");
  const up = text.toUpperCase();

  // 1) marker-based: "答案/正确答案/应选/选/answer (is)" ... <label>
  const marker = new RegExp(
    `(?:正确答案|答案|应选|选择|答|ANSWER(?:\\s+IS)?)\\s*(?:是|为|应该是|应为|:|：|\\.)?\\s*[（(\\[【]?\\s*(${alt})(?![A-Z])`,
    "i",
  );
  const mm = up.match(marker);
  if (mm) return mm[1];

  // 2) first standalone label (not surrounded by other latin letters)
  const standalone = new RegExp(`(?<![A-Z])(${alt})(?![A-Z])`, "i");
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
