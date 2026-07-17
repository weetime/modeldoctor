import { tau3ParamsSchema, vllmOmniBenchParamsSchema } from "@modeldoctor/tool-adapters";
import { describe, expect, it } from "vitest";
import { BENCHMARK_TEMPLATES } from "./seed.js";

describe("BENCHMARK_TEMPLATES — official tau3 agent templates", () => {
  const tiers = {
    smoke: [5, 1],
    standard: [20, 3],
    full: [null, 4],
  } as const;

  for (const [name, [tasks, trials]] of Object.entries(tiers)) {
    it(`agent template ${name} validates`, () => {
      const tpl = BENCHMARK_TEMPLATES.find((t) => t.id === `tpl_official_agent_${name}`);
      expect(tpl).toBeDefined();
      expect(tpl?.scenario).toBe("agent");
      expect(tpl?.tool).toBe("tau3");
      const p = tau3ParamsSchema.parse(tpl?.config);
      expect(p.numTasksPerDomain).toBe(tasks);
      expect(p.numTrials).toBe(trials);
      expect(p.domains).toEqual(["airline", "retail", "telecom"]);
    });
  }
});

describe("BENCHMARK_TEMPLATES — official omni realtime templates", () => {
  const tiers = {
    standard: { concurrencyLevels: [1, 8, 16, 32], voiceTax: true },
    quick: { concurrencyLevels: [1, 8], voiceTax: false },
  } as const;

  for (const [name, expected] of Object.entries(tiers)) {
    it(`omni template ${name} validates`, () => {
      const tpl = BENCHMARK_TEMPLATES.find((t) => t.id === `tpl_official_omni_realtime_${name}`);
      expect(tpl).toBeDefined();
      expect(tpl!.scenario).toBe("omni");
      expect(tpl!.tool).toBe("vllm-omni-bench");
      expect(tpl!.categories).toEqual(["omni"]);
      const p = vllmOmniBenchParamsSchema.parse(tpl!.config);
      expect(p.concurrencyLevels).toEqual(expected.concurrencyLevels);
      expect(p.voiceTax).toBe(expected.voiceTax);
    });
  }
});
