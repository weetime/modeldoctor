import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type DiscoverInput = {
  baseUrl: string;
  apiKey?: string;
  customHeaders?: string;
};

/**
 * `discover_connection` — probe an inference endpoint and infer its
 * server kind, available models, category, suggested tags, and Prometheus
 * URL. Wraps `POST /api/connections/discover` (#151 / #157).
 */
export function registerDiscoverConnection(server: McpServer, deps: McpToolDeps): void {
  registerTool<DiscoverInput>(
    server,
    {
      name: "discover_connection",
      title: "Discover connection",
      description:
        "Probe an inference endpoint (vLLM / SGLang / TGI / TRT-LLM / Higress / …) and " +
        "return inferred fields. Sends GET requests to /v1/models, /metrics, /health, / " +
        "with SSRF guards (rejects private IPs, cloud metadata, redirects re-validated). " +
        "Optionally accepts customHeaders (newline `key: value`) so gateway routing " +
        "headers like `x-higress-llm-model` are forwarded to every probe.",
      inputShape: {
        baseUrl: z
          .string()
          .url()
          .describe("Origin including scheme + port. Don't include /v1/... path."),
        apiKey: z.string().min(1).optional().describe("Bearer token for the endpoint."),
        customHeaders: z
          .string()
          .optional()
          .describe(
            "Newline-separated `key: value` headers forwarded to every probe. " +
              "Required for gateways that route by header (Higress's `x-higress-llm-model`).",
          ),
      },
    },
    async (input) => {
      const result = await deps.discovery.discover({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        customHeaders: input.customHeaders,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
