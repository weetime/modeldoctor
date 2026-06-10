import type { PrefixCacheAnnotation } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { PrometheusFetcherService } from "../../alerts/prometheus-fetcher.service.js";

export interface SnapshotInput {
  /** PrometheusDatasource row — opaque to this service; passed through to runQuery. */
  ds: unknown;
  model: string;
  windowSec: number;
  /** Evaluation time = benchmark completedAt. */
  at: Date;
}

/**
 * Pure-computation service: given a Prometheus datasource, model, and time
 * window, queries vLLM prefix-cache counters by pod and computes a
 * PrefixCacheAnnotation.  No DB interaction — callers are responsible for
 * persistence.
 *
 * Metric strategy (V1 → V0 fallback):
 *   V1: vllm:prefix_cache_queries_total / vllm:prefix_cache_hits_total
 *   V0: vllm:gpu_prefix_cache_queries_total / vllm:gpu_prefix_cache_hits_total
 *
 * We use an instant query with `increase(…[windowSec]s)` at `at` to get the
 * counter delta over the benchmark window, grouped by pod.
 *
 * Real runQuery return shape (instant kind):
 *   { series: [{ labels: Record<string,string>, value: number | null }] }
 * `value` is `null` for Prometheus "NaN" / "+Inf" / stale markers — we treat
 * those as "no data" and skip the series entirely so they don't produce
 * misleading zero-valued entries in the result map.
 */
@Injectable()
export class PrefixCacheSnapshotService {
  // Concrete class type (value import) — required for Nest's reflected DI
  // metadata; a `Pick<…>`/interface type emits `Object` and breaks resolution
  // in the real container. Tests still pass a fake via `{ runQuery } as never`.
  constructor(private readonly fetcher: PrometheusFetcherService) {}

  /** Build the PromQL expression for a single counter metric. */
  private q(metric: string, model: string, windowSec: number): string {
    return `sum by (pod) (increase(vllm:${metric}{model_name="${model}"}[${windowSec}s]))`;
  }

  /**
   * Execute an instant query and return a Map<pod, value>.
   *
   * The real runQuery shape for kind="instant" is:
   *   series[i].value: number | null
   * (null = Prometheus NaN/+Inf/stale marker — series is skipped entirely).
   *
   * Only series with a real numeric value are added to the map.  Skipping
   * null-valued series ensures that an all-null V1 result produces an empty
   * map (size === 0) so the V1→V0 fallback fires correctly.
   */
  private async byPod(ds: unknown, query: string, at: Date): Promise<Map<string, number>> {
    const result = await this.fetcher.runQuery(
      ds as Parameters<PrometheusFetcherService["runQuery"]>[0],
      query,
      {
        kind: "instant",
        at,
      },
    );
    const map = new Map<string, number>();
    for (const s of result.series) {
      const pod = s.labels["pod"] ?? s.labels["kubernetes_pod_name"] ?? "";
      if (!pod) continue;
      // Skip null/undefined values — null = Prometheus NaN/stale, meaning no
      // real sample was produced for this pod in the window.
      if (s.value == null) continue;
      map.set(pod, s.value);
    }
    return map;
  }

  /**
   * Compute the prefix-cache annotation for a completed benchmark.
   *
   * Returns `null` if neither V1 nor V0 metrics have any data (e.g. the
   * vLLM instance doesn't expose prefix-cache counters).
   */
  async snapshot({
    ds,
    model,
    windowSec,
    at,
  }: SnapshotInput): Promise<PrefixCacheAnnotation | null> {
    for (const tag of ["v1", "v0"] as const) {
      const qMetric =
        tag === "v1" ? "prefix_cache_queries_total" : "gpu_prefix_cache_queries_total";
      const hMetric = tag === "v1" ? "prefix_cache_hits_total" : "gpu_prefix_cache_hits_total";

      const queries = await this.byPod(ds, this.q(qMetric, model, windowSec), at);
      // size === 0 means no pod produced a real (non-null) sample this window;
      // either the metric doesn't exist (try the other tag) or all series were stale.
      if (queries.size === 0) continue;

      const hits = await this.byPod(ds, this.q(hMetric, model, windowSec), at);

      const perPod = [...queries.entries()].map(([pod, q]) => ({
        pod,
        queries: q,
        hits: hits.get(pod) ?? 0,
      }));

      const totalQ = perPod.reduce((a, p) => a + p.queries, 0);
      const totalH = perPod.reduce((a, p) => a + p.hits, 0);
      const topQ = perPod.reduce((mx, p) => Math.max(mx, p.queries), 0);

      // Clamp to [0, 100]: Prometheus increase()/rate() extrapolates from the
      // first/last samples in the window, so hits can slightly exceed queries
      // (e.g. 100.05%). The annotation schema enforces .max(100); an unclamped
      // overshoot would fail validation and silently drop the whole panel.
      const pct = (n: number) => Math.min(100, Math.max(0, n));

      return {
        metricTag: tag,
        hitRatePct: totalQ > 0 ? pct((totalH / totalQ) * 100) : 0,
        topPodSharePct: totalQ > 0 ? pct((topQ / totalQ) * 100) : 0,
        perPod,
      };
    }

    return null;
  }
}
