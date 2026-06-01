import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { benchmarkId: string };

export function registerGetBenchmark(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_benchmark",
      title: "Get a single benchmark",
      description:
        "Fetch one benchmark by id (status, scenario, tool, summaryMetrics). Use this to " +
        "poll a run started with run_benchmark until status is terminal " +
        "(completed/failed/cancelled).",
      inputShape: { benchmarkId: z.string().min(1).describe("Benchmark id.") },
    },
    async (input) => {
      // Surface not-found with a tool-name prefix (matching compare_benchmarks /
      // query_prometheus) so a polling agent gets a self-identifying error.
      try {
        const b = await deps.benchmarks.findByIdOrFail(input.benchmarkId, deps.userId);
        return {
          content: [{ type: "text", text: JSON.stringify(b, null, 2) }],
          structuredContent: b as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `get_benchmark failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
