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
      runId: "r_1",
      name: "throughput-anchor",
      description: "first known-good qwen2.5 benchmark",
      tags: ["qwen", "throughput"],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    expect(ok.id).toBe("b_1");
    expect(ok.tags).toEqual(["qwen", "throughput"]);
    expect(ok.active).toBe(true);
  });

  it("requires userId, runId, name, active, timestamps", () => {
    expect(() =>
      baselineSchema.parse({
        id: "b_1",
        // userId missing
        runId: "r_1",
        name: "x",
        tags: [],
        templateId: null,
        templateVersion: null,
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
  it("accepts the minimal payload (runId + name only)", () => {
    const out = createBaselineSchema.parse({ runId: "r_1", name: "smoke" });
    expect(out.runId).toBe("r_1");
    expect(out.name).toBe("smoke");
    expect(out.tags).toEqual([]);
    expect(out.description).toBeUndefined();
  });

  it("accepts description + tags", () => {
    const out = createBaselineSchema.parse({
      runId: "r_1",
      name: "smoke",
      description: "the good run",
      tags: ["a", "b"],
    });
    expect(out.description).toBe("the good run");
    expect(out.tags).toEqual(["a", "b"]);
  });

  it("rejects empty name", () => {
    expect(() => createBaselineSchema.parse({ runId: "r_1", name: "" })).toThrow();
  });

  it("rejects name longer than 200 chars", () => {
    expect(() => createBaselineSchema.parse({ runId: "r_1", name: "x".repeat(201) })).toThrow();
  });
});

describe("listBaselinesResponseSchema", () => {
  it("wraps an items array", () => {
    const out = listBaselinesResponseSchema.parse({ items: [] });
    expect(out.items).toEqual([]);
  });
});

import { listRunsQuerySchema, runSchema } from "./run.js";

describe("runSchema (post-#43 additions)", () => {
  it("accepts baselineFor as null", () => {
    const r = runSchema.parse({ ...minimalRun(), baselineFor: null });
    expect(r.baselineFor).toBeNull();
  });

  it("accepts baselineFor as a BaselineSummary", () => {
    const r = runSchema.parse({
      ...minimalRun(),
      baselineFor: { id: "b_1", name: "anchor", createdAt: "2026-05-02T00:00:00.000Z" },
    });
    expect(r.baselineFor?.id).toBe("b_1");
  });

  it("rejects baselineFor with extra fields shaped wrong", () => {
    expect(() =>
      runSchema.parse({ ...minimalRun(), baselineFor: { id: 123 } as unknown }),
    ).toThrow();
  });
});

describe("listRunsQuerySchema (post-#43 additions)", () => {
  it("accepts isBaseline boolean", () => {
    const out = listRunsQuerySchema.parse({ isBaseline: true });
    expect(out.isBaseline).toBe(true);
  });

  it("accepts referencesBaseline boolean", () => {
    const out = listRunsQuerySchema.parse({ referencesBaseline: true });
    expect(out.referencesBaseline).toBe(true);
  });

  it("coerces string 'true' / 'false' (URL-encoded) to boolean", () => {
    const out = listRunsQuerySchema.parse({ isBaseline: "true" });
    expect(out.isBaseline).toBe(true);
    const out2 = listRunsQuerySchema.parse({ referencesBaseline: "false" });
    expect(out2.referencesBaseline).toBe(false);
  });
});

function minimalRun() {
  return {
    id: "r1",
    userId: "u1",
    connectionId: null,
    connection: null,
    kind: "benchmark" as const,
    tool: "guidellm" as const,
    scenario: {},
    mode: "fixed" as const,
    driverKind: "local" as const,
    name: null,
    description: null,
    status: "completed" as const,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-02T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null as null | { id: string; name: string; createdAt: string },
  };
}
