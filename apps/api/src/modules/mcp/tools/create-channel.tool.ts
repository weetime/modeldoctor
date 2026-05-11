import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type CreateChannelInput = {
  type: "slack" | "webhook";
  name: string;
  url: string;
};

export function registerCreateChannel(server: McpServer, deps: McpToolDeps): void {
  registerTool<CreateChannelInput>(
    server,
    {
      name: "create_channel",
      title: "Create notification channel",
      description:
        "Create a Slack or generic webhook notification channel. URL is stored encrypted; subsequent reads return a masked form.",
      inputShape: {
        type: z.enum(["slack", "webhook"]).describe("Channel kind."),
        name: z.string().min(1).max(100).describe("Display name."),
        url: z.string().url().describe("Webhook URL (treated as secret)."),
      },
    },
    async (input) => {
      const row = await deps.channels.create(deps.userId, input);
      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row as unknown as Record<string, unknown>,
      };
    },
  );
}
