import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "exact-match" }>;

export const exactMatchJudge: Judge<Config> = {
  kind: "exact-match",
  async evaluate(config, ctx) {
    const trim = config.trim !== false;
    const caseSensitive = config.caseSensitive === true;
    const norm = (s: string) => {
      let v = trim ? s.trim() : s;
      if (!caseSensitive) v = v.toLowerCase();
      return v;
    };
    const passed = norm(ctx.answer) === norm(ctx.expected);
    return {
      passed,
      reason: passed ? "exact match" : `expected "${ctx.expected}", got "${ctx.answer}"`,
    };
  },
};
