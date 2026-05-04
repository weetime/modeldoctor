import { describe, expect, it } from "vitest";
import { byTool } from "./core/registry.js";
import {
  SCENARIOS,
  applyScenarioConstraints,
  assertScenariosInvariant,
  type ScenarioId,
} from "./scenarios.js";

describe("SCENARIOS constant", () => {
  it("declares inference, capacity, gateway", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(["capacity", "gateway", "inference"]);
  });

  it("inference scenario lists guidellm and genai-perf", () => {
    expect([...SCENARIOS.inference.tools].sort()).toEqual(["genai-perf", "guidellm"]);
  });

  it("capacity scenario lists guidellm only", () => {
    expect(SCENARIOS.capacity.tools).toEqual(["guidellm"]);
  });

  it("gateway scenario lists vegeta only", () => {
    expect(SCENARIOS.gateway.tools).toEqual(["vegeta"]);
  });
});

describe("invariant: SCENARIOS.tools ⊆ adapters that declare the scenario", () => {
  it("every tool in SCENARIOS[s].tools has s in its adapter.scenarios", () => {
    for (const [scenarioId, cfg] of Object.entries(SCENARIOS)) {
      for (const tool of cfg.tools) {
        const adapter = byTool(tool);
        expect(adapter.scenarios).toContain(scenarioId as ScenarioId);
      }
    }
  });

  it("every adapter scenario is mirrored in SCENARIOS[s].tools", () => {
    for (const tool of ["guidellm", "vegeta", "genai-perf"] as const) {
      const adapter = byTool(tool);
      for (const scenarioId of adapter.scenarios) {
        expect(SCENARIOS[scenarioId].tools).toContain(tool);
      }
    }
  });

  it("assertScenariosInvariant passes for the current registry", () => {
    expect(() => assertScenariosInvariant()).not.toThrow();
  });
});

describe("applyScenarioConstraints", () => {
  it("inference + guidellm narrows rateType to non-sweep values", () => {
    const merged = applyScenarioConstraints("inference", "guidellm");
    const rateTypeSchema = merged.shape.rateType;
    expect(() => rateTypeSchema.parse("sweep")).toThrow();
    expect(() => rateTypeSchema.parse("constant")).not.toThrow();
  });

  it("capacity + guidellm forces rateType=sweep", () => {
    const merged = applyScenarioConstraints("capacity", "guidellm");
    expect(() => merged.shape.rateType.parse("sweep")).not.toThrow();
    expect(() => merged.shape.rateType.parse("constant")).toThrow();
  });

  it("gateway + vegeta has no rateType (returns base schema)", () => {
    const merged = applyScenarioConstraints("gateway", "vegeta");
    expect(merged).toBeDefined();
  });

  it("throws when scenario+tool combination is invalid", () => {
    expect(() => applyScenarioConstraints("capacity", "vegeta")).toThrow(
      /scenario 'capacity' does not support tool 'vegeta'/,
    );
  });
});
