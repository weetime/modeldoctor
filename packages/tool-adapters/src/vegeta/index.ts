import type { MetricKind, ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { vegetaParamDefaults, vegetaParamsSchema, vegetaReportSchema } from "./schema.js";

const fin = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const dist = (
  data: Record<string, unknown>,
  key: string,
  field: string,
): number | null => {
  const d = data[key] as Record<string, unknown> | undefined;
  return fin(d?.[field]);
};

function readMetric(kind: MetricKind, data: Record<string, unknown>): number | null {
  switch (kind) {
    // vegeta is generic HTTP — no token-level instrumentation.
    case "ttft.p95":
    case "ttft.p99":
    case "itl.p95":
    case "outputTokensPerSec":
      return null;
    case "e2e.p95":
      return dist(data, "latencies", "p95");
    case "e2e.p99":
      return dist(data, "latencies", "p99");
    case "errorRate": {
      // `data.success` is a 0-100 percentage in vegeta's normalized schema.
      const success = fin(data.success);
      return success === null ? null : 1 - success / 100;
    }
    case "requestsPerSec": {
      const r = data.requests as { throughput?: number } | undefined;
      return fin(r?.throughput);
    }
    case "tailRatio": {
      const p50 = dist(data, "latencies", "p50");
      const p99 = dist(data, "latencies", "p99");
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

export const vegetaAdapter: ToolAdapter = {
  name: "vegeta",
  scenarios: ["gateway"] as const,
  paramsSchema: vegetaParamsSchema,
  reportSchema: vegetaReportSchema,
  paramDefaults: vegetaParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric,
};

export type { VegetaParams, VegetaReport } from "./schema.js";
