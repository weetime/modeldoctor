import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

export function registerListChannels(server: McpServer, deps: McpToolDeps): void {
  registerTool<Record<string, never>>(
    server,
    {
      name: "list_channels",
      title: "List notification channels",
      description:
        "List the user's notification channels (Slack/webhook). Returns id, type, name, urlMasked, createdAt.",
    },
    async () => {
      const list = await deps.channels.list(deps.userId);
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        structuredContent: { channels: list } as unknown as Record<string, unknown>,
      };
    },
  );
}
