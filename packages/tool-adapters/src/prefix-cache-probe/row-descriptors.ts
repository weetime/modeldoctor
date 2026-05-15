import type { MetricRowSpec } from "../core/row-descriptor.js";

// prefix-cache-probe is a single-purpose hit-rate tester; its results are
// rendered in a dedicated report component (not the inference compare grid).
export const prefixCacheProbeRowDescriptors: readonly MetricRowSpec[] = [];
