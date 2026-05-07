// apps/api/src/modules/insights/comparison.service.ts
import type { BaselineCheckComparison, FleetCheckComparison } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import { extractMetric, median, percentile } from "./metrics.js";

const MIN_SAMPLES = 3;

const ALL_CHECK_IDS = [
  "inference.ttft.p95.ms",
  "inference.ttft.p99.ms",
  "inference.itl.p95.ms",
  "inference.e2e.p95.ms",
  "inference.e2e.p99.ms",
  "inference.error_rate",
  "inference.throughput.req_per_s",
  "capacity.max_qps",
  "capacity.error_rate",
  "capacity.tail_ratio",
  "gateway.error_rate",
  "gateway.tail_ratio",
  "gateway.throughput.req_per_s",
];

@Injectable()
export class ComparisonService {
  constructor(private readonly prisma: PrismaService) {}

  async baseline(
    userId: string,
    connectionId: string,
    fromISO: string,
  ): Promise<BaselineCheckComparison[]> {
    const range = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { gte: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true, scenario: true },
    });
    const historical = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { lt: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true, scenario: true },
    });
    const out: BaselineCheckComparison[] = [];
    for (const id of ALL_CHECK_IDS) {
      const cur = range
        .map((r) => extractMetric(r.summaryMetrics as any, id))
        .filter((v): v is number => v != null);
      const hist = historical
        .map((r) => extractMetric(r.summaryMetrics as any, id))
        .filter((v): v is number => v != null);
      if (cur.length < MIN_SAMPLES || hist.length < MIN_SAMPLES) continue;
      const cP50 = median(cur);
      const hP50 = median(hist);
      const hP90 = percentile(hist, 90);
      const deltaPct = hP50 === 0 ? 0 : ((cP50 - hP50) / hP50) * 100;
      out.push({
        checkId: id,
        currentP50: cP50,
        historicalP50: hP50,
        historicalP90: hP90,
        deltaPct,
        sampleSize: hist.length,
      });
    }
    return out;
  }

  async fleet(
    userId: string,
    connectionId: string,
    fromISO: string,
  ): Promise<FleetCheckComparison[]> {
    const conn = await this.prisma.connection.findFirst({ where: { id: connectionId, userId } });
    if (!conn) return [];
    const target = await this.prisma.benchmark.findMany({
      where: { userId, connectionId, status: "completed", createdAt: { gte: new Date(fromISO) } },
      select: { tool: true, summaryMetrics: true },
    });
    const fleetRuns = await this.prisma.benchmark.findMany({
      where: {
        userId,
        status: "completed",
        connection: { is: { category: conn.category, NOT: { id: connectionId } } },
        createdAt: { gte: new Date(fromISO) },
      },
      select: { tool: true, summaryMetrics: true },
    });
    const out: FleetCheckComparison[] = [];
    for (const id of ALL_CHECK_IDS) {
      const cur = target
        .map((r) => extractMetric(r.summaryMetrics as any, id))
        .filter((v): v is number => v != null);
      const fleet = fleetRuns
        .map((r) => extractMetric(r.summaryMetrics as any, id))
        .filter((v): v is number => v != null);
      if (cur.length < MIN_SAMPLES || fleet.length < MIN_SAMPLES) continue;
      out.push({
        checkId: id,
        currentP50: median(cur),
        fleetP50: median(fleet),
        fleetP90: percentile(fleet, 90),
        sampleSize: fleet.length,
      });
    }
    return out;
  }
}
