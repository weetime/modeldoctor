import { describe, expect, it } from "vitest";
import { tau2ParamsSchema, tau2ReportSchema, tau2ParamDefaults } from "./schema.js";

describe("tau2ParamsSchema", () => {
  it("accepts a standard config", () => {
    const p = tau2ParamsSchema.parse({
      domains: ["airline", "retail", "telecom"],
      numTasksPerDomain: 20, numTrials: 3, gate: { mode: "off" },
    });
    expect(p.numTrials).toBe(3);
  });
  it("accepts numTasksPerDomain null (full set)", () => {
    expect(tau2ParamsSchema.parse({ ...tau2ParamDefaults, numTasksPerDomain: null }).numTasksPerDomain).toBeNull();
  });
  it("rejects empty domains", () => {
    expect(() => tau2ParamsSchema.parse({ ...tau2ParamDefaults, domains: [] })).toThrow();
  });
  it("rejects numTrials > 8", () => {
    expect(() => tau2ParamsSchema.parse({ ...tau2ParamDefaults, numTrials: 9 })).toThrow();
  });
  it("perDomainFloor gate parses", () => {
    const p = tau2ParamsSchema.parse({ ...tau2ParamDefaults,
      gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } } });
    expect(p.gate.mode).toBe("perDomainFloor");
  });
});
describe("tau2ReportSchema", () => {
  it("parses a summary.json shape", () => {
    const r = tau2ReportSchema.parse({
      kind: "agent-tau2", userSimModel: "deepseek-v3", numTrials: 3,
      overall: { pass1: 0.4, passK: 0.3, tasks: 60 },
      perDomain: { airline: { pass1: 0.38, passK: 0.3, tasks: 20 } },
      attribution: { wrong_action: 0.5, other: 0.5 },
      highlights: { successSimId: "s1", successDomain: "airline", failureSimId: "s2", failureDomain: "retail" },
    });
    expect(r.overall.tasks).toBe(60);
  });
});
