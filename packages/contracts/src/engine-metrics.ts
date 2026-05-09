import { z } from "zod";
import { ENGINE_IDS, type EngineCapability, type EngineId, engineCapabilitySchema } from "./engine.js";

export const panelKindSchema = z.enum(["stat", "gauge", "timeseries", "heatmap"]);
export type PanelKind = z.infer<typeof panelKindSchema>;

export const panelGroupSchema = z.enum([
  "topline",
  "latency",
  "throughput",
  "engine",
  "health",
]);
export type PanelGroup = z.infer<typeof panelGroupSchema>;

export const panelUnitSchema = z.enum([
  "ms",
  "s",
  "%",
  "ratio",
  "tps",
  "rps",
  "count",
  "bytes",
]);
export type PanelUnit = z.infer<typeof panelUnitSchema>;

/**
 * One PromQL template variant. `tag` is informational (e.g. "v0", "v1") —
 * variants are tried in order regardless of tag; the first non-empty result wins.
 */
export interface PromQLVariant {
  tag?: string;
  expr: string;
}

export interface EngineMetricSpec {
  /** Stable cross-engine semantic key. UI uses it to choose layout slot
   * + i18n label. Examples: "ttft_p99", "kv_cache_usage", "queue_depth". */
  key: string;
  group: PanelGroup;
  panel: PanelKind;
  unit: PanelUnit;
  /** PromQL templates. Tried in order; first one returning ANY non-empty
   * series wins. `${model}` is the only allowed interpolation. */
  promql: PromQLVariant[];
  /** Optional thresholds for stat/gauge color coding. */
  thresholds?: Array<{ at: number; severity: "ok" | "warn" | "crit" }>;
}

export interface EngineManifest {
  engineId: EngineId;
  capability: EngineCapability;
  /** Display name for the section subtitle (e.g. "vLLM (V0/V1)"). */
  displayName: string;
  metrics: EngineMetricSpec[];
}

// ---- HTTP wire types ----

export const engineMetricsSnapshotQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  /** Sampling step in seconds. Defaults to 15 server-side (= Prom scrape). */
  step: z.coerce.number().int().min(1).max(3600).optional(),
});
export type EngineMetricsSnapshotQuery = z.infer<typeof engineMetricsSnapshotQuerySchema>;

const sampleTuple = z.tuple([z.number(), z.number()]);

const engineMetricsSeriesSchema = z.object({
  /** Optional series identifier — pod name / instance / nothing for aggregate. */
  label: z.string().optional(),
  samples: z.array(sampleTuple),
});

const engineMetricsPanelResultSchema = z.object({
  key: z.string(),
  group: panelGroupSchema,
  panel: panelKindSchema,
  unit: panelUnitSchema,
  /** True when no data was retrieved for any reason. */
  unavailable: z.boolean(),
  /** Why unavailable (only present when `unavailable: true`). */
  reason: z.enum(["no_data", "prom_error", "not_supported"]).optional(),
  series: z.array(engineMetricsSeriesSchema),
});

export const engineMetricsSnapshotResponseSchema = z.object({
  engineId: z.enum(ENGINE_IDS),
  capability: engineCapabilitySchema,
  window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    step: z.number().int().min(1),
  }),
  panels: z.array(engineMetricsPanelResultSchema),
});
export type EngineMetricsSnapshotResponse = z.infer<
  typeof engineMetricsSnapshotResponseSchema
>;
export type EngineMetricsPanelResult = z.infer<typeof engineMetricsPanelResultSchema>;
export type EngineMetricsSeries = z.infer<typeof engineMetricsSeriesSchema>;
