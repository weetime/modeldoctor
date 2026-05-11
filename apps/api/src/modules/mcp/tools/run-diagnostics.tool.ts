import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProbeName } from "@modeldoctor/contracts";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

// Mirror contracts probeNameSchema; the compile-time sync check below
// catches drift if a probe is added or removed from the contract.
const PROBE_VALUES = [
  "chat-text",
  "chat-vision",
  "tts",
  "asr",
  "chat-audio-omni",
  "embeddings-openai",
  "embeddings-tei",
  "rerank-tei",
  "rerank-cohere",
  "image-gen",
] as const;
type LocalProbeName = (typeof PROBE_VALUES)[number];
const _probeNameSync: LocalProbeName extends ProbeName
  ? ProbeName extends LocalProbeName
    ? true
    : false
  : false = true;
void _probeNameSync;

type RunDiagnosticsInput = {
  connectionId: string;
  probes?: ProbeName[];
};

/**
 * `run_diagnostics` — run one or more endpoint probes against a saved
 * connection. Synchronous, like the web UI's "Run" button.
 */
export function registerRunDiagnostics(server: McpServer, deps: McpToolDeps): void {
  registerTool<RunDiagnosticsInput>(
    server,
    {
      name: "run_diagnostics",
      title: "Run diagnostics probes",
      description:
        "Run probe(s) against a saved connection and return per-probe pass/fail + " +
        "latency + structured checks. Synchronous; typically returns in a few seconds. " +
        "Supply `probes` to target specific protocols (e.g. ['chat-text','embeddings-openai']); " +
        "defaults to ['chat-text']. Resolves the connection by id, decrypts the apiKey " +
        "server-side, and persists a diagnostics_run row.",
      inputShape: {
        connectionId: z
          .string()
          .min(1)
          .describe("Saved connection id. See list_connections for available ids."),
        probes: z
          .array(z.enum(PROBE_VALUES))
          .min(1)
          .default(["chat-text"])
          .describe(`Probes to run. One of: ${PROBE_VALUES.join(", ")}.`),
      },
    },
    async (input) => {
      const conn = await deps.connections.getOwnedDecrypted(deps.userId, input.connectionId);
      const probes = input.probes ?? (["chat-text"] as ProbeName[]);
      const result = await deps.diagnostics.run(deps.userId, conn, {
        connectionId: input.connectionId,
        probes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
