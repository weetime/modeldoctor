import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerListPrometheusDatasources } from "./list-prometheus-datasources.tool.js";

// Capture the handler that registerListPrometheusDatasources passes to the
// SDK's `registerTool`. We don't need a real McpServer — the wrapper in
// `_register.ts` calls `server.registerTool(name, meta, handler)` and that
// signature is all we have to satisfy.
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

describe("list_prometheus_datasources tool", () => {
  it("registers with the expected name + title + description", () => {
    const { server, calls } = makeServer();
    registerListPrometheusDatasources(server, {} as McpToolDeps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("list_prometheus_datasources");
    expect(calls[0]?.meta.title).toBe("List Prometheus datasources");
    expect(calls[0]?.meta.description.length).toBeGreaterThan(20);
    // No input args.
    expect(calls[0]?.meta.inputSchema).toBeUndefined();
  });

  it("forwards an actor with isAdmin=false and maps the slim row shape", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          id: "ds1",
          name: "primary",
          baseUrl: "https://p.example.com",
          bearerPreview: "abc...wxyz",
          customHeaders: "X-Foo: bar",
          isDefault: true,
          consumersCount: 2,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "ds2",
          name: "secondary",
          baseUrl: "https://p2.example.com",
          bearerPreview: "",
          customHeaders: "",
          isDefault: false,
          consumersCount: 0,
          createdAt: "2026-01-03T00:00:00.000Z",
          updatedAt: "2026-01-04T00:00:00.000Z",
        },
      ],
    });
    const deps = {
      userId: "u1",
      prometheusDatasources: { list },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerListPrometheusDatasources(server, deps);

    const result = (await calls[0]?.handler(undefined)) as {
      content: Array<{ type: "text"; text: string }>;
      structuredContent: { items: Array<Record<string, unknown>> };
    };

    expect(list).toHaveBeenCalledWith({ sub: "u1", isAdmin: false });
    expect(result.structuredContent).toEqual({
      items: [
        {
          id: "ds1",
          name: "primary",
          baseUrl: "https://p.example.com",
          bearerPreview: "abc...wxyz",
          isDefault: true,
          consumersCount: 2,
        },
        {
          id: "ds2",
          name: "secondary",
          baseUrl: "https://p2.example.com",
          bearerPreview: "",
          isDefault: false,
          consumersCount: 0,
        },
      ],
    });
    // Strips secret-adjacent fields (customHeaders, createdAt, updatedAt)
    // from the lean wire shape — they're not in the slim row.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("customHeaders");
    expect(text).not.toContain("createdAt");
  });
});
