/**
 * Frontend-only "viz registry" for engine metrics. The backend wire type
 * (`EngineMetricsPanelResult`) carries only data (key + samples + unit + optional
 * thresholds). This map decides — per metric key — which chart primitive
 * renders it and which dashboard group it belongs to.
 *
 * Adding a new metric: extend the backend manifest with the PromQL, then add
 * a row here. Unknown keys fall back to `kind: "line"`.
 */

export type ChartKind = "stat" | "gauge" | "line" | "bar" | "pie";
export type Group = "topline" | "latency" | "throughput" | "engine" | "health";

export interface MetricViz {
  kind: ChartKind;
  group: Group;
  /** Optional explicit max for gauges (otherwise auto-derived from unit). */
  gaugeMax?: number;
  /** Optional bar-stack id; when set BarChart renders stacked bars. */
  barStack?: string;
}

export const METRIC_VIZ: Record<string, MetricViz> = {
  // ---- topline ----
  success_rate: { kind: "stat", group: "topline" },
  active_requests: { kind: "gauge", group: "topline" },
  system_efficiency: { kind: "stat", group: "topline" },
  ttft_p99: { kind: "stat", group: "topline" },
  preemption_rate: { kind: "stat", group: "topline" },
  request_latency_p99: { kind: "stat", group: "topline" },
  // ---- latency ----
  e2e_latency: { kind: "line", group: "latency" },
  stage_breakdown: { kind: "line", group: "latency" },
  ttft_vs_tpot: { kind: "line", group: "latency" },
  // ---- throughput ----
  token_throughput_in: { kind: "line", group: "throughput" },
  token_throughput_out: { kind: "line", group: "throughput" },
  token_io_ratio: { kind: "stat", group: "throughput" },
  prefix_cache_savings: { kind: "gauge", group: "throughput" },
  request_queue_time: { kind: "line", group: "throughput" },
  request_length_heatmap: { kind: "bar", group: "throughput", barStack: "hist" },
  tokenize_rate: { kind: "line", group: "throughput" },
  embedding_rate: { kind: "line", group: "throughput" },
  // ---- engine ----
  kv_cache_usage: { kind: "line", group: "engine" },
  prefix_cache_hit_rate: { kind: "gauge", group: "engine" },
  scheduler_state: { kind: "line", group: "engine" },
  queue_metrics: { kind: "line", group: "engine" },
  // ---- health ----
  python_gc_memory: { kind: "line", group: "health" },
  finish_reason: { kind: "line", group: "health" },
};

export function vizFor(key: string): MetricViz {
  return METRIC_VIZ[key] ?? { kind: "line", group: "throughput" };
}
