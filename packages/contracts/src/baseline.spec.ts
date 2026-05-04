import { describe, expect, it } from "vitest";
import {
  baselineSchema,
  baselineSummarySchema,
  createBaselineSchema,
  listBaselinesResponseSchema,
} from "./baseline.js";

describe("baselineSchema", () => {
  it("accepts a complete row", () => {
    const ok = baselineSchema.parse({
      id: "b_1",
      userId: "u_1",
      benchmarkId: "bm_1",
      name: "throughput-anchor",
      description: "first known-good qwen2.5 benchmark",
      tags: ["qwen", "throughput"],
      templateId: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    expect(ok.id).toBe("b_1");
    expect(ok.tags).toEqual(["qwen", "throughput"]);
    expect(ok.active).toBe(true);
  });

  it("requires userId, benchmarkId, name, active, timestamps", () => {
    expect(() =>
      baselineSchema.parse({
        id: "b_1",
        // userId missing
        benchmarkId: "bm_1",
        name: "x",
        tags: [],
        templateId: null,
        active: true,
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      } as unknown),
    ).toThrow();
  });
});

describe("baselineSummarySchema", () => {
  it("is the {id, name, createdAt} subset", () => {
    const summary = baselineSummarySchema.parse({
      id: "b_1",
      name: "throughput-anchor",
      createdAt: "2026-05-02T00:00:00.000Z",
    });
    expect(summary.id).toBe("b_1");
    expect(summary.name).toBe("throughput-anchor");
  });
});

describe("createBaselineSchema", () => {
  it("accepts the minimal payload (benchmarkId + name only)", () => {
    const out = createBaselineSchema.parse({ benchmarkId: "bm_1", name: "smoke" });
    expect(out.benchmarkId).toBe("bm_1");
    expect(out.name).toBe("smoke");
    expect(out.tags).toEqual([]);
    expect(out.description).toBeUndefined();
  });

  it("accepts description + tags", () => {
    const out = createBaselineSchema.parse({
      benchmarkId: "bm_1",
      name: "smoke",
      description: "the good benchmark",
      tags: ["a", "b"],
    });
    expect(out.description).toBe("the good benchmark");
    expect(out.tags).toEqual(["a", "b"]);
  });

  it("rejects empty name", () => {
    expect(() => createBaselineSchema.parse({ benchmarkId: "bm_1", name: "" })).toThrow();
  });

  it("rejects name longer than 200 chars", () => {
    expect(() =>
      createBaselineSchema.parse({ benchmarkId: "bm_1", name: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("listBaselinesResponseSchema", () => {
  it("wraps an items array", () => {
    const out = listBaselinesResponseSchema.parse({ items: [] });
    expect(out.items).toEqual([]);
  });
});
