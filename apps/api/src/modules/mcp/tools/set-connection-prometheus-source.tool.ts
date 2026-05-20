import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type SetConnectionPrometheusSourceInput = {
  connectionId: string;
  datasourceId?: string | null;
};

/**
 * `set_connection_prometheus_source` — bind / rebind / unbind a Connection's
 * Prometheus datasource. Mirrors the three-state semantics of the REST
 * `PATCH /api/connections/:id` endpoint:
 *
 * - `datasourceId: "<id>"` → bind explicitly to that datasource.
 * - `datasourceId: null`   → unbind (sets `prometheusDatasourceId = NULL`).
 * - `datasourceId` omitted → fall back to the current default datasource
 *                            (or `null` if no default is set).
 */
export function registerSetConnectionPrometheusSource(server: McpServer, deps: McpToolDeps): void {
  registerTool<SetConnectionPrometheusSourceInput>(
    server,
    {
      name: "set_connection_prometheus_source",
      title: "Set a connection's Prometheus datasource",
      description:
        "Bind a connection to a Prometheus datasource. Pass datasourceId='<id>' " +
        "to bind explicitly, datasourceId=null to unbind, or omit datasourceId to " +
        "fall back to the current default.",
      inputShape: {
        connectionId: z.string().min(1).describe("Connection id from list_connections."),
        datasourceId: z
          .string()
          .nullable()
          .optional()
          .describe(
            "Datasource id from list_prometheus_datasources. null = unbind. " +
              "Omit to fall back to the current default datasource.",
          ),
      },
    },
    async (input) => {
      const updated = await deps.connections.update(deps.userId, input.connectionId, {
        prometheusDatasourceId: input.datasourceId,
      });
      const payload = {
        id: updated.id,
        name: updated.name,
        prometheusDatasourceId: updated.prometheusDatasourceId,
        prometheusDatasource: updated.prometheusDatasource,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
