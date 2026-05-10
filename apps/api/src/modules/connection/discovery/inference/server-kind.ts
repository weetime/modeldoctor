import {
  ENGINE_METRIC_NAMESPACE,
  type ServerKind,
  type InferenceConfidence,
} from "@modeldoctor/contracts";
import type {
  MetricsProbeData,
  ModelsProbeData,
  ProbeResult,
  ServerHeaderProbeData,
} from "../probes/index.js";

interface Inputs {
  metricsR: ProbeResult<MetricsProbeData>;
  serverHeaderR: ProbeResult<ServerHeaderProbeData>;
  modelsR: ProbeResult<ModelsProbeData>;
}

interface InferredField<T> {
  value: T | null;
  confidence: InferenceConfidence;
  evidence: string;
}

/**
 * Header-keyword → ServerKind mapping (likely-tier signal).
 * Order doesn't matter — first hit wins, all values are mutually exclusive.
 */
const HEADER_KEYWORDS: Array<[string, ServerKind]> = [
  ["vllm", "vllm"],
  ["sglang", "sglang"],
  ["tgi", "tgi"],
  ["text-generation-inference", "tgi"],
  ["mindie", "mindie"],
  ["lmdeploy", "lmdeploy"],
  ["higress", "higress"],
];

export function inferServerKind(inputs: Inputs): InferredField<ServerKind> {
  // (1) certain: /metrics prefix
  if (inputs.metricsR.ok && inputs.metricsR.data) {
    const body = inputs.metricsR.data.body;
    for (const [engineId, prefix] of Object.entries(ENGINE_METRIC_NAMESPACE)) {
      if (body.includes(`\n${prefix}`) || body.startsWith(prefix)) {
        return {
          value: engineId as ServerKind,
          confidence: "certain",
          evidence: `metric prefix '${prefix}' detected at /metrics`,
        };
      }
    }
  }

  // (2) likely: Server / X-Powered-By header
  if (inputs.serverHeaderR.ok && inputs.serverHeaderR.data) {
    const haystacks = [inputs.serverHeaderR.data.server, inputs.serverHeaderR.data.poweredBy]
      .filter((s): s is string => !!s)
      .join(" ");
    for (const [keyword, kind] of HEADER_KEYWORDS) {
      if (haystacks.includes(keyword)) {
        return {
          value: kind,
          confidence: "likely",
          evidence: `header contains '${keyword}'`,
        };
      }
    }
  }

  // (3) unknown
  return {
    value: null,
    confidence: "unknown",
    evidence: "no engine signal detected",
  };
}
