import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

/**
 * `list_prometheus_datasources` — surface the admin-managed Prometheus
 * datasource registry so an agent can pick one to bind to a Connection via
 * `set_connection_prometheus_source`. The row where `isDefault=true` is the
 * one new connections auto-bind to when the caller doesn't specify an id
 * explicitly. `bearerCipher` / `bearerToken` are NEVER returned — only the
 * redacted `bearerPreview` (`abc...wxyz` or `""`).
 *
 * Listing is intentionally not admin-gated (the underlying service exposes
 * the registry to every authenticated user) — admins are still the only role
 * that can mutate it via the REST endpoints. The MCP-side actor passes
 * `isAdmin: false` because the guard stamps a bare user id only.
 */
export function registerListPrometheusDatasources(server: McpServer, deps: McpToolDeps): void {
  registerTool<undefined>(
    server,
    {
      name: "list_prometheus_datasources",
      title: "List Prometheus datasources",
      description:
        "List every Prometheus datasource configured in ModelDoctor. The row " +
        "where isDefault=true is the one new connections will auto-bind to. " +
        "Use set_connection_prometheus_source to change a connection's binding. " +
        "bearerToken is NEVER returned — only a short redacted preview.",
    },
    async () => {
      const list = await deps.prometheusDatasources.list({
        sub: deps.userId,
        // MCP guard doesn't expose roles; admin-only writes are unreachable
        // from MCP by design — listing is open to authenticated callers.
        isAdmin: false,
      });
      const items = list.items.map((d) => ({
        id: d.id,
        name: d.name,
        baseUrl: d.baseUrl,
        bearerPreview: d.bearerPreview,
        isDefault: d.isDefault,
        consumersCount: d.consumersCount,
      }));
      const payload = { items };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
