import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type TestChannelInput = { channelId: string };

export function registerTestChannel(server: McpServer, deps: McpToolDeps): void {
  registerTool<TestChannelInput>(
    server,
    {
      name: "test_channel",
      title: "Send a test notification",
      description:
        "Send a one-shot test payload through the given channel. Returns { ok, error? }.",
      inputShape: {
        channelId: z.string().describe("Channel id from list_channels."),
      },
    },
    async (input) => {
      const result = await deps.notificationsTest(input.channelId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
