import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetBenchmark } from "./get-benchmark.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_benchmark tool", () => {
  it("fetches a single benchmark owner-scoped", async () => {
    const findByIdOrFail = vi.fn().mockResolvedValue({ id: "b1", status: "completed" });
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetBenchmark(server, deps);
    expect(calls[0]?.name).toBe("get_benchmark");
    const out = (await calls[0]?.handler({ benchmarkId: "b1" })) as {
      structuredContent: { status: string };
    };
    expect(findByIdOrFail).toHaveBeenCalledWith("b1", "u1");
    expect(out.structuredContent.status).toBe("completed");
  });

  it("surfaces a not-found id as isError", async () => {
    const findByIdOrFail = vi.fn().mockRejectedValue(new Error("Benchmark bx not found"));
    const deps = { userId: "u1", benchmarks: { findByIdOrFail } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetBenchmark(server, deps);
    const out = (await calls[0]?.handler({ benchmarkId: "bx" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("bx not found");
  });
});
