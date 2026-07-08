// apps/api/src/modules/playground-agent/agent-judge.service.ts
import { type AgentVerdict, AgentVerdictSchema, type ChatMessage } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";
import { chatCompletion } from "../insights/llm-client.js";
import { LlmJudgeService } from "../llm-judge/llm-judge.service.js";

export interface AgentJudgeInput {
  task: string;
  /** The completed run's accumulated transcript (system/user/assistant/tool messages). */
  messages: ChatMessage[];
}

/** Give the judge call a hard ceiling so a slow/unresponsive judge provider
 * never keeps an otherwise-finished agent run hanging before `done`. */
const JUDGE_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You are grading ONE already-completed AI agent run — a single trajectory, NOT a multi-run benchmark suite. You will be given the user's task and the full trajectory (assistant messages, tool calls with arguments, and tool results, in order).

Assess:
- taskCompleted: did the agent's final response actually accomplish the user's task?
- toolUseCorrect: were the tools it called (if any) the right ones, called with correct/reasonable arguments, and were their results used correctly? (true if no tools were needed and none were called)
- extraSteps: how many tool calls or turns in the trajectory were unnecessary, redundant, or wasted (0 if the trajectory was efficient)
- oneLineVerdict: one concise sentence (English) summarizing the run's quality

Respond with STRICT JSON only — no markdown code fences, no explanation before or after:
{"taskCompleted": boolean, "toolUseCorrect": boolean, "extraSteps": number, "oneLineVerdict": "string"}`;

/**
 * Lightweight trajectory judge (Task 13) — the Agent Playground's "能力测试"
 * payoff. Scores a JUST-COMPLETED agent run using the workspace's default
 * LLM-judge provider (`LlmJudgeService.getDecrypted()`), mirroring the
 * fetch/header/body pattern other `getDecrypted()` consumers use
 * (`AlertExplainerService`, `SynthesizeService`) via the shared
 * `chatCompletion` helper.
 *
 * Deliberately NOT a τ³-style pass^k benchmark — this is a single, cheap,
 * best-effort verdict on one trajectory. `judge()` NEVER throws: no
 * provider configured, a disabled provider, a network failure, a timeout,
 * non-JSON content, or a JSON body that doesn't match the verdict schema
 * all degrade to `null` so a judge outage never breaks the agent run itself
 * (see `AgentLoopService` — the verdict is best-effort and optional).
 */
@Injectable()
export class AgentJudgeService {
  private readonly log = new Logger(AgentJudgeService.name);

  constructor(private readonly llmJudge: LlmJudgeService) {}

  async judge(input: AgentJudgeInput): Promise<AgentVerdict | null> {
    try {
      const provider = await this.llmJudge.getDecrypted();
      if (!provider?.enabled) return null;

      const userPrompt = [
        `Task:\n${input.task}`,
        "",
        "Trajectory:",
        this.summarizeTrajectory(input.messages),
      ].join("\n");

      const res = await chatCompletion(
        {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          apiStyle: provider.apiStyle,
        },
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { jsonMode: true, timeoutMs: JUDGE_TIMEOUT_MS },
      );

      const json = this.extractJson(res.content);
      const parsed = AgentVerdictSchema.safeParse(json);
      if (!parsed.success) {
        this.log.warn(`Agent judge JSON failed schema: ${res.content.slice(0, 200)}`);
        return null;
      }
      return parsed.data;
    } catch (e) {
      this.log.warn(`Agent judge failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Renders the transcript as a compact, human-readable log for the judge
   * prompt. System messages are dropped (the judge only needs task + what
   * the agent actually did). */
  private summarizeTrajectory(messages: ChatMessage[]): string {
    const lines: string[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "user") {
        lines.push(`USER: ${this.contentText(m.content)}`);
        continue;
      }
      if (m.role === "assistant") {
        const text = this.contentText(m.content);
        if (text.trim().length > 0) lines.push(`ASSISTANT: ${text}`);
        for (const tc of m.tool_calls ?? []) {
          lines.push(
            `ASSISTANT calls tool "${tc.function.name}" with args ${tc.function.arguments}`,
          );
        }
        continue;
      }
      if (m.role === "tool") {
        lines.push(
          `TOOL RESULT (for call ${m.tool_call_id ?? "?"}): ${this.contentText(m.content)}`,
        );
      }
    }
    return lines.join("\n");
  }

  private contentText(content: ChatMessage["content"]): string {
    if (typeof content === "string") return content;
    return content.map((p) => (p.type === "text" ? p.text : `[${p.type}]`)).join(" ");
  }

  /**
   * Extracts a JSON object out of a completion body that may be strict JSON,
   * fenced in a ```json block, or wrapped in surrounding prose. Throws if no
   * attempt parses — the caller's outer try/catch turns that into `null`.
   */
  private extractJson(raw: string): unknown {
    const attempts: string[] = [raw.trim()];
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) attempts.push(fenceMatch[1].trim());
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) attempts.push(raw.slice(first, last + 1));

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch {
        // try the next candidate
      }
    }
    throw new Error(`no valid JSON found in judge response: ${raw.slice(0, 200)}`);
  }
}
