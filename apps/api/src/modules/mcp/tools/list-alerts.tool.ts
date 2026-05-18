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
        "List alerts attributed to one of the caller's Connections, most recent first. Filters: connectionId, status (firing/resolved), severity (critical/warning/info). Returns a curated slim row per alert (id / alertName / severity / status / scenario / modelName / engine / instance / timestamps / explanation) plus a `nextCursor` for pagination — call again with `cursor: nextCursor` to fetch the next page. Use get_alert_explanation(id) for the full labels/annotations/raw-payload of one alert.",
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
      const limit = input.limit ?? 50;
      const rows = await deps.alerts.listForUser(deps.userId, {
        connectionId: input.connectionId,
        status: input.status,
        severity: input.severity,
        limit,
        cursor: input.cursor,
      });
      // Map to a lean shape — the raw rows include `rawPayload` (the
      // full Alertmanager webhook JSON) plus the unfiltered labels /
      // annotations maps which can easily run hundreds of bytes per
      // alert. Multiplying that by `limit` is the fast path to an LLM
      // context-window blowout, so we keep just the fields an agent
      // needs to triage + drill down. Use get_alert_explanation(id)
      // to retrieve the full labels/annotations/explanation for one alert.
      const items = rows.map((row) => ({
        id: row.id,
        connectionId: row.connectionId,
        alertName: row.alertName,
        severity: row.severity,
        status: row.status,
        scenario: row.scenario,
        modelName: row.modelName,
        engine: row.engine,
        instance: row.instance,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        receivedAt: row.receivedAt,
        explanation: row.explanation,
      }));
      // Cursor pagination: when we filled the page, hand the last id
      // back so the next call can resume after it. Otherwise null so
      // the agent knows the result set is exhausted.
      const nextCursor = items.length === limit ? (items[items.length - 1]?.id ?? null) : null;
      const payload = { items, count: items.length, nextCursor };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
