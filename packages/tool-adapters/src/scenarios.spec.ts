import { describe, expect, it } from "vitest";
import { byTool } from "./core/registry.js";
import { guidellmParamsSchema } from "./guidellm/schema.js";
import {
  SCENARIOS,
  type ScenarioId,
  applyScenarioConstraints,
  assertScenariosInvariant,
} from "./scenarios.js";

describe("SCENARIOS constant", () => {
  it("declares all known scenarios", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([
      "capacity",
      "gateway",
      "inference",
      "kv-cache-stress",
      "prefix-cache-validation",
    ]);
  });

  it("kv-cache-stress scenario lists evalscope alongside the legacy kv-cache-stress tool", () => {
    expect([...SCENARIOS["kv-cache-stress"].tools].sort()).toEqual([
      "evalscope",
      "kv-cache-stress",
    ]);
  });

  it("inference scenario lists guidellm, genai-perf, evalscope, and aiperf", () => {
    expect([...SCENARIOS.inference.tools].sort()).toEqual([
      "aiperf",
      "evalscope",
      "genai-perf",
      "guidellm",
    ]);
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

  it("gateway + vegeta has no rateType (returns base schema that still validates)", () => {
    const merged = applyScenarioConstraints("gateway", "vegeta");
    // Valid minimal vegeta params (path + body now required — see
    // packages/tool-adapters/src/vegeta/schema.ts).
    expect(() =>
      merged.parse({
        apiType: "chat",
        rate: 10,
        duration: 30,
        path: "/v1/chat/completions",
        body: '{"model":"m","messages":[]}',
      }),
    ).not.toThrow();
    // Missing required `rate` — base schema must still reject it.
    expect(() =>
      merged.parse({
        apiType: "chat",
        duration: 30,
        path: "/v1/chat/completions",
        body: '{"model":"m","messages":[]}',
      }),
    ).toThrow();
  });

  it("throws when scenario+tool combination is invalid", () => {
    expect(() => applyScenarioConstraints("capacity", "vegeta")).toThrow(
      /scenario 'capacity' does not support tool 'vegeta'/,
    );
  });

  it("DROPS guidellm's superRefine (random dataset cross-field check)", () => {
    // This documents that `applyScenarioConstraints` drops `superRefine`.
    // Callers needing full validation must also run the original
    // adapter.paramsSchema. See JSDoc on applyScenarioConstraints.
    //
    // The merged schema unwraps ZodEffects to call .merge(), which loses
    // any chained `superRefine` / `refine`. guidellm's check that "random
    // dataset requires datasetInputTokens / datasetOutputTokens" is one
    // such rule — it does NOT survive the unwrap.
    const merged = applyScenarioConstraints("inference", "guidellm");
    const inputMissingTokenFields = {
      datasetName: "random" as const,
      profile: "throughput" as const,
      apiType: "chat" as const,
      rateType: "constant" as const,
      requestRate: 0,
      totalRequests: 1000,
      maxDurationSeconds: 1800,
      maxConcurrency: 100,
      validateBackend: false,
    };
    // Merged schema: refinement was dropped, so this passes despite the
    // missing token fields.
    expect(() => merged.parse(inputMissingTokenFields)).not.toThrow();
    // Original adapter schema: refinement is intact, so this throws.
    expect(() => guidellmParamsSchema.parse(inputMissingTokenFields)).toThrow(
      /datasetInputTokens|datasetOutputTokens/,
    );
  });
});
