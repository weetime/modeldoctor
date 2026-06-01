import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { runId: string };

export function registerGetQualityGateRun(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_quality_gate_run",
      title: "Get a single quality-gate run",
      description:
        "Fetch one quality-gate run by id (status, gateResult, aggregate metrics, " +
        "processed/total samples). Use this to poll a run started with run_quality_gate " +
        "until status is terminal.",
      inputShape: { runId: z.string().min(1).describe("Evaluation run id.") },
    },
    async (input) => {
      // Surface not-found with a tool-name prefix (matching compare_benchmarks /
      // query_prometheus) so a polling agent gets a self-identifying error.
      try {
        const r = await deps.runs.get(deps.userId, input.runId);
        return {
          content: [{ type: "text", text: JSON.stringify(r, null, 2) }],
          structuredContent: r as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `get_quality_gate_run failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
