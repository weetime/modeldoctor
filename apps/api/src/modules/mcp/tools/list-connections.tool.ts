import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

/**
 * `list_connections` — read the caller's saved connection library.
 * No input args. apiKey is NEVER returned (only a 4-char preview).
 */
export function registerListConnections(server: McpServer, deps: McpToolDeps): void {
  registerTool<undefined>(
    server,
    {
      name: "list_connections",
      title: "List connections",
      description:
        "List the user's saved inference-endpoint connections (id, name, baseUrl, " +
        "model, category, tags, serverKind, prometheusDatasource). The apiKey is NEVER " +
        "returned — only a 4-char preview. Use the id with run_diagnostics or " +
        "list_benchmarks to look up dependent records.",
    },
    async () => {
      const list = await deps.connections.list(deps.userId);
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        structuredContent: list as unknown as Record<string, unknown>,
      };
    },
  );
}
