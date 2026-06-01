// apps/api/src/modules/mcp/tools/query-prometheus.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type QueryPrometheusInput = {
  query: string;
  connectionId?: string;
  datasourceId?: string;
  range?: { from: string; to: string; step?: number };
};

export function registerQueryPrometheus(server: McpServer, deps: McpToolDeps): void {
  registerTool<QueryPrometheusInput>(
    server,
    {
      name: "query_prometheus",
      title: "Run a PromQL query",
      description:
        "Run a read-only PromQL query against a registered Prometheus datasource. " +
        "Resolve the datasource by `datasourceId`, or by `connectionId` (its bound " +
        "datasource, else the workspace default). Omit `range` for an instant query; " +
        "supply `range` {from,to ISO, step seconds} for a range query. Results are " +
        "capped (≤20 series); use get_engine_metric_catalog first to learn the " +
        "engine's metric names. Tokens/bearers stay server-side.",
      inputShape: {
        query: z.string().min(1).describe("PromQL expression."),
        connectionId: z
          .string()
          .optional()
          .describe("Resolve the datasource bound to this connection (or default)."),
        datasourceId: z.string().optional().describe("Explicit Prometheus datasource id."),
        range: z
          .object({
            from: z.string().datetime({ offset: true }).describe("ISO-8601 start time."),
            to: z.string().datetime({ offset: true }).describe("ISO-8601 end time."),
            step: z.number().int().min(1).max(3600).default(30).describe("Step seconds."),
          })
          .optional()
          .describe("Omit for an instant query."),
      },
    },
    async (input) => {
      const ds = await deps.promFetcher.resolveDatasourceByRef({
        connectionId: input.connectionId,
        datasourceId: input.datasourceId,
      });
      if (!ds) {
        return {
          content: [
            {
              type: "text",
              text: "No Prometheus datasource resolved. Pass datasourceId, or a connectionId with a bound datasource, or configure a default.",
            },
          ],
          isError: true,
        };
      }
      // runQuery throws by contract (SSRF refusal, bearer decrypt, non-2xx,
      // body-size, redirect overflow); the tool layer surfaces it as isError
      // so the agent gets a readable reason instead of an opaque RPC fault.
      try {
        const result = input.range
          ? await deps.promFetcher.runQuery(ds, input.query, {
              kind: "range",
              from: new Date(input.range.from),
              to: new Date(input.range.to),
              step: input.range.step ?? 30,
            })
          : await deps.promFetcher.runQuery(ds, input.query, { kind: "instant" });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Prometheus query failed: ${(e as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
