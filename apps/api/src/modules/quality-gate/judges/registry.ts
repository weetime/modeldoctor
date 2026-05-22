import type { JudgeConfig, JudgeOutcome } from "@modeldoctor/contracts";
import { containsJudge } from "./contains.js";
import { exactMatchJudge } from "./exact-match.js";
import { createLlmJudge, type LlmJudgeService } from "./llm-judge.js";
import { regexJudge } from "./regex.js";
import type { Judge, JudgeContext } from "./types.js";

export interface JudgeRegistry {
  apply(config: JudgeConfig, ctx: JudgeContext): Promise<JudgeOutcome>;
}

export function createJudgeRegistry(llmService: LlmJudgeService): JudgeRegistry {
  const llmJudge = createLlmJudge(llmService);
  const byKind: Record<JudgeConfig["kind"], Judge> = {
    "exact-match": exactMatchJudge as Judge,
    contains: containsJudge as Judge,
    regex: regexJudge as Judge,
    "llm-judge": llmJudge as Judge,
  };

  return {
    async apply(config, ctx) {
      const judge = byKind[config.kind];
      return judge.evaluate(config as never, ctx);
    },
  };
}
