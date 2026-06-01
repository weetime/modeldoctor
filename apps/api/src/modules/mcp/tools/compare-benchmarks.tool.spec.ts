import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerCompareBenchmarks } from "./compare-benchmarks.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("compare_benchmarks tool", () => {
  it("fetches each benchmark (owner-scoped) and returns an aligned table", async () => {
    const findByIdOrFail = vi
      .fn()
      .mockResolvedValueOnce({ id: "b1", name: "A", summaryMetrics: { "e2e.p95": 100 } })
      .mockResolvedValueOnce({ id: "b2", name: "B", summaryMetrics: { "e2e.p95": 120 } });
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerCompareBenchmarks(server, deps);
    const out = (await calls[0]?.handler({ benchmarkIds: ["b1", "b2"] })) as {
      structuredContent: { rows: Array<{ metric: string; values: unknown[] }> };
    };
    expect(findByIdOrFail).toHaveBeenCalledWith("b1", "u1");
    expect(findByIdOrFail).toHaveBeenCalledWith("b2", "u1");
    expect(out.structuredContent.rows[0]).toEqual({ metric: "e2e.p95", values: [100, 120] });
  });

  it("surfaces a not-found id as isError instead of propagating", async () => {
    const findByIdOrFail = vi
      .fn()
      .mockResolvedValueOnce({ id: "b1", name: "A", summaryMetrics: {} })
      .mockRejectedValueOnce(new Error("Benchmark b2 not found"));
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerCompareBenchmarks(server, deps);
    const out = (await calls[0]?.handler({ benchmarkIds: ["b1", "b2"] })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("b2 not found");
  });
});
