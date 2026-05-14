import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Benchmark } from "@modeldoctor/contracts";
import {
  type EvalscopeReport,
  evalscopeReportSchema,
} from "@modeldoctor/tool-adapters/schemas";
import { useMemo } from "react";
import { MetricCard } from "../components/MetricCard";
import { useBenchmarkList } from "../queries";
import { UnknownReport } from "./UnknownReport";

export interface KvCacheStressReportProps {
  benchmark: Benchmark;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

const RERUN_SUFFIX = " (rerun)";

/**
 * The "kv-cache-stress" scenario now renders evalscope's report shape (the
 * legacy kv-cache-stress tool is being retired in Phase 9). When a sibling
 * benchmark named `<name> (rerun)` exists in the same scope, we render a
 * cold-vs-warm delta table comparing the cold first run (R1) against the
 * warm rerun (R2). Otherwise the rerun panel is omitted.
 */
export function KvCacheStressReport({ benchmark }: KvCacheStressReportProps) {
  const tagged = benchmark.summaryMetrics as {
    tool?: string;
    data?: unknown;
  } | null;
  const parsed = evalscopeReportSchema.safeParse(tagged?.data);
  if (!parsed.success) {
    return <UnknownReport benchmark={benchmark} reason={parsed.error.message} />;
  }
  const data: EvalscopeReport = parsed.data;

  return (
    <div className="space-y-6">
      <KvCacheStressMetrics data={data} />
      <ColdWarmPairPanel benchmark={benchmark} cold={data} />
    </div>
  );
}

function KvCacheStressMetrics({ data }: { data: EvalscopeReport }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title="TTFT (ms)"
        rows={[
          { label: "mean", value: fmt(data.ttft.mean) },
          { label: "p50", value: fmt(data.ttft.p50) },
          { label: "p90", value: fmt(data.ttft.p90) },
          { label: "p95", value: fmt(data.ttft.p95) },
          { label: "p99", value: fmt(data.ttft.p99) },
        ]}
      />
      <MetricCard
        title="ITL (ms)"
        rows={[
          { label: "mean", value: fmt(data.itl.mean) },
          { label: "p50", value: fmt(data.itl.p50) },
          { label: "p90", value: fmt(data.itl.p90) },
          { label: "p95", value: fmt(data.itl.p95) },
          { label: "p99", value: fmt(data.itl.p99) },
        ]}
      />
      <MetricCard
        title="E2E latency (ms)"
        rows={[
          { label: "mean", value: fmt(data.e2eLatency.mean) },
          { label: "p50", value: fmt(data.e2eLatency.p50) },
          { label: "p90", value: fmt(data.e2eLatency.p90) },
          { label: "p95", value: fmt(data.e2eLatency.p95) },
          { label: "p99", value: fmt(data.e2eLatency.p99) },
        ]}
      />
      <MetricCard
        title="Throughput"
        rows={[
          { label: "RPS", value: fmt(data.throughput.requestsPerSec) },
          { label: "Output TPS", value: fmt(data.throughput.outputTokensPerSec) },
          { label: "Total TPS", value: fmt(data.throughput.totalTokensPerSec) },
        ]}
      />
      <MetricCard
        title="Requests"
        rows={[
          { label: "total", value: data.requests.total },
          { label: "success", value: data.requests.success },
          { label: "error", value: data.requests.error },
          {
            label: "errorRate",
            value: `${(data.requests.errorRate * 100).toFixed(2)}%`,
          },
        ]}
      />
      {data.prefixCacheStats ? (
        <MetricCard
          title="Prefix cache"
          rows={[
            {
              label: "Hit rate",
              value: `${(data.prefixCacheStats.hitRate * 100).toFixed(1)}%`,
            },
          ]}
        />
      ) : null}
    </div>
  );
}

interface ColdWarmPairPanelProps {
  benchmark: Benchmark;
  cold: EvalscopeReport;
}

/**
 * Looks up the cold/warm sibling for this benchmark via the same name + " (rerun)"
 * convention used by `BenchmarkDetailPage.handleRerun`. We fetch a page of
 * benchmarks for the same connection and pick:
 *  - if this benchmark's name ends with " (rerun)" → the source (cold) by stripping
 *    the suffix; this benchmark is the warm row (R2).
 *  - otherwise → the sibling whose name is `<name> (rerun)`; this benchmark is
 *    the cold row (R1).
 *
 * Renders nothing when no sibling is found (preserves the spec contract).
 */
function ColdWarmPairPanel({ benchmark, cold }: ColdWarmPairPanelProps) {
  const isWarm = benchmark.name.endsWith(RERUN_SUFFIX);
  const sourceName = isWarm ? benchmark.name.slice(0, -RERUN_SUFFIX.length) : benchmark.name;
  const siblingName = isWarm ? sourceName : `${sourceName}${RERUN_SUFFIX}`;

  const list = useBenchmarkList({
    connectionId: benchmark.connectionId ?? undefined,
    scenario: "kv-cache-stress",
    search: sourceName,
    limit: 50,
  });

  const sibling = useMemo<Benchmark | null>(() => {
    const items = list.data?.pages.flatMap((p) => p.items) ?? [];
    const match = items.find((b) => b.id !== benchmark.id && b.name === siblingName);
    return match ?? null;
  }, [list.data, benchmark.id, siblingName]);

  const siblingData = useMemo<EvalscopeReport | null>(() => {
    if (!sibling) return null;
    const tagged = sibling.summaryMetrics as {
      tool?: string;
      data?: unknown;
    } | null;
    const parsed = evalscopeReportSchema.safeParse(tagged?.data);
    return parsed.success ? parsed.data : null;
  }, [sibling]);

  if (!sibling || !siblingData) return null;

  // R1 is always cold (no " (rerun)"), R2 is warm. If this benchmark is the
  // warm one, the sibling is cold.
  const r1 = isWarm ? siblingData : cold;
  const r2 = isWarm ? cold : siblingData;

  const rows: Array<{ label: string; r1: number; r2: number }> = [
    { label: "TTFT p95 (ms)", r1: r1.ttft.p95, r2: r2.ttft.p95 },
    {
      label: "Throughput · RPS",
      r1: r1.throughput.requestsPerSec,
      r2: r2.throughput.requestsPerSec,
    },
    {
      label: "Throughput · Output TPS",
      r1: r1.throughput.outputTokensPerSec,
      r2: r2.throughput.outputTokensPerSec,
    },
    { label: "ITL p50 (ms)", r1: r1.itl.p50, r2: r2.itl.p50 },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">
          Cold vs. warm (R1 → R2)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              <TableHead className="text-right">R1 · cold</TableHead>
              <TableHead className="text-right">R2 · warm</TableHead>
              <TableHead className="text-right">Δ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const delta = row.r1 === 0 ? null : ((row.r2 - row.r1) / row.r1) * 100;
              return (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.r1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(row.r2)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {delta === null
                      ? "—"
                      : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
