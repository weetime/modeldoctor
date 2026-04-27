import type {
  BenchmarkDataset,
  BenchmarkProfile,
} from "@modeldoctor/contracts";

export type LivePreset = Exclude<BenchmarkProfile, "custom" | "sharegpt">;

export const PROFILE_DEFAULTS: Record<
  LivePreset,
  {
    datasetName: BenchmarkDataset;
    datasetInputTokens: number;
    datasetOutputTokens: number;
    requestRate: number;
    totalRequests: number;
  }
> = {
  throughput: {
    datasetName: "random",
    datasetInputTokens: 1024,
    datasetOutputTokens: 128,
    requestRate: 0,
    totalRequests: 1000,
  },
  latency: {
    datasetName: "random",
    datasetInputTokens: 128,
    datasetOutputTokens: 128,
    requestRate: 1,
    totalRequests: 100,
  },
  long_context: {
    datasetName: "random",
    datasetInputTokens: 32_000,
    datasetOutputTokens: 100,
    requestRate: 1,
    totalRequests: 100,
  },
  generation_heavy: {
    datasetName: "random",
    datasetInputTokens: 1000,
    datasetOutputTokens: 2000,
    requestRate: 1,
    totalRequests: 200,
  },
};

export const PROFILE_ORDER: BenchmarkProfile[] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];

export function profileLabelKey(p: BenchmarkProfile): string {
  switch (p) {
    case "long_context":
      return "longContext";
    case "generation_heavy":
      return "generationHeavy";
    case "sharegpt":
      return "shareGpt";
    default:
      return p;
  }
}
