import { describe, expect, it } from "vitest";
import { createRunRequestSchema, gateConfigSchema, runStatusSchema, gateResultSchema } from "../runs.js";

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
    expect(createRunRequestSchema.parse({ evaluationId: "e", endpointAId: "a", gateConfig: { passRateMin: 0.9 } })).toBeTruthy();
  });
  it("rejects A == B", () => {
    expect(() =>
      createRunRequestSchema.parse({ evaluationId: "e", endpointAId: "x", endpointBId: "x", gateConfig: { passRateMin: 0.9 } }),
    ).toThrow(/different/);
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
