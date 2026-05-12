import type { JudgeConfig, JudgeOutcome } from "@modeldoctor/contracts";

export interface JudgeContext {
  question: string;
  expected: string;
  answer: string;
}

export interface Judge<T extends JudgeConfig = JudgeConfig> {
  readonly kind: T["kind"];
  evaluate(config: T, ctx: JudgeContext): Promise<JudgeOutcome>;
}
