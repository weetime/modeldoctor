import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerGetQualityGateRun } from "./get-quality-gate-run.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

describe("get_quality_gate_run tool", () => {
  it("fetches a single run owner-scoped", async () => {
    const get = vi.fn().mockResolvedValue({ id: "r1", status: "COMPLETED", gateResult: "PASSED" });
    const deps = { userId: "u1", runs: { get } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetQualityGateRun(server, deps);
    expect(calls[0]?.name).toBe("get_quality_gate_run");
    const out = (await calls[0]?.handler({ runId: "r1" })) as {
      structuredContent: { gateResult: string };
    };
    expect(get).toHaveBeenCalledWith("u1", "r1");
    expect(out.structuredContent.gateResult).toBe("PASSED");
  });

  it("surfaces a not-found id as isError", async () => {
    const get = vi.fn().mockRejectedValue(new Error("run rx not found"));
    const deps = { userId: "u1", runs: { get } } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerGetQualityGateRun(server, deps);
    const out = (await calls[0]?.handler({ runId: "rx" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("rx not found");
  });
});
