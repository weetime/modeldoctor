import { ENGINE_METRIC_NAMESPACE, type InferenceConfidence } from "@modeldoctor/contracts";
import type { MetricsProbeData, ProbeResult } from "../probes/index.js";

interface Inputs {
  baseUrl: string;
  metricsR: ProbeResult<MetricsProbeData>;
}

interface InferredField {
  value: string | null;
  confidence: InferenceConfidence;
  evidence: string;
}

export function inferPrometheusUrl(inputs: Inputs): InferredField {
  if (!inputs.metricsR.ok || !inputs.metricsR.data) {
    return {
      value: null,
      confidence: "unknown",
      evidence: "no /metrics endpoint detected",
    };
  }
  const body = inputs.metricsR.data.body;
  const hasKnownPrefix = Object.values(ENGINE_METRIC_NAMESPACE).some(
    (prefix) => body.includes(`\n${prefix}`) || body.startsWith(prefix),
  );
  if (hasKnownPrefix) {
    return {
      value: inputs.baseUrl,
      confidence: "likely",
      evidence:
        "engine exposes /metrics directly; OK for single-pod deployment, otherwise use your aggregating Prometheus URL",
    };
  }
  return {
    value: inputs.baseUrl,
    confidence: "guess",
    evidence: "endpoint exposes /metrics with unrecognized format; verify before use",
  };
}
