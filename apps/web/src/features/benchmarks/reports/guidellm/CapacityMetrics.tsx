import type { Benchmark } from "@modeldoctor/contracts";
import { GuidellmInferenceMetrics } from "./InferenceMetrics";

export interface GuidellmCapacityMetricsProps {
  benchmark: Benchmark;
}

/**
 * Phase 11 placeholder: capacity (sweep) mode reuses the inference metric
 * tiles, since a guidellm sweep summary is still a valid GuidellmReport
 * envelope. The dedicated sweep-curve visualization (RPS-vs-latency knee,
 * SLO band) lands in a follow-up PR.
 */
export function GuidellmCapacityMetrics({ benchmark }: GuidellmCapacityMetricsProps) {
  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Sweep curve visualization is coming in a follow-up release. Raw output is available below.
      </div>
      <GuidellmInferenceMetrics benchmark={benchmark} />
    </div>
  );
}
