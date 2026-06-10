import { Injectable } from "@nestjs/common";
import type { PrefixCacheAnnotation } from "@modeldoctor/contracts";
import type { PrometheusFetcherService } from "../../alerts/prometheus-fetcher.service.js";

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
 * `value` is `null` for Prometheus "NaN" / "+Inf" stale markers — we treat
 * those as 0 so they don't corrupt aggregate math.
 */
@Injectable()
export class PrefixCacheSnapshotService {
  constructor(
    // Accept the concrete type for NestJS DI; tests pass `{ runQuery } as never`.
    private readonly fetcher: Pick<PrometheusFetcherService, "runQuery">,
  ) {}

  /** Build the PromQL expression for a single counter metric. */
  private q(metric: string, model: string, windowSec: number): string {
    return `sum by (pod) (increase(vllm:${metric}{model_name="${model}"}[${windowSec}s]))`;
  }

  /**
   * Execute an instant query and return a Map<pod, value>.
   *
   * The real runQuery shape for kind="instant" is:
   *   series[i].value: number | null
   * (null = Prometheus NaN/+Inf — treated as 0).
   *
   * Pods whose value resolves to 0 are still included in the map so that
   * hit lookups remain consistent (a pod with 0 queries is unusual but valid).
   */
  private async byPod(ds: unknown, query: string, at: Date): Promise<Map<string, number>> {
    const result = await this.fetcher.runQuery(ds as Parameters<PrometheusFetcherService["runQuery"]>[0], query, {
      kind: "instant",
      at,
    });
    const map = new Map<string, number>();
    for (const s of result.series) {
      const pod = s.labels["pod"] ?? s.labels["kubernetes_pod_name"] ?? "";
      if (!pod) continue;
      // value is number | null; null = non-finite Prometheus value → treat as 0
      map.set(pod, s.value ?? 0);
    }
    return map;
  }

  /**
   * Compute the prefix-cache annotation for a completed benchmark.
   *
   * Returns `null` if neither V1 nor V0 metrics have any data (e.g. the
   * vLLM instance doesn't expose prefix-cache counters).
   */
  async snapshot({ ds, model, windowSec, at }: SnapshotInput): Promise<PrefixCacheAnnotation | null> {
    for (const tag of ["v1", "v0"] as const) {
      const qMetric =
        tag === "v1" ? "prefix_cache_queries_total" : "gpu_prefix_cache_queries_total";
      const hMetric =
        tag === "v1" ? "prefix_cache_hits_total" : "gpu_prefix_cache_hits_total";

      const queries = await this.byPod(ds, this.q(qMetric, model, windowSec), at);
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

      return {
        metricTag: tag,
        hitRatePct: totalQ > 0 ? (totalH / totalQ) * 100 : 0,
        topPodSharePct: totalQ > 0 ? (topQ / totalQ) * 100 : 0,
        perPod,
      };
    }

    return null;
  }
}
