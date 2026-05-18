import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type SubscribeConnectionInput = {
  connectionId: string;
  channelId: string;
  minSeverity?: "info" | "warning" | "critical";
  enabled?: boolean;
};

/**
 * Wire a notification channel to a Connection's alerts. Distinct from the
 * existing `subscribe` tool which is for event-type subscriptions
 * (benchmark.completed etc.). This one drives the V1 alerts loop: when an
 * AlertEvent attributed to `connectionId` fires above the floor, the
 * explainer dispatches the AI-generated narrative to `channelId`.
 *
 * Caller must own the connection (enforced in SubscribersService).
 */
export function registerSubscribeConnection(server: McpServer, deps: McpToolDeps): void {
  registerTool<SubscribeConnectionInput>(
    server,
    {
      name: "subscribe_connection",
      title: "Subscribe a channel to a Connection's alerts",
      description:
        "Route alerts for a Connection (owned by the caller) to a notification channel, optionally gated by minimum severity. Use list_connections to discover connectionId and list_channels to discover channelId.",
      inputShape: {
        connectionId: z.string().min(1).describe("Connection id from list_connections."),
        channelId: z.string().min(1).describe("Channel id from list_channels."),
        minSeverity: z
          .enum(["info", "warning", "critical"])
          .default("warning")
          .describe("Lowest alert severity that triggers delivery (default: warning)."),
        enabled: z.boolean().default(true).describe("Whether the subscription is active."),
      },
    },
    async (input) => {
      const row = await deps.subscribers.create(deps.userId, input.connectionId, {
        channelId: input.channelId,
        minSeverity: input.minSeverity ?? "warning",
        enabled: input.enabled ?? true,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row as unknown as Record<string, unknown>,
      };
    },
  );
}
