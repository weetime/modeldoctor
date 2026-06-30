import {
  aggregateSweep,
  type HydratedSavedCompare,
  type SweepRunInput,
  type SweepSeries,
} from "@modeldoctor/contracts";
import { readMetricSafe } from "@modeldoctor/tool-adapters";
import { readEngineMetric } from "./metrics.js";

/** Per-run concurrency that forms the sweep x-axis: aiperf/genai-perf use
 * `concurrency`, evalscope uses `parallel`. */
function extractAxis(params: unknown): number | undefined {
  if (!params || typeof params !== "object") return undefined;
  const p = params as Record<string, unknown>;
  const c = typeof p.concurrency === "number" ? p.concurrency : p.parallel;
  return typeof c === "number" ? c : undefined;
}

/** Server mirror of the client's buildSweepRuns + aggregation: group the
 * compare's members into per-connection series over the concurrency axis,
 * median across repeats. Series labelled by engine kind. */
export function buildSweepSeries(sc: HydratedSavedCompare): SweepSeries[] {
  const runs: SweepRunInput[] = [];
  for (const b of sc.benchmarks) {
    if (b.missing) continue;
    const x = extractAxis(b.params);
    if (x === undefined) continue;
    const sm = b.summaryMetrics as { tool?: unknown; data?: unknown } | null;
    const num = (kind: Parameters<typeof readMetricSafe>[0]): number | null => {
      const v = readMetricSafe(kind, sm);
      return typeof v === "number" ? v : null;
    };
    const kv = readEngineMetric(b.serverMetrics, "kv_cache_usage");
    const queue = readEngineMetric(b.serverMetrics, "scheduler_waiting");
    runs.push({
      seriesKey: b.connectionId ?? b.id,
      seriesLabel: b.engineKind ?? b.stageLabel,
      x,
      metrics: {
        outTps: num("outputTokensPerSec"),
        rps: num("requestsPerSec"),
        ttftP50: num("ttft.p50"),
        ttftP95: num("ttft.p95"),
        itlP50: num("itl.p50"),
        e2eP50: num("e2e.p50"),
        kvAvg: kv?.avg ?? null,
        queueDepth: queue?.avg ?? null,
      },
    });
  }
  return aggregateSweep(runs);
}

const f = (v: number | null | undefined, d = 0): string =>
  typeof v === "number" ? v.toFixed(d) : "—";

/** Render the aggregated sweep as a markdown table for the user prompt, so the
 * judge reasons over the FULL sweep (every series × concurrency point), not
 * just the per-stage lines. English headers (data); prose is localized by the
 * profile's promptFragment. */
export function formatSweepMatrix(series: SweepSeries[]): string {
  if (series.length === 0) return "";
  const lines = [
    "## Sweep matrix (median per engine × concurrency)",
    "",
    "| engine | concurrency | out tok/s | req/s | TTFT p50 (ms) | TTFT p95 (ms) | ITL p50 (ms) | E2E p50 (ms) | KV cache (%) | queue depth |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of series) {
    for (const p of s.points) {
      const v = p.values;
      lines.push(
        `| ${s.seriesLabel} | ${p.x} | ${f(v.outTps)} | ${f(v.rps, 2)} | ${f(v.ttftP50)} | ${f(v.ttftP95)} | ${f(v.itlP50, 1)} | ${f(v.e2eP50)} | ${f(v.kvAvg, 1)} | ${f(v.queueDepth, 1)} |`,
      );
    }
  }
  return lines.join("\n");
}
