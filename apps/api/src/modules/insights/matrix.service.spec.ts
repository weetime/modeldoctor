import { describe, expect, it, vi } from "vitest";
import { MatrixService } from "./matrix.service.js";

const rules = { checks: { "inference.ttft.p95.ms": { warn: 100, crit: 300, weight: 1 } } };

function svc() {
  const prisma = {
    benchmark: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "r1",
          scenario: "inference",
          status: "completed",
          tool: "guidellm",
          summaryMetrics: { tool: "guidellm", data: {} },
          createdAt: new Date(),
          connection: {
            id: "c1",
            name: "n",
            model: "m",
            baseUrl: "http://x",
            category: "chat",
            serverKind: "vllm",
          },
        },
      ]),
    },
  };
  const profiles = { getBySlug: vi.fn().mockResolvedValue({ rules }) };
  return new MatrixService(prisma as never, profiles as never);
}

describe("MatrixService.getMatrix", () => {
  it("returns one endpoint x one scenario dim with a cell", async () => {
    const res = await svc().getMatrix("u1", {
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
});
