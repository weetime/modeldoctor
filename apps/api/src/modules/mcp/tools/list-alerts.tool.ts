import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type ListAlertsInput = {
  connectionId?: string;
  status?: "firing" | "resolved";
  severity?: "critical" | "warning" | "info";
  limit?: number;
  cursor?: string;
};

/**
 * Surface alerts the calling user can see, scoped via AlertsService.listForUser
 * (alerts whose inferred Connection is owned by the user). Useful for an agent
 * asking "what's broken on my fleet right now?" without leaving Claude Code.
 */
export function registerListAlerts(server: McpServer, deps: McpToolDeps): void {
  registerTool<ListAlertsInput>(
    server,
    {
      name: "list_alerts",
      title: "List recent alerts",
      description:
        "List alerts attributed to one of the caller's Connections. Most recent first. Filters: connectionId, status (firing/resolved), severity (critical/warning/info). Returns the same shape as GET /api/alerts including any AI explanation already generated.",
      inputShape: {
        connectionId: z
          .string()
          .optional()
          .describe("Restrict to alerts attributed to this Connection."),
        status: z
          .enum(["firing", "resolved"])
          .optional()
          .describe("Filter by Alertmanager firing/resolved state."),
        severity: z
          .enum(["critical", "warning", "info"])
          .optional()
          .describe("Filter by alert severity label."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Page size (1-200, default 50)."),
        cursor: z.string().optional().describe("Opaque cursor from a previous response."),
      },
    },
    async (input) => {
      const rows = await deps.alerts.listForUser(deps.userId, {
        connectionId: input.connectionId,
        status: input.status,
        severity: input.severity,
        limit: input.limit ?? 50,
        cursor: input.cursor,
      });
      const payload = { items: rows, count: rows.length };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
