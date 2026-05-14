import type { MetricKind, ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import { guidellmParamDefaults, guidellmParamsSchema, guidellmReportSchema } from "./schema.js";

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
    case "ttft.p95":
      return dist(data, "ttft", "p95");
    case "ttft.p99":
      return dist(data, "ttft", "p99");
    case "itl.p95":
      return dist(data, "itl", "p95");
    case "e2e.p95":
      return dist(data, "e2eLatency", "p95");
    case "e2e.p99":
      return dist(data, "e2eLatency", "p99");
    case "errorRate": {
      const r = data.requests as { total?: number; error?: number } | undefined;
      const t = fin(r?.total);
      const e = fin(r?.error);
      return t === null || e === null || t === 0 ? null : e / t;
    }
    case "requestsPerSec": {
      const r = data.requestsPerSecond as { mean?: number } | undefined;
      return fin(r?.mean);
    }
    case "outputTokensPerSec": {
      const r = data.outputTokensPerSecond as { mean?: number } | undefined;
      return fin(r?.mean);
    }
    case "tailRatio": {
      const p50 = dist(data, "e2eLatency", "p50");
      const p99 = dist(data, "e2eLatency", "p99");
      return p50 === null || p99 === null || p50 === 0 ? null : p99 / p50;
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

export const guidellmAdapter: ToolAdapter = {
  name: "guidellm",
  scenarios: ["inference", "capacity"] as const,
  paramsSchema: guidellmParamsSchema,
  reportSchema: guidellmReportSchema,
  paramDefaults: guidellmParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric,
};

export type { GuidellmParams, GuidellmReport } from "./schema.js";
