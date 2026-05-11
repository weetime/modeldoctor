import type { IncomingMessage, ServerResponse } from "node:http";
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
      { name: "modeldoctor", version: "0.1.0" },
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
