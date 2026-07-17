import type { MetricRowSpec } from "../core/row-descriptor.js";

// omni 不是 inference 形状 —— 不复用 SHARED_INFERENCE_ROWS;
// compare 网格只列语音实时性的 4 个头牌 + 错误率。
//
// labelKey 约定跟随 core/row-descriptor.ts 的 SHARED_INFERENCE_ROWS:短
// camelCase key(如 "ttftMean"),不带前缀 —— FE 侧 MetricRow.tsx 用
// `t(\`compare.metricRowLabel.${labelKey}\`)` 拼出完整 i18n key(不是
// "compare.rows.*")。Task 11 在 apps/web 两份 locale 的
// `compare.metricRowLabel` 下补齐这几个新 key。
export const vllmOmniBenchRowDescriptors: readonly MetricRowSpec[] = [
  {
    source: "metric",
    labelKey: "realtimeCeiling",
    metric: "realtimeCeiling",
    verdictKind: "throughput",
    digits: 0,
  },
  {
    source: "metric",
    labelKey: "audioTtfpC1Mean",
    metric: "audioTtfpC1.mean",
    verdictKind: "latency",
    format: "latencyMs",
  },
  {
    source: "metric",
    labelKey: "audioRtfPeakMean",
    metric: "audioRtfPeak.mean",
    verdictKind: "latency",
    digits: 2,
  },
  {
    source: "metric",
    labelKey: "voiceTaxMs",
    metric: "voiceTax.ms",
    verdictKind: "latency",
    format: "latencyMs",
  },
  {
    source: "metric",
    labelKey: "errorRate",
    metric: "errorRate",
    verdictKind: "errorRate",
    format: "percent",
  },
];
