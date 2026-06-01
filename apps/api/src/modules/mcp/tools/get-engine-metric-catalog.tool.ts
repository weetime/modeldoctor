// apps/api/src/modules/mcp/tools/get-engine-metric-catalog.tool.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getEngineManifest } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type Input = { connectionId: string };

export function registerGetEngineMetricCatalog(server: McpServer, deps: McpToolDeps): void {
  registerTool<Input>(
    server,
    {
      name: "get_engine_metric_catalog",
      title: "Get a connection's engine metric catalog",
      description:
        "Return the metric catalog (metric keys, units, PromQL templates, thresholds) " +
        "for the inference engine behind a connection (vLLM / SGLang / TGI / TEI / MindIE). " +
        "Use this BEFORE query_prometheus so you know the engine's real metric names " +
        "instead of guessing.",
      inputShape: {
        connectionId: z.string().min(1).describe("Saved connection id. See list_connections."),
      },
    },
    async (input) => {
      // Public (non-decrypting) getter: we only need serverKind — no reason to
      // decrypt the connection's API key just to read a static manifest. Surface
      // not-found with a tool-name prefix, consistent with the other read tools.
      let conn: Awaited<ReturnType<McpToolDeps["connections"]["findOwnedPublic"]>>;
      try {
        conn = await deps.connections.findOwnedPublic(deps.userId, input.connectionId);
      } catch (e) {
        return {
          content: [
            { type: "text", text: `get_engine_metric_catalog failed: ${(e as Error).message}` },
          ],
          isError: true,
        };
      }
      const manifest = conn.serverKind ? getEngineManifest(conn.serverKind as never) : null;
      if (!manifest) {
        return {
          content: [
            {
              type: "text",
              text: `No engine metric catalog for serverKind=${conn.serverKind ?? "(unset)"}. Set the connection's serverKind to one of: vllm, sglang, tgi, tei, mindie.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(manifest, null, 2) }],
        structuredContent: manifest as unknown as Record<string, unknown>,
      };
    },
  );
}
