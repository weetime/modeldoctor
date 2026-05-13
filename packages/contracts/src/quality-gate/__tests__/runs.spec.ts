import { describe, expect, it } from "vitest";
import {
  createRunRequestSchema,
  gateConfigSchema,
  gateResultSchema,
  runStatusSchema,
} from "../runs.js";

describe("gateConfigSchema", () => {
  it("requires at least one threshold", () => {
    expect(() => gateConfigSchema.parse({})).toThrow();
  });
  it("accepts passRateMin alone", () => {
    expect(gateConfigSchema.parse({ passRateMin: 0.9 })).toEqual({ passRateMin: 0.9 });
  });
});

describe("createRunRequestSchema", () => {
  it("requires evaluationId + endpointAId + gateConfig", () => {
    expect(() => createRunRequestSchema.parse({})).toThrow();
    expect(
      createRunRequestSchema.parse({
        evaluationId: "e",
        endpointAId: "a",
        gateConfig: { passRateMin: 0.9 },
      }),
    ).toBeTruthy();
  });
  it("rejects A == B", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "e",
      endpointAId: "x",
      endpointBId: "x",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.endpointABMustDiffer");
    }
  });

  it("accepts baselineRunIdOverride alone (no endpointBId)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      baselineRunIdOverride: "run-xyz",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts undefined baselineRunIdOverride (falls back to evaluation pin)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects endpointBId + baselineRunIdOverride combination", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      endpointBId: "b",
      baselineRunIdOverride: "run-xyz",
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("validation.runDualVsBaselineExclusive");
    }
  });

  it("accepts endpointBId + baselineRunIdOverride=null (explicit skip)", () => {
    const r = createRunRequestSchema.safeParse({
      evaluationId: "ev",
      endpointAId: "a",
      endpointBId: "b",
      baselineRunIdOverride: null,
      gateConfig: { passRateMin: 0.9 },
    });
    expect(r.success).toBe(true);
  });
});

describe("enums", () => {
  it("status enum", () => {
    expect(runStatusSchema.parse("RUNNING")).toBe("RUNNING");
  });
  it("gate result enum", () => {
    expect(gateResultSchema.parse("WARNING")).toBe("WARNING");
  });
});
