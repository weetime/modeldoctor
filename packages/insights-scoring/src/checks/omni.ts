import type { CheckDescriptor } from "../descriptors.js";

// 阈值语义见 spec §4.7:TTFP p50 <1s 优 / <3s 可;RTF mean <0.7 富余 /
// <1 达标 / ≥1 超载。warn/crit 数值落在 seed.ts 的 default profile 里。
export const omniChecks: CheckDescriptor[] = [
  {
    id: "omni.realtime_ceiling",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "throughput",
    defaultWeight: 1.0,
    direction: "higher_is_better",
    metricKind: "realtimeCeiling",
  },
  {
    id: "omni.audio_ttfp.c1.mean.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "responsiveness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "audioTtfpC1.mean",
  },
  {
    id: "omni.audio_ttfp.peak.p99.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "tail",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    metricKind: "audioTtfpPeak.p99",
  },
  {
    id: "omni.audio_rtf.peak.mean",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "smoothness",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "audioRtfPeak.mean",
  },
  {
    id: "omni.voice_tax.ms",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "efficiency",
    defaultWeight: 0.5,
    direction: "lower_is_better",
    metricKind: "voiceTax.ms",
  },
  {
    id: "omni.error_rate",
    scenario: "omni",
    toolFilter: ["vllm-omni-bench"],
    axis: "stability",
    defaultWeight: 1.0,
    direction: "lower_is_better",
    metricKind: "errorRate",
  },
];
