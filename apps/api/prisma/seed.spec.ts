import { tau2ParamsSchema } from "@modeldoctor/tool-adapters";
import { describe, expect, it } from "vitest";
import { BENCHMARK_TEMPLATES } from "./seed.js";

describe("BENCHMARK_TEMPLATES — official tau2 agent templates", () => {
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
      expect(tpl?.tool).toBe("tau2");
      const p = tau2ParamsSchema.parse(tpl?.config);
      expect(p.numTasksPerDomain).toBe(tasks);
      expect(p.numTrials).toBe(trials);
      expect(p.domains).toEqual(["airline", "retail", "telecom"]);
    });
  }
});
