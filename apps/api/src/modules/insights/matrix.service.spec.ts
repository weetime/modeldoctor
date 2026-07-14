import { describe, expect, it, vi } from "vitest";
import { MatrixService } from "./matrix.service.js";

const rules = { checks: { "inference.ttft.p95.ms": { warn: 100, crit: 300, weight: 1 } } };

// Metric shape matches the guidellm adapter read by `readMetricSafe`
// (see apps/web/src/features/insights/__tests__/buildFindings.test.ts).
const guidellmMetrics = {
  tool: "guidellm",
  data: {
    ttft: { p95: 120, p99: 160 },
    e2eLatency: { p95: 2000, p99: 4000 },
    requests: { total: 1000, error: 5 },
    requestsPerSecond: { mean: 12 },
  },
};

function connection(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    name: `n-${id}`,
    model: "m",
    baseUrl: "http://x",
    category: "chat",
    serverKind: "vllm",
    ...overrides,
  };
}

function svc(rows: unknown[], profileRules: unknown = rules) {
  const prisma = {
    benchmark: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  };
  const profiles = { getBySlug: vi.fn().mockResolvedValue({ rules: profileRules }) };
  return new MatrixService(prisma as never, profiles as never);
}

describe("MatrixService.getMatrix", () => {
  it("returns one endpoint x one scenario dim with a cell (no metrics -> null scoring)", async () => {
    const s = svc([
      {
        id: "r1",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: { tool: "guidellm", data: {} },
        createdAt: new Date(),
        connection: connection("c1"),
      },
    ]);
    const res = await s.getMatrix("u1", {
      aggregate: "scenario",
      range: "30d",
      profileSlug: "default",
    });
    expect(res.aggregate).toBe("scenario");
    expect(res.endpoints).toHaveLength(1);
    expect(res.dimensions.map((d) => d.key)).toContain("inference");
    const cell = res.cells.find((c) => c.endpointId === "c1" && c.dimKey === "inference");
    expect(cell?.runs).toBe(1);
  });

  it("scores real guidellm metrics against profile rules (score/band/nativeMetric non-null)", async () => {
    const scoringRules = {
      checks: {
        "inference.ttft.p95.ms": { warn: 200, crit: 500, weight: 1 },
        "inference.e2e.p95.ms": { warn: 1000, crit: 3000, weight: 1 },
      },
    };
    const s = svc(
      [
        {
          id: "r1",
          scenario: "inference",
          status: "completed",
          tool: "guidellm",
          summaryMetrics: guidellmMetrics,
          createdAt: new Date(),
          connection: connection("c1"),
        },
      ],
      scoringRules,
    );
    const res = await s.getMatrix("u1", {
      aggregate: "scenario",
      range: "30d",
      profileSlug: "default",
    });
    const cell = res.cells.find((c) => c.endpointId === "c1" && c.dimKey === "inference");
    expect(cell).toBeDefined();
    // ttft.p95=120 vs warn200/crit500 -> good (1.0); e2e.p95=2000 vs warn1000/crit3000 -> warn (0.5)
    // weighted avg = (1.0*1 + 0.5*1) / 2 = 0.75 -> score 75
    expect(cell?.score).toBe(75);
    expect(cell?.band).toBe("usable");
    expect(["recommended", "usable", "not-recommended"]).toContain(cell?.band);
    expect(cell?.nativeMetric).toEqual({ kind: "e2e.p95", value: 2000, unit: "ms" });
  });

  it("counts dimension endpoints distinctly across connections, not per cell/row", async () => {
    const s = svc([
      {
        id: "r1",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: guidellmMetrics,
        createdAt: new Date(),
        connection: connection("c1"),
      },
      {
        id: "r2",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: guidellmMetrics,
        createdAt: new Date(),
        connection: connection("c2"),
      },
      // A second row on the SAME connection/scenario must not inflate the count.
      {
        id: "r3",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: guidellmMetrics,
        createdAt: new Date(),
        connection: connection("c1"),
      },
    ]);
    const res = await s.getMatrix("u1", {
      aggregate: "scenario",
      range: "30d",
      profileSlug: "default",
    });
    expect(res.endpoints).toHaveLength(2);
    const inferenceDim = res.dimensions.find((d) => d.key === "inference");
    expect(inferenceDim?.count).toBe(2);
  });

  it("exercises the aggregate === scenario ? filtered : all branch on both sides", async () => {
    const rows = [
      {
        id: "r1",
        scenario: "inference",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: guidellmMetrics,
        createdAt: new Date(),
        connection: connection("c1"),
      },
      {
        id: "r2",
        scenario: "gateway",
        status: "completed",
        tool: "guidellm",
        summaryMetrics: { tool: "guidellm", data: {} },
        createdAt: new Date(),
        connection: connection("c1"),
      },
    ];
    const scoringRules = {
      checks: {
        "inference.ttft.p95.ms": { warn: 200, crit: 500, weight: 1 },
        "inference.e2e.p95.ms": { warn: 1000, crit: 3000, weight: 1 },
      },
    };
    const s = svc(rows, scoringRules);

    // aggregate: "tool" groups both runs (same tool="guidellm") into ONE cell keyed
    // by dimKey "guidellm" (not a scenario) -> the code must NOT filter findings by
    // dimKey here (that would always be empty/null), it must score against ALL findings.
    const toolRes = await s.getMatrix("u1", {
      aggregate: "tool",
      range: "30d",
      profileSlug: "default",
    });
    const toolCell = toolRes.cells.find((c) => c.endpointId === "c1" && c.dimKey === "guidellm");
    expect(toolCell?.runs).toBe(2);
    expect(typeof toolCell?.score).toBe("number");
    expect(toolCell?.score).not.toBeNull();

    // A scenario-aggregate call over the SAME rows must instead split into
    // separate per-scenario cells and filter findings by that scenario.
    const scenarioRes = await s.getMatrix("u1", {
      aggregate: "scenario",
      range: "30d",
      profileSlug: "default",
    });
    const c1Cells = scenarioRes.cells.filter((c) => c.endpointId === "c1");
    expect(c1Cells).toHaveLength(2);
    expect(c1Cells.map((c) => c.dimKey).sort()).toEqual(["gateway", "inference"]);
    const inferenceCell = c1Cells.find((c) => c.dimKey === "inference");
    const gatewayCell = c1Cells.find((c) => c.dimKey === "gateway");
    expect(inferenceCell?.runs).toBe(1);
    expect(gatewayCell?.runs).toBe(1);
    // The profile only has inference rules, so the scenario-filtered gateway
    // cell has nothing but no_data findings -> null score, unlike the
    // unfiltered tool cell above which picked up the inference scoring.
    expect(gatewayCell?.score).toBeNull();
    expect(inferenceCell?.score).toBe(75);
  });
});
