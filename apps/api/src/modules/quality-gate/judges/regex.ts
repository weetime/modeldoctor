import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "regex" }>;

export const regexJudge: Judge<Config> = {
  kind: "regex",
  async evaluate(config, ctx) {
    let re: RegExp;
    try {
      re = new RegExp(config.pattern, config.flags);
    } catch (e) {
      return { passed: false, error: `invalid regex: ${(e as Error).message}` };
    }
    const m = ctx.answer.match(re);
    return {
      passed: m != null,
      reason: m ? `matched: ${m[0].slice(0, 64)}` : `no match for /${config.pattern}/`,
    };
  },
};
