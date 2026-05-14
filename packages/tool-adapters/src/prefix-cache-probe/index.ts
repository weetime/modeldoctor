import type { MetricKind, ToolAdapter } from "../core/interface.js";
import { buildCommand, getMaxDurationSeconds, parseFinalReport, parseProgress } from "./runtime.js";
import {
  prefixCacheProbeParamDefaults,
  prefixCacheProbeParamsSchema,
  prefixCacheProbeReportSchema,
} from "./schema.js";

// prefix-cache-probe is a routing-stickiness diagnostic, NOT a load
// generator. None of the inference-shape MetricKinds apply, but we
// still keep an exhaustive switch so the next MetricKind added causes
// a type error here too (forcing a deliberate decision per tool).
function readMetric(kind: MetricKind, _data: Record<string, unknown>): number | null {
  switch (kind) {
    case "ttft.p95":
    case "ttft.p99":
    case "itl.p95":
    case "e2e.p95":
    case "e2e.p99":
    case "errorRate":
    case "requestsPerSec":
    case "outputTokensPerSec":
    case "tailRatio":
      return null;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}

export const prefixCacheProbeAdapter: ToolAdapter = {
  name: "prefix-cache-probe",
  scenarios: ["prefix-cache-validation"] as const,
  paramsSchema: prefixCacheProbeParamsSchema,
  reportSchema: prefixCacheProbeReportSchema,
  paramDefaults: prefixCacheProbeParamDefaults,
  buildCommand,
  parseProgress,
  parseFinalReport,
  getMaxDurationSeconds,
  readMetric,
};

export type {
  PrefixCacheProbeParams,
  PrefixCacheProbeReport,
} from "./schema.js";
