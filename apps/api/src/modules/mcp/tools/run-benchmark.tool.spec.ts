// apps/api/src/modules/mcp/tools/run-benchmark.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerRunBenchmark } from "./run-benchmark.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

const REQ = {
  scenario: "inference",
  tool: "guidellm",
  connectionId: "c1",
  name: "agent run",
  params: {},
};

describe("run_benchmark tool", () => {
  it("dry-run (no token) returns a plan + confirmToken and does NOT create", async () => {
    const create = vi.fn();
    const issue = vi.fn().mockReturnValue("TOKEN123");
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue, verify: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler(REQ)) as {
      structuredContent: { dryRun: boolean; confirmToken: string };
    };
    expect(create).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith("run_benchmark", REQ);
    expect(out.structuredContent.dryRun).toBe(true);
    expect(out.structuredContent.confirmToken).toBe("TOKEN123");
  });

  it("confirm (valid token) creates the benchmark", async () => {
    const create = vi.fn().mockResolvedValue({ id: "b1", status: "running" });
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOKEN123" })) as {
      structuredContent: { id: string };
    };
    expect(verify).toHaveBeenCalledWith("run_benchmark", REQ, "TOKEN123");
    expect(create).toHaveBeenCalledWith("u1", REQ);
    expect(out.structuredContent.id).toBe("b1");
  });

  it("confirm (bad token) returns isError and does NOT create", async () => {
    const create = vi.fn();
    const verify = vi.fn().mockReturnValue({ ok: false, reason: "expired" });
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "BAD" })) as { isError?: boolean };
    expect(create).not.toHaveBeenCalled();
    expect(out.isError).toBe(true);
  });

  it("confirm (valid token) surfaces a create() failure as isError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("scenario/tool incompatible"));
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      benchmarks: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunBenchmark(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOKEN123" })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("incompatible");
  });
});
