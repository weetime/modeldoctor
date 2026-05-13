import type { JudgeConfig } from "@modeldoctor/contracts";
import type { Judge } from "./types.js";

type Config = Extract<JudgeConfig, { kind: "contains" }>;

export const containsJudge: Judge<Config> = {
  kind: "contains",
  async evaluate(config, ctx) {
    const cs = config.caseSensitive === true;
    const haystack = cs ? ctx.answer : ctx.answer.toLowerCase();
    const needles = config.substrings.map((s) => (cs ? s : s.toLowerCase()));
    const matched: string[] = [];
    const missing: string[] = [];
    for (const n of needles) {
      if (haystack.includes(n)) matched.push(n);
      else missing.push(n);
    }
    const passed = config.mode === "all" ? missing.length === 0 : matched.length > 0;
    const reason = passed
      ? `matched ${matched.length}/${needles.length}`
      : config.mode === "all"
        ? `missing: ${missing.join(", ")}`
        : `none of ${needles.join(", ")} found`;
    return { passed, reason };
  },
};
