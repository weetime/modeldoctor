import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type GetAlertExplanationInput = {
  alertId: string;
};

/**
 * Return the alert + its AI narrative (when present). Lets an agent surface
 * the human-readable why/what-to-do without a separate web visit. Returns
 * structured null-fields when the explanation hasn't been generated yet
 * (fire-and-forget pipeline; the explainer may still be running).
 */
export function registerGetAlertExplanation(server: McpServer, deps: McpToolDeps): void {
  registerTool<GetAlertExplanationInput>(
    server,
    {
      name: "get_alert_explanation",
      title: "Get alert + AI explanation",
      description:
        "Fetch a single alert by id, plus its AI-generated narrative + recommendations + ai severity (when available). 404-like when the alert isn't visible to the caller. Use list_alerts to discover alertId values.",
      inputShape: {
        alertId: z.string().min(1).describe("Alert id (cuid) from list_alerts."),
      },
    },
    async (input) => {
      const row = await deps.alerts.getForUser(deps.userId, input.alertId);
      if (!row) {
        const err = { error: "alert not found or not visible to caller", alertId: input.alertId };
        return {
          content: [{ type: "text", text: JSON.stringify(err) }],
          structuredContent: err,
          isError: true,
        };
      }
      // Split for clarity: explanation may be null when the explainer
      // hasn't generated it yet (fire-and-forget; alert may still be hot).
      const payload = {
        alert: {
          id: row.id,
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
          connection: row.connection,
          labels: row.labels,
          annotations: row.annotations,
        },
        explanation: row.explanation ?? null,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );
}
