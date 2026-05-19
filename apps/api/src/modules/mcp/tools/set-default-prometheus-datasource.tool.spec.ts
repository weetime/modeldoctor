import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerSetDefaultPrometheusDatasource } from "./set-default-prometheus-datasource.tool.js";

// Same captured-handler shim as the sibling tool specs — we don't need a
// real McpServer, just to record what the wrapper passed to `registerTool`.
function makeServer() {
  const calls: Array<{
    name: string;
    meta: { title: string; description: string; inputSchema?: unknown };
    handler: (input: unknown) => Promise<unknown>;
  }> = [];
  const server = {
    registerTool: (name: string, meta: unknown, handler: unknown) => {
      calls.push({
        name,
        meta: meta as { title: string; description: string; inputSchema?: unknown },
        handler: handler as (input: unknown) => Promise<unknown>,
      });
    },
  } as unknown as McpServer;
  return { server, calls };
}

describe("set_default_prometheus_datasource tool", () => {
  it("registers with the expected name + title + description + input shape", () => {
    const { server, calls } = makeServer();
    registerSetDefaultPrometheusDatasource(server, {} as McpToolDeps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("set_default_prometheus_datasource");
    expect(calls[0]?.meta.title).toBe("Set the default Prometheus datasource");
    expect(calls[0]?.meta.description.length).toBeGreaterThan(20);
    // datasourceId is the single required input.
    expect(calls[0]?.meta.inputSchema).toBeDefined();
  });

  it("forwards isAdmin from deps into the service actor (admin path)", async () => {
    const setDefault = vi.fn().mockResolvedValue({
      id: "ds1",
      name: "primary",
      baseUrl: "https://p.example.com",
      bearerPreview: "abc...wxyz",
      customHeaders: "",
      isDefault: true,
      consumersCount: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const deps = {
      userId: "u_admin",
      isAdmin: true,
      prometheusDatasources: { setDefault },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerSetDefaultPrometheusDatasource(server, deps);

    const result = (await calls[0]?.handler({ datasourceId: "ds1" })) as {
      content: Array<{ type: "text"; text: string }>;
      structuredContent: Record<string, unknown>;
    };

    // Service receives the resolved isAdmin (the WHOLE point of the deps
    // change in this PR) and the datasourceId from input.
    expect(setDefault).toHaveBeenCalledWith({ sub: "u_admin", isAdmin: true }, "ds1");
    // Wire shape is the slim subset — no createdAt/updatedAt/customHeaders.
    expect(result.structuredContent).toEqual({
      id: "ds1",
      name: "primary",
      baseUrl: "https://p.example.com",
      isDefault: true,
      consumersCount: 3,
    });
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("customHeaders");
    expect(text).not.toContain("bearerPreview");
  });

  it("propagates isAdmin=false → service rejection surfaces to the caller", async () => {
    // Non-admin path: the service raises ForbiddenException; the tool does
    // not catch it (the SDK turns thrown errors into JSON-RPC errors). We
    // lock that the rejection makes it through unmolested rather than being
    // silently swallowed or downgraded.
    const setDefault = vi.fn().mockRejectedValue(new Error("admin role required"));
    const deps = {
      userId: "u_viewer",
      isAdmin: false,
      prometheusDatasources: { setDefault },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerSetDefaultPrometheusDatasource(server, deps);

    await expect(calls[0]?.handler({ datasourceId: "ds1" })).rejects.toThrow(
      /admin role required/i,
    );
    expect(setDefault).toHaveBeenCalledWith({ sub: "u_viewer", isAdmin: false }, "ds1");
  });
});
