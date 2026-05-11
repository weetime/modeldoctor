import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type ListBenchmarksInput = {
  limit?: number;
  status?: "pending" | "submitted" | "running" | "completed" | "failed" | "canceled";
  connectionId?: string;
  cursor?: string;
};

/**
 * `list_benchmarks` — recent benchmark runs scoped to the caller. Wraps
 * `GET /api/benchmarks`; cursor pagination, optional status + connectionId
 * filters.
 */
export function registerListBenchmarks(server: McpServer, deps: McpToolDeps): void {
  registerTool<ListBenchmarksInput>(
    server,
    {
      name: "list_benchmarks",
      title: "List benchmarks",
      description:
        "List the user's benchmark runs, newest first. Filter by status, connectionId. " +
        "Returns id, name, status, scenario, tool, connectionId, summaryMetrics, " +
        "createdAt. Use cursor for pagination.",
      inputShape: {
        limit: z.number().int().positive().max(100).default(20).describe("Page size (max 100)."),
        status: z
          .enum(["pending", "submitted", "running", "completed", "failed", "canceled"])
          .optional()
          .describe("Filter by status."),
        connectionId: z
          .string()
          .optional()
          .describe("Filter to benchmarks targeting this connection."),
        cursor: z
          .string()
          .optional()
          .describe("Opaque cursor from a previous page's `nextCursor` field."),
      },
    },
    async (input) => {
      const list = await deps.benchmarks.list(
        {
          limit: input.limit ?? 20,
          scope: "own",
          status: input.status,
          connectionId: input.connectionId,
          cursor: input.cursor,
        },
        deps.userId,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        structuredContent: list as unknown as Record<string, unknown>,
      };
    },
  );
}
