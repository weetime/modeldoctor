import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type UnsubscribeInput = { subscriptionId: string };

export function registerUnsubscribe(server: McpServer, deps: McpToolDeps): void {
  registerTool<UnsubscribeInput>(
    server,
    {
      name: "unsubscribe",
      title: "Remove a subscription",
      description: "Delete a notification subscription by its id.",
      inputShape: {
        subscriptionId: z.string().describe("Subscription id from list_subscriptions."),
      },
    },
    async (input) => {
      await deps.subscriptions.delete(deps.userId, input.subscriptionId);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        structuredContent: { ok: true } as unknown as Record<string, unknown>,
      };
    },
  );
}
