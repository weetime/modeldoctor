/**
 * Unit tests for PrefixCacheSnapshotService.
 *
 * Real PromQueryResult shape (instant query):
 *   { datasource, query, kind: "instant", truncated, series: [{ labels, value: number|null }] }
 *
 * The fake fetcher mirrors exactly this shape so the tests are honest about
 * what the service will receive from PrometheusFetcherService.runQuery.
 */
import { describe, expect, it, vi } from "vitest";
import type { PromQueryResult } from "../../alerts/prometheus-fetcher.service.js";
import { PrefixCacheSnapshotService } from "./prefix-cache-snapshot.service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstantResult(
  series: Array<{ labels: Record<string, string>; value: number | null }>,
): PromQueryResult {
  return {
    datasource: { id: "ds-1", name: "test-prom" },
    query: "test-query",
    kind: "instant",
    truncated: false,
    series,
  };
}

const EMPTY_RESULT: PromQueryResult = makeInstantResult([]);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("PrefixCacheSnapshotService", () => {
  const DS = { id: "ds-1", baseUrl: "http://prom:9090" } as never;
  const MODEL = "meta-llama/Llama-3-8B";
  const WINDOW = 600;
  const AT = new Date("2025-01-01T12:00:00Z");

  // Expected query strings (computed from the q() helper formula)
  const V1_Q_QUERY = `sum by (pod) (increase(vllm:prefix_cache_queries_total{model_name="${MODEL}"}[${WINDOW}s]))`;
  const V1_H_QUERY = `sum by (pod) (increase(vllm:prefix_cache_hits_total{model_name="${MODEL}"}[${WINDOW}s]))`;
  const V0_Q_QUERY = `sum by (pod) (increase(vllm:gpu_prefix_cache_queries_total{model_name="${MODEL}"}[${WINDOW}s]))`;
  const V0_H_QUERY = `sum by (pod) (increase(vllm:gpu_prefix_cache_hits_total{model_name="${MODEL}"}[${WINDOW}s]))`;

  // -------------------------------------------------------------------------
  // (a) v1 series → correct hitRatePct + topPodSharePct + perPod
  // -------------------------------------------------------------------------
  it("(a) returns correct annotation when v1 series are present", async () => {
    // pod-a: 200 queries, 150 hits
    // pod-b: 100 queries,  50 hits
    // total: 300 queries, 200 hits  → hitRatePct = 200/300*100 ≈ 66.667
    // topQ = 200 (pod-a)           → topPodSharePct = 200/300*100 ≈ 66.667
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(
        // v1 queries
        makeInstantResult([
          { labels: { pod: "pod-a" }, value: 200 },
          { labels: { pod: "pod-b" }, value: 100 },
        ]),
      )
      .mockResolvedValueOnce(
        // v1 hits
        makeInstantResult([
          { labels: { pod: "pod-a" }, value: 150 },
          { labels: { pod: "pod-b" }, value: 50 },
        ]),
      );

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    // Verify the exact query strings emitted
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      DS,
      V1_Q_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      DS,
      V1_H_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );

    expect(result).not.toBeNull();
    expect(result!.metricTag).toBe("v1");
    expect(result!.hitRatePct).toBeCloseTo((200 / 300) * 100, 5);
    expect(result!.topPodSharePct).toBeCloseTo((200 / 300) * 100, 5);
    expect(result!.perPod).toEqual(
      expect.arrayContaining([
        { pod: "pod-a", queries: 200, hits: 150 },
        { pod: "pod-b", queries: 100, hits: 50 },
      ]),
    );
    expect(result!.perPod).toHaveLength(2);
    // Only v1 was tried — no v0 calls
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // (b) v1 empty → falls back to v0 (gpu_) metric
  // -------------------------------------------------------------------------
  it("(b) falls back to v0 gpu_ metrics when v1 series are empty", async () => {
    // v0: pod-x: 80 queries, 40 hits
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(EMPTY_RESULT) // v1 queries → empty
      .mockResolvedValueOnce(
        // v0 queries
        makeInstantResult([{ labels: { pod: "pod-x" }, value: 80 }]),
      )
      .mockResolvedValueOnce(
        // v0 hits
        makeInstantResult([{ labels: { pod: "pod-x" }, value: 40 }]),
      );

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    // First call: v1 queries
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      DS,
      V1_Q_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );
    // Second call: v0 queries (fallback)
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      DS,
      V0_Q_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );
    // Third call: v0 hits
    expect(runQuery).toHaveBeenNthCalledWith(
      3,
      DS,
      V0_H_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );

    expect(result).not.toBeNull();
    expect(result!.metricTag).toBe("v0");
    expect(result!.hitRatePct).toBeCloseTo(50, 5);
    expect(result!.topPodSharePct).toBeCloseTo(100, 5);
    expect(result!.perPod).toEqual([{ pod: "pod-x", queries: 80, hits: 40 }]);
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // (c) no series at all → returns null
  // -------------------------------------------------------------------------
  it("(c) returns null when both v1 and v0 queries return empty series", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(EMPTY_RESULT) // v1 queries → empty
      .mockResolvedValueOnce(EMPTY_RESULT); // v0 queries → empty

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    expect(result).toBeNull();
    // Only query calls (no hit calls when query is empty)
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Edge (Fix A): null-valued series are SKIPPED — not written to the map
  // -------------------------------------------------------------------------
  it("(d) skips null-valued series: null pod absent from perPod, real pod correct", async () => {
    // pod-a: 100 queries, 60 hits (real)
    // pod-b: null (stale/NaN) → must NOT appear in perPod
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(
        makeInstantResult([
          { labels: { pod: "pod-a" }, value: 100 },
          { labels: { pod: "pod-b" }, value: null }, // stale/NaN from Prom
        ]),
      )
      .mockResolvedValueOnce(
        makeInstantResult([
          { labels: { pod: "pod-a" }, value: 60 },
          { labels: { pod: "pod-b" }, value: null },
        ]),
      );

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    expect(result).not.toBeNull();
    expect(result!.metricTag).toBe("v1");
    // Only pod-a produced a real sample — pod-b must be absent
    expect(result!.perPod).toHaveLength(1);
    expect(result!.perPod[0]).toEqual({ pod: "pod-a", queries: 100, hits: 60 });
    // Aggregate math over pod-a only: hitRatePct = 60/100*100 = 60, topPodSharePct = 100
    expect(result!.hitRatePct).toBeCloseTo(60, 5);
    expect(result!.topPodSharePct).toBeCloseTo(100, 5);
  });

  // -------------------------------------------------------------------------
  // Edge (Fix A): all-null V1 result → empty map → falls back to V0
  // -------------------------------------------------------------------------
  it("(e) all-null V1 result falls back to V0 (not a misleading zero-query annotation)", async () => {
    // V1 queries returns a series but ALL values are null → empty map → try V0
    // V0 returns a real pod
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(
        // v1 queries — all null
        makeInstantResult([
          { labels: { pod: "pod-a" }, value: null },
          { labels: { pod: "pod-b" }, value: null },
        ]),
      )
      .mockResolvedValueOnce(
        // v0 queries — real value
        makeInstantResult([{ labels: { pod: "pod-x" }, value: 50 }]),
      )
      .mockResolvedValueOnce(
        // v0 hits
        makeInstantResult([{ labels: { pod: "pod-x" }, value: 25 }]),
      );

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    // Must fall through to v0, not stop at a misleading zero-query v1 result
    expect(result).not.toBeNull();
    expect(result!.metricTag).toBe("v0");
    expect(result!.perPod).toEqual([{ pod: "pod-x", queries: 50, hits: 25 }]);
    expect(result!.hitRatePct).toBeCloseTo(50, 5);
    // V1 query call + V0 query call + V0 hits call
    expect(runQuery).toHaveBeenCalledTimes(3);
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      DS,
      V0_Q_QUERY,
      expect.objectContaining({ kind: "instant" }),
    );
  });

  // -------------------------------------------------------------------------
  // Fix B: kubernetes_pod_name label fallback
  // -------------------------------------------------------------------------
  it("(f) uses kubernetes_pod_name label as pod identifier when pod label is absent", async () => {
    // Some vLLM deployments emit kubernetes_pod_name instead of pod in the labels
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(
        makeInstantResult([
          { labels: { kubernetes_pod_name: "vllm-pod-0" }, value: 120 },
        ]),
      )
      .mockResolvedValueOnce(
        makeInstantResult([
          { labels: { kubernetes_pod_name: "vllm-pod-0" }, value: 80 },
        ]),
      );

    const svc = new PrefixCacheSnapshotService({ runQuery } as never);
    const result = await svc.snapshot({ ds: DS, model: MODEL, windowSec: WINDOW, at: AT });

    expect(result).not.toBeNull();
    expect(result!.metricTag).toBe("v1");
    // Pod identifier must come from kubernetes_pod_name
    expect(result!.perPod).toHaveLength(1);
    expect(result!.perPod[0]).toEqual({ pod: "vllm-pod-0", queries: 120, hits: 80 });
    expect(result!.hitRatePct).toBeCloseTo((80 / 120) * 100, 5);
    expect(result!.topPodSharePct).toBeCloseTo(100, 5);
  });
});
