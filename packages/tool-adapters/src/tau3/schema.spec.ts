import { describe, expect, it } from "vitest";
import { tau3ParamDefaults, tau3ParamsSchema, tau3ReportSchema } from "./schema.js";

describe("tau3ParamsSchema", () => {
  it("accepts a standard config", () => {
    const p = tau3ParamsSchema.parse({
      domains: ["airline", "retail", "telecom"],
      numTasksPerDomain: 20,
      numTrials: 3,
      gate: { mode: "off" },
    });
    expect(p.numTrials).toBe(3);
  });
  it("accepts numTasksPerDomain null (full set)", () => {
    expect(
      tau3ParamsSchema.parse({ ...tau3ParamDefaults, numTasksPerDomain: null }).numTasksPerDomain,
    ).toBeNull();
  });
  it("rejects empty domains", () => {
    expect(() => tau3ParamsSchema.parse({ ...tau3ParamDefaults, domains: [] })).toThrow();
  });
  it("rejects numTrials > 8", () => {
    expect(() => tau3ParamsSchema.parse({ ...tau3ParamDefaults, numTrials: 9 })).toThrow();
  });
  it("perDomainFloor gate parses", () => {
    const p = tau3ParamsSchema.parse({
      ...tau3ParamDefaults,
      gate: { mode: "perDomainFloor", perDomainFloor: { airline: 0.3 } },
    });
    expect(p.gate.mode).toBe("perDomainFloor");
  });
});
describe("tau3ReportSchema", () => {
  it("parses a summary.json shape", () => {
    const r = tau3ReportSchema.parse({
      kind: "agent-tau3",
      userSimModel: "deepseek-v3",
      numTrials: 3,
      overall: { pass1: 0.4, passK: 0.3, tasks: 60 },
      perDomain: { airline: { pass1: 0.38, passK: 0.3, tasks: 20 } },
      attribution: { wrong_action: 0.5, other: 0.5 },
      highlights: {
        successSimId: "s1",
        successDomain: "airline",
        failureSimId: "s2",
        failureDomain: "retail",
      },
    });
    expect(r.overall.tasks).toBe(60);
  });
});
