import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type SubscribeInput = {
  channelId: string;
  eventType: "benchmark.completed" | "benchmark.failed" | "diagnostics.failed";
  connectionId?: string;
};

export function registerSubscribe(server: McpServer, deps: McpToolDeps): void {
  registerTool<SubscribeInput>(
    server,
    {
      name: "subscribe",
      title: "Subscribe a channel to an event",
      description:
        "Subscribe an existing notification channel to an event type. Optionally filter by connectionId.",
      inputShape: {
        channelId: z.string().describe("Channel id from list_channels."),
        eventType: z
          .enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"])
          .describe("Event type to subscribe to."),
        connectionId: z
          .string()
          .optional()
          .describe("If set, only fire when the event's connectionId matches."),
      },
    },
    async (input) => {
      const row = await deps.subscriptions.create(deps.userId, input);
      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row as unknown as Record<string, unknown>,
      };
    },
  );
}
