import type { MetricRowSpec } from "../core/row-descriptor.js";

// tau3 (agent scenario) is not inference-shaped — no ttft/itl/e2e/throughput/
// errorRate rows apply (readMetric always returns null; see runtime.ts).
// The AgentReport component renders pass^1/pass^k/attribution directly from
// the report data instead of going through the shared compare-grid rows.
// Empty on purpose: satisfies `Record<ToolName, …>` exhaustiveness in
// `core/row-descriptors.fe.ts` without implying tau3 has compare-grid rows.
export const tau3RowDescriptors: readonly MetricRowSpec[] = [];
