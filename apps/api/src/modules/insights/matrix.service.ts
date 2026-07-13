// apps/api/src/modules/insights/matrix.service.ts
import type {
  EndpointReportRange,
  InsightsMatrixResponse,
  MatrixAggregate,
  MatrixCell,
  MatrixDimension,
  MatrixEndpoint,
} from "@modeldoctor/contracts";
import {
  bandFromScore,
  buildFindingsCore,
  nativeMetric,
  scenarioScore,
  type RunLike,
} from "@modeldoctor/insights-scoring";
import { Injectable } from "@nestjs/common";
import { readMetricSafe } from "@modeldoctor/tool-adapters";
import { PrismaService } from "../../database/prisma.service.js";
import { EvaluationProfileService } from "./evaluation-profile.service.js";

const RANGE_DAYS: Record<EndpointReportRange, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;

const apiReader = (kind: Parameters<typeof readMetricSafe>[0], m: unknown) =>
  readMetricSafe(kind, m as { tool?: unknown; data?: unknown } | null);

type ConnectionInfo = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  category: string | null;
  serverKind: string | null;
};

interface GetMatrixParams {
  aggregate: MatrixAggregate;
  range: EndpointReportRange;
  profileSlug: string;
}

@Injectable()
export class MatrixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: EvaluationProfileService,
  ) {}

  async getMatrix(
    userId: string,
    { aggregate, range, profileSlug }: GetMatrixParams,
  ): Promise<InsightsMatrixResponse> {
    const days = RANGE_DAYS[range];
    const since = new Date(Date.now() - days * DAY_MS);

    const profile = await this.profiles.getBySlug(profileSlug);
    const rules = profile.rules;

    const rows = await this.prisma.benchmark.findMany({
      where: { userId, createdAt: { gte: since } },
      include: {
        connection: {
          select: { id: true, name: true, model: true, baseUrl: true, category: true, serverKind: true },
        },
      },
      take: 5000,
      orderBy: { createdAt: "desc" },
    });

    const connections = new Map<string, ConnectionInfo>();
    // connectionId -> runs on that connection
    const runsByConnection = new Map<string, RunLike[]>();
    // connectionId -> dimKey -> runs in that (connection, dimKey) group
    const groups = new Map<string, Map<string, RunLike[]>>();

    for (const row of rows) {
      const connection = row.connection;
      if (!connection) continue;

      if (!connections.has(connection.id)) {
        connections.set(connection.id, {
          id: connection.id,
          name: connection.name,
          model: connection.model,
          baseUrl: connection.baseUrl,
          category: connection.category,
          serverKind: connection.serverKind,
        });
      }

      const run: RunLike = {
        id: row.id,
        scenario: row.scenario,
        status: row.status,
        tool: row.tool,
        summaryMetrics: row.summaryMetrics,
      };

      const connRuns = runsByConnection.get(connection.id) ?? [];
      connRuns.push(run);
      runsByConnection.set(connection.id, connRuns);

      const dimKey =
        aggregate === "scenario"
          ? row.scenario
          : aggregate === "tool"
            ? row.tool
            : (connection.serverKind ?? "unknown");

      let dimMap = groups.get(connection.id);
      if (!dimMap) {
        dimMap = new Map<string, RunLike[]>();
        groups.set(connection.id, dimMap);
      }
      const dimRuns = dimMap.get(dimKey) ?? [];
      dimRuns.push(run);
      dimMap.set(dimKey, dimRuns);
    }

    const cells: MatrixCell[] = [];
    const dimEndpointCounts = new Map<string, Set<string>>();

    for (const [connectionId, dimMap] of groups) {
      for (const [dimKey, groupRuns] of dimMap) {
        const findings = buildFindingsCore(groupRuns, rules, apiReader);
        const score = scenarioScore(
          aggregate === "scenario" ? findings.filter((f) => f.scenario === dimKey) : findings,
        );
        const band = bandFromScore(score);
        const nm = nativeMetric(aggregate === "scenario" ? dimKey : "inference", groupRuns, apiReader);

        cells.push({
          endpointId: connectionId,
          dimKey,
          runs: groupRuns.length,
          score,
          band,
          nativeMetric: nm ? { kind: nm.kind, value: nm.value, unit: "ms" } : null,
        });

        const endpointSet = dimEndpointCounts.get(dimKey) ?? new Set<string>();
        endpointSet.add(connectionId);
        dimEndpointCounts.set(dimKey, endpointSet);
      }
    }

    const dimensions: MatrixDimension[] = Array.from(dimEndpointCounts.entries()).map(
      ([key, endpointSet]) => ({
        key,
        label: key,
        count: endpointSet.size,
      }),
    );

    const endpoints: MatrixEndpoint[] = Array.from(connections.values()).map((c) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      baseUrl: c.baseUrl,
      category: (c.category ?? "chat") as MatrixEndpoint["category"],
      serverKind: c.serverKind ?? null,
    }));

    return {
      aggregate,
      range,
      generatedAt: new Date().toISOString(),
      dimensions,
      endpoints,
      cells,
    };
  }
}
