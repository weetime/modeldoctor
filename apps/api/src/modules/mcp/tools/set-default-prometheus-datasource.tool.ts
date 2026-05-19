import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type SetDefaultPrometheusDatasourceInput = {
  datasourceId: string;
};

/**
 * `set_default_prometheus_datasource` — promote one Prometheus datasource
 * to the workspace-wide default. The default is the one that newly-created
 * Connections (kind ∈ {model, gateway}) auto-bind to when the caller
 * doesn't specify `prometheusDatasourceId` explicitly.
 *
 * Admin-gated. The configured `MCP_USER_ID` must have the `"admin"` role in
 * the DB (mcp.service resolves this per-request from prisma); otherwise the
 * underlying service raises `ForbiddenException("admin role required")`.
 * Non-admin callers can still LIST datasources via
 * `list_prometheus_datasources`; only the promote/demote / create / delete
 * mutations require admin.
 *
 * The set-default operation is transactional at the service layer (a single
 * Prisma `$transaction` flips every other `isDefault=true` row to false
 * before flipping the target row to true), so concurrent calls converge to
 * exactly one default rather than partial-update fan-out.
 */
export function registerSetDefaultPrometheusDatasource(server: McpServer, deps: McpToolDeps): void {
  registerTool<SetDefaultPrometheusDatasourceInput>(
    server,
    {
      name: "set_default_prometheus_datasource",
      title: "Set the default Prometheus datasource",
      description:
        "Promote one Prometheus datasource (by id from list_prometheus_datasources) " +
        "to the workspace default. New connections (kind=model or gateway) created " +
        "without an explicit prometheusDatasourceId will auto-bind to this one. " +
        "Admin-only: the configured MCP_USER_ID must have the admin role in the DB.",
      inputShape: {
        datasourceId: z
          .string()
          .min(1)
          .describe("Datasource id from list_prometheus_datasources to promote to default."),
      },
    },
    async (input) => {
      const updated = await deps.prometheusDatasources.setDefault(
        { sub: deps.userId, isAdmin: deps.isAdmin },
        input.datasourceId,
      );
      const payload = {
        id: updated.id,
        name: updated.name,
        baseUrl: updated.baseUrl,
        isDefault: updated.isDefault,
        consumersCount: updated.consumersCount,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
