import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpToolDeps } from "../mcp.service.js";
import { registerSetConnectionPrometheusSource } from "./set-connection-prometheus-source.tool.js";

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

describe("set_connection_prometheus_source tool", () => {
  it("registers with the expected name + title + input shape", () => {
    const { server, calls } = makeServer();
    registerSetConnectionPrometheusSource(server, {} as McpToolDeps);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("set_connection_prometheus_source");
    expect(calls[0]?.meta.title).toBe("Set a connection's Prometheus datasource");
    expect(calls[0]?.meta.description).toContain("kind=alertmanager");
    // inputShape forwarded into the meta.inputSchema slot by `registerTool`
    expect(calls[0]?.meta.inputSchema).toBeDefined();
  });

  it("forwards undefined datasourceId to service (so the service applies the default)", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "c1",
      name: "m",
      kind: "model",
      prometheusDatasourceId: "ds1",
      prometheusDatasource: { id: "ds1", name: "default", baseUrl: "https://p.com" },
    });
    const deps = {
      userId: "u1",
      connections: { update },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerSetConnectionPrometheusSource(server, deps);

    const result = (await calls[0]?.handler({ connectionId: "c1" })) as {
      structuredContent: {
        id: string;
        kind: string;
        prometheusDatasourceId: string | null;
        prometheusDatasource: { id: string; name: string; baseUrl: string } | null;
      };
    };

    expect(update).toHaveBeenCalledWith("u1", "c1", { prometheusDatasourceId: undefined });
    expect(result.structuredContent.prometheusDatasourceId).toBe("ds1");
    expect(result.structuredContent.prometheusDatasource).toEqual({
      id: "ds1",
      name: "default",
      baseUrl: "https://p.com",
    });
  });

  it("forwards null to unbind", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "c1",
      name: "m",
      kind: "model",
      prometheusDatasourceId: null,
      prometheusDatasource: null,
    });
    const deps = {
      userId: "u1",
      connections: { update },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerSetConnectionPrometheusSource(server, deps);

    const result = (await calls[0]?.handler({
      connectionId: "c1",
      datasourceId: null,
    })) as {
      structuredContent: {
        prometheusDatasourceId: string | null;
        prometheusDatasource: unknown;
      };
    };

    expect(update).toHaveBeenCalledWith("u1", "c1", { prometheusDatasourceId: null });
    expect(result.structuredContent.prometheusDatasourceId).toBeNull();
    expect(result.structuredContent.prometheusDatasource).toBeNull();
  });

  it("forwards a string datasourceId verbatim", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "c1",
      name: "m",
      kind: "gateway",
      prometheusDatasourceId: "ds2",
      prometheusDatasource: { id: "ds2", name: "secondary", baseUrl: "https://p2.com" },
    });
    const deps = {
      userId: "u1",
      connections: { update },
    } as unknown as McpToolDeps;
    const { server, calls } = makeServer();
    registerSetConnectionPrometheusSource(server, deps);

    await calls[0]?.handler({ connectionId: "c1", datasourceId: "ds2" });
    expect(update).toHaveBeenCalledWith("u1", "c1", { prometheusDatasourceId: "ds2" });
  });
});
