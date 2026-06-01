import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../database/prisma.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { PrometheusFetcherService } from "../alerts/prometheus-fetcher.service.js";
import { SubscribersService } from "../alerts/subscribers.service.js";
import { BenchmarkService } from "../benchmark/benchmark.service.js";
import { ConnectionService } from "../connection/connection.service.js";
import { DiscoveryService } from "../connection/discovery/discovery.service.js";
import { DiagnosticsService } from "../diagnostics/diagnostics.service.js";
import { ChannelsService } from "../notifications/channels.service.js";
import { DispatcherService } from "../notifications/dispatcher.service.js";
import { SubscriptionsService } from "../notifications/subscriptions.service.js";
import { PrometheusDatasourceService } from "../prometheus-datasource/prometheus-datasource.service.js";
import { RunsService } from "../quality-gate/services/runs.service.js";
import { ConfirmTokenService } from "./confirm-token.service.js";
import { registerCompareBenchmarks } from "./tools/compare-benchmarks.tool.js";
import { registerCreateChannel } from "./tools/create-channel.tool.js";
import { registerDiscoverConnection } from "./tools/discover-connection.tool.js";
import { registerGetAlertExplanation } from "./tools/get-alert-explanation.tool.js";
import { registerGetBenchmark } from "./tools/get-benchmark.tool.js";
import { registerGetEngineMetricCatalog } from "./tools/get-engine-metric-catalog.tool.js";
import { registerGetQualityGateRun } from "./tools/get-quality-gate-run.tool.js";
import { registerListAlerts } from "./tools/list-alerts.tool.js";
import { registerListBenchmarks } from "./tools/list-benchmarks.tool.js";
import { registerListChannels } from "./tools/list-channels.tool.js";
import { registerListConnections } from "./tools/list-connections.tool.js";
import { registerListPrometheusDatasources } from "./tools/list-prometheus-datasources.tool.js";
import { registerQueryPrometheus } from "./tools/query-prometheus.tool.js";
import { registerRunBenchmark } from "./tools/run-benchmark.tool.js";
import { registerRunDiagnostics } from "./tools/run-diagnostics.tool.js";
import { registerRunQualityGate } from "./tools/run-quality-gate.tool.js";
import { registerSetConnectionPrometheusSource } from "./tools/set-connection-prometheus-source.tool.js";
import { registerSetDefaultPrometheusDatasource } from "./tools/set-default-prometheus-datasource.tool.js";
import { registerSubscribe } from "./tools/subscribe.tool.js";
import { registerSubscribeConnection } from "./tools/subscribe-connection.tool.js";
import { registerTestChannel } from "./tools/test-channel.tool.js";
import { registerUnsubscribe } from "./tools/unsubscribe.tool.js";

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
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly connections: ConnectionService,
    private readonly benchmarks: BenchmarkService,
    private readonly diagnostics: DiagnosticsService,
    private readonly channels: ChannelsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly dispatcher: DispatcherService,
    private readonly alerts: AlertsService,
    private readonly subscribers: SubscribersService,
    private readonly prometheusDatasources: PrometheusDatasourceService,
    private readonly promFetcher: PrometheusFetcherService,
    private readonly runs: RunsService,
    private readonly confirmTokens: ConfirmTokenService,
    private readonly config: ConfigService<Env, true>,
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

    // Look up the configured MCP user's actual roles in the DB so admin-only
    // tools (e.g. set_default_prometheus_datasource) can gate on real status
    // rather than hard-coding `isAdmin: false` everywhere. If the user has
    // been deleted between server start and this call, we treat them as
    // non-admin — the underlying service will then raise its own NotFound
    // or Forbidden, which is the same end-state the REST layer presents.
    const allowExecute = this.config.get("MCP_ALLOW_EXECUTE", { infer: true });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true },
    });
    const isAdmin = !!user?.roles?.includes("admin");

    const deps: McpToolDeps = {
      userId,
      isAdmin,
      discovery: this.discovery,
      connections: this.connections,
      benchmarks: this.benchmarks,
      diagnostics: this.diagnostics,
      channels: this.channels,
      subscriptions: this.subscriptions,
      alerts: this.alerts,
      subscribers: this.subscribers,
      prometheusDatasources: this.prometheusDatasources,
      promFetcher: this.promFetcher,
      runs: this.runs,
      confirmTokens: this.confirmTokens,
      allowExecute,
      notificationsTest: async (channelId: string) => {
        try {
          await this.dispatcher.testChannel(
            userId,
            channelId,
            "Test notification from ModelDoctor (MCP)",
          );
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    };
    registerDiscoverConnection(server, deps);
    registerListConnections(server, deps);
    registerListBenchmarks(server, deps);
    registerRunDiagnostics(server, deps);
    registerListChannels(server, deps);
    registerCreateChannel(server, deps);
    registerSubscribe(server, deps);
    registerUnsubscribe(server, deps);
    registerTestChannel(server, deps);
    registerListAlerts(server, deps);
    registerGetAlertExplanation(server, deps);
    registerSubscribeConnection(server, deps);
    registerListPrometheusDatasources(server, deps);
    registerSetConnectionPrometheusSource(server, deps);
    registerSetDefaultPrometheusDatasource(server, deps);
    registerQueryPrometheus(server, deps);
    registerGetEngineMetricCatalog(server, deps);
    registerCompareBenchmarks(server, deps);
    registerGetBenchmark(server, deps);
    registerGetQualityGateRun(server, deps);

    if (deps.allowExecute) {
      registerRunBenchmark(server, deps);
      registerRunQualityGate(server, deps);
    }

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
  /**
   * Whether the configured MCP_USER_ID has the "admin" role in the DB.
   * Resolved per-request from prisma; admin-gated tools (e.g.
   * `set_default_prometheus_datasource`) check this before mutating
   * shared/admin-managed resources. Read-only tools may ignore it.
   */
  isAdmin: boolean;
  discovery: DiscoveryService;
  connections: ConnectionService;
  benchmarks: BenchmarkService;
  diagnostics: DiagnosticsService;
  channels: ChannelsService;
  subscriptions: SubscriptionsService;
  alerts: AlertsService;
  subscribers: SubscribersService;
  prometheusDatasources: PrometheusDatasourceService;
  promFetcher: PrometheusFetcherService;
  runs: RunsService;
  confirmTokens: ConfirmTokenService;
  allowExecute: boolean;
  notificationsTest: (channelId: string) => Promise<{ ok: boolean; error?: string }>;
}
