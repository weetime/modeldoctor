// apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetEngineMetricCatalog } from "./get-engine-metric-catalog.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_engine_metric_catalog tool", () => {
  it("registers under the expected name", () => {
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, {} as McpToolDeps);
    expect(calls[0]?.name).toBe("get_engine_metric_catalog");
  });

  it("returns the manifest for the connection's serverKind", async () => {
    const findOwnedPublic = vi.fn().mockResolvedValue({ serverKind: "vllm" });
    const deps = { userId: "u1", connections: { findOwnedPublic } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, deps);
    const out = (await calls[0]?.handler({ connectionId: "c1" })) as {
      structuredContent: { engineId?: string; metrics?: unknown[] };
    };
    expect(findOwnedPublic).toHaveBeenCalledWith("u1", "c1");
    expect(out.structuredContent.engineId).toBe("vllm");
    expect(Array.isArray(out.structuredContent.metrics)).toBe(true);
  });

  it("returns isError when the connection has no manifest", async () => {
    const deps = {
      userId: "u1",
      connections: { findOwnedPublic: vi.fn().mockResolvedValue({ serverKind: null }) },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, deps);
    const out = (await calls[0]?.handler({ connectionId: "c1" })) as { isError?: boolean };
    expect(out.isError).toBe(true);
  });

  it("surfaces a not-found connection as isError", async () => {
    const deps = {
      userId: "u1",
      connections: {
        findOwnedPublic: vi.fn().mockRejectedValue(new Error("Connection cx not found")),
      },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetEngineMetricCatalog(server, deps);
    const out = (await calls[0]?.handler({ connectionId: "cx" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("cx not found");
  });
});
