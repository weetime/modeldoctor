import { defaultPassThreshold, type JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "llm-judge" }>;

// Thin shape from the AI Diagnostics service: factory only needs runJudge(prompts) → { content }.
// At wiring time the real adapter delegates to the diagnostics service.
export interface LlmJudgeService {
  runJudge(input: { systemPrompt: string; userPrompt: string; connectionId?: string }): Promise<{
    content: string;
  }>;
}

function buildSystemPrompt(rubric: string, scale: Config["scale"]): string {
  const range =
    scale === "0-1"
      ? "0.0 to 1.0"
      : scale === "0-5"
        ? "0 to 5 (integer or half points)"
        : "0 (fail) or 1 (pass)";
  return [
    "You are a strict evaluation judge.",
    "Score the assistant answer based ONLY on the rubric below.",
    `Output a JSON object exactly: {"score": <number in ${range}>, "reason": "<one sentence>"}`,
    "Do NOT include markdown fences or any other text.",
    "",
    "Rubric:",
    rubric,
  ].join("\n");
}

function buildUserPrompt(ctx: { question: string; expected: string; answer: string }): string {
  return [
    "Question:",
    ctx.question,
    "",
    "Expected (reference, may be a rubric description):",
    ctx.expected,
    "",
    "Assistant answer:",
    ctx.answer,
  ].join("\n");
}

export function createLlmJudge(service: LlmJudgeService): Judge<Config> {
  return {
    kind: "llm-judge",
    async evaluate(config, ctx) {
      try {
        const resp = await service.runJudge({
          systemPrompt: buildSystemPrompt(config.rubric, config.scale),
          userPrompt: buildUserPrompt(ctx),
          connectionId: config.judgeModel?.connectionId,
        });
        let parsed: { score: number; reason: string };
        try {
          parsed = JSON.parse(resp.content);
        } catch (_e) {
          return { passed: false, error: `judge returned non-JSON: ${resp.content.slice(0, 200)}` };
        }
        if (typeof parsed.score !== "number") {
          return {
            passed: false,
            error: `judge JSON missing numeric "score": ${resp.content.slice(0, 200)}`,
          };
        }
        const threshold = config.passThreshold ?? defaultPassThreshold(config.scale);
        return {
          passed: parsed.score >= threshold,
          score: parsed.score,
          reason: parsed.reason ?? "",
        };
      } catch (e) {
        return { passed: false, error: (e as Error).message };
      }
    },
  };
}
