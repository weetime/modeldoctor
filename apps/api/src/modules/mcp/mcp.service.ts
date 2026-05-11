import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Injectable } from "@nestjs/common";
import { BenchmarkService } from "../benchmark/benchmark.service.js";
import { ConnectionService } from "../connection/connection.service.js";
import { DiscoveryService } from "../connection/discovery/discovery.service.js";
import { DiagnosticsService } from "../diagnostics/diagnostics.service.js";
import { registerDiscoverConnection } from "./tools/discover-connection.tool.js";
import { registerListBenchmarks } from "./tools/list-benchmarks.tool.js";
import { registerListConnections } from "./tools/list-connections.tool.js";
import { registerRunDiagnostics } from "./tools/run-diagnostics.tool.js";

// Read api package version once at module load. Falls back to "0.0.0" if
// package.json can't be resolved (shouldn't happen — Nest is run from a
// resolvable apps/api/ — but defensive). CommonJS __dirname is available.
const SERVER_VERSION = (() => {
  try {
    const raw = readFileSync(join(__dirname, "../../../package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/**
 * Bootstraps a fresh McpServer instance per HTTP request (stateless mode).
 *
 * Per-request lifecycle keeps tool registration straightforward (no shared
 * mutable state between Claude Code sessions) and matches the
 * StreamableHTTPServerTransport stateless pattern. Each tool wrapper imports
 * a Nest service via the McpService's deps and calls it with the resolved
 * MCP_USER_ID.
 */
@Injectable()
export class McpService {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly connections: ConnectionService,
    private readonly benchmarks: BenchmarkService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    userId: string,
    body?: unknown,
  ): Promise<void> {
    const server = new McpServer(
      { name: "modeldoctor", version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    const deps = {
      userId,
      discovery: this.discovery,
      connections: this.connections,
      benchmarks: this.benchmarks,
      diagnostics: this.diagnostics,
    };
    registerDiscoverConnection(server, deps);
    registerListConnections(server, deps);
    registerListBenchmarks(server, deps);
    registerRunDiagnostics(server, deps);

    // Stateless mode — every request is a fresh JSON-RPC roundtrip with
    // no cross-request session state. Matches Claude Code's typical
    // call-tool-then-disconnect pattern for HTTP transport.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Clean up transport + server when the response finishes so we don't
    // leak per-request resources under high tool-call concurrency.
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

export interface McpToolDeps {
  userId: string;
  discovery: DiscoveryService;
  connections: ConnectionService;
  benchmarks: BenchmarkService;
  diagnostics: DiagnosticsService;
}
