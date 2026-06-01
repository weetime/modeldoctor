// apps/api/src/modules/mcp/tools/query-prometheus.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerQueryPrometheus } from "./query-prometheus.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _meta: unknown, handler: unknown) =>
      calls.push({ name, handler: handler as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("query_prometheus tool", () => {
  it("registers under the expected name", () => {
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, {} as McpToolDeps);
    expect(calls[0]?.name).toBe("query_prometheus");
  });

  it("resolves the datasource then runs the query", async () => {
    const ds = { id: "ds1", name: "p" };
    const resolveDatasourceByRef = vi.fn().mockResolvedValue(ds);
    const runQuery = vi.fn().mockResolvedValue({
      datasource: ds,
      query: "up",
      kind: "instant",
      truncated: false,
      series: [],
    });
    const deps = { promFetcher: { resolveDatasourceByRef, runQuery } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);

    const out = (await calls[0]?.handler({ connectionId: "c1", query: "up" })) as {
      structuredContent: { kind: string };
    };
    expect(resolveDatasourceByRef).toHaveBeenCalledWith({
      connectionId: "c1",
      datasourceId: undefined,
    });
    expect(runQuery).toHaveBeenCalledWith(ds, "up", { kind: "instant" });
    expect(out.structuredContent.kind).toBe("instant");
  });

  it("returns isError when no datasource resolves", async () => {
    const deps = {
      promFetcher: { resolveDatasourceByRef: vi.fn().mockResolvedValue(null), runQuery: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);
    const out = (await calls[0]?.handler({ query: "up" })) as { isError?: boolean };
    expect(out.isError).toBe(true);
  });

  it("forwards a range query with from/to/step", async () => {
    const ds = { id: "ds1", name: "p" };
    const runQuery = vi.fn().mockResolvedValue({
      datasource: ds,
      query: "up",
      kind: "range",
      truncated: false,
      series: [],
    });
    const deps = {
      promFetcher: { resolveDatasourceByRef: vi.fn().mockResolvedValue(ds), runQuery },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);
    await calls[0]?.handler({
      datasourceId: "ds1",
      query: "up",
      range: { from: "2026-06-01T00:00:00Z", to: "2026-06-01T01:00:00Z", step: 60 },
    });
    expect(runQuery).toHaveBeenCalledWith(ds, "up", {
      kind: "range",
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-01T01:00:00Z"),
      step: 60,
    });
  });

  it("surfaces a thrown runQuery as isError instead of propagating", async () => {
    const ds = { id: "ds1", name: "p" };
    const deps = {
      promFetcher: {
        resolveDatasourceByRef: vi.fn().mockResolvedValue(ds),
        runQuery: vi.fn().mockRejectedValue(new Error("prom 502")),
      },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerQueryPrometheus(server, deps);
    const out = (await calls[0]?.handler({ datasourceId: "ds1", query: "up" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("prom 502");
  });
});
