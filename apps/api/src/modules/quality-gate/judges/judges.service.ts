import type { JudgeConfig, JudgeOutcome } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { chatCompletion } from "../../insights/llm-client.js";
import { LlmJudgeService } from "../../llm-judge/llm-judge.service.js";
import { createJudgeRegistry, type JudgeRegistry } from "./registry.js";
import type { JudgeContext } from "./types.js";

/**
 * Injectable wrapper around the pure-function judge registry. Adapts the
 * Nest-injected `LlmJudgeService` (provider config + key decryption) and the
 * diagnostics chat-completion client into the simple `runJudge(input)` shape
 * the registry expects.
 */
@Injectable()
export class JudgesService {
  private readonly registry: JudgeRegistry;

  constructor(llm: LlmJudgeService) {
    this.registry = createJudgeRegistry({
      runJudge: async (input) => {
        const provider = await llm.getDecrypted();
        if (!provider?.enabled) {
          throw new Error(
            "No enabled LLM judge provider configured. Configure one at Settings → LLM Judge.",
          );
        }
        const result = await chatCompletion(
          {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: provider.model,
            apiStyle: provider.apiStyle,
          },
          [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ],
          { jsonMode: true },
        );
        return { content: result.content };
      },
    });
  }

  apply(config: JudgeConfig, ctx: JudgeContext): Promise<JudgeOutcome> {
    return this.registry.apply(config, ctx);
  }
}
