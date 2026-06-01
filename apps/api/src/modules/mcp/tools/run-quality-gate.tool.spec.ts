// apps/api/src/modules/mcp/tools/run-quality-gate.tool.spec.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerRunQualityGate } from "./run-quality-gate.tool.js";

function makeServer() {
  const calls: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> = [];
  const server = {
    registerTool: (name: string, _m: unknown, h: unknown) =>
      calls.push({ name, handler: h as (i: unknown) => Promise<unknown> }),
  } as unknown as McpServer;
  return { server, calls };
}

const REQ = { evaluationId: "e1", endpointAId: "c1", gateConfig: { passRateMin: 0.8 } };

describe("run_quality_gate tool", () => {
  it("dry-run returns a plan + token and does NOT create", async () => {
    const create = vi.fn();
    const issue = vi.fn().mockReturnValue("TOK");
    const deps = {
      userId: "u1",
      runs: { create },
      confirmTokens: { issue, verify: vi.fn() },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunQualityGate(server, deps);
    const out = (await calls[0]?.handler(REQ)) as { structuredContent: { dryRun: boolean } };
    expect(create).not.toHaveBeenCalled();
    expect(issue).toHaveBeenCalledWith("run_quality_gate", REQ);
    expect(out.structuredContent.dryRun).toBe(true);
  });

  it("confirm with valid token creates the run", async () => {
    const create = vi.fn().mockResolvedValue({ id: "r1", status: "PENDING" });
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      runs: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunQualityGate(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOK" })) as {
      structuredContent: { id: string };
    };
    expect(verify).toHaveBeenCalledWith("run_quality_gate", REQ, "TOK");
    expect(create).toHaveBeenCalledWith("u1", REQ);
    expect(out.structuredContent.id).toBe("r1");
  });

  it("confirm (valid token) surfaces a create() failure as isError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    const verify = vi.fn().mockReturnValue({ ok: true });
    const deps = {
      userId: "u1",
      runs: { create },
      confirmTokens: { issue: vi.fn(), verify },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerRunQualityGate(server, deps);
    const out = (await calls[0]?.handler({ ...REQ, confirmToken: "TOK" })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain("quota exceeded");
  });
});
