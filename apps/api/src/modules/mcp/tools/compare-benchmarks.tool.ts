import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { alignBenchmarkMetrics } from "../metrics-align.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { benchmarkIds: string[] };

export function registerCompareBenchmarks(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "compare_benchmarks",
      title: "Compare benchmark metrics side by side",
      description:
        "Align the summary metrics of 2–5 benchmark runs into one table (one row per " +
        "metric, one column per run). Tool-agnostic: every numeric metric is surfaced; " +
        "you decide which direction is 'better'. Use list_benchmarks to find ids.",
      inputShape: {
        benchmarkIds: z
          .array(z.string().min(1))
          .min(2)
          .max(5)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "benchmarkIds must be unique",
          })
          .describe("2–5 distinct benchmark ids to align."),
      },
    },
    async (input) => {
      // findByIdOrFail throws NotFound for an unknown/unowned id; surface it as
      // readable isError text (which id failed) rather than an opaque RPC fault.
      try {
        const items = await Promise.all(
          input.benchmarkIds.map((id) => deps.benchmarks.findByIdOrFail(id, deps.userId)),
        );
        const aligned = alignBenchmarkMetrics(
          items.map((b) => ({ id: b.id, name: b.name, summaryMetrics: b.summaryMetrics })),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(aligned, null, 2) }],
          structuredContent: aligned as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `compare_benchmarks failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
