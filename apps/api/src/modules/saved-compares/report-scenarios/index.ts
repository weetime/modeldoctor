import { defaultProfile } from "./default.js";
import { capacityProfile } from "./capacity.js";
import { engineKvCacheProfile } from "./engine-kv-cache.js";
import { gatewayProfile } from "./gateway.js";
import { inferenceMultiProfile, inferenceSingleProfile } from "./inference.js";
import { lbStrategyProfile } from "./lb-strategy.js";
import type { ReportIntent, ReportScenarioProfile } from "./types.js";

export function resolveReportIntent(
  scenario: string | null | undefined,
  runCount: number,
): ReportIntent {
  switch (scenario) {
    case "lb-strategy":
      return "lb-strategy";
    case "engine-kv-cache":
      return "engine-kv-cache";
    case "capacity":
      return "capacity";
    case "gateway":
      return "gateway";
    case "inference":
      return runCount <= 1 ? "inference-single" : "inference-multi";
    default:
      return "default";
  }
}

const REGISTRY: Record<ReportIntent, ReportScenarioProfile> = {
  default: defaultProfile,
  "lb-strategy": lbStrategyProfile,
  "engine-kv-cache": engineKvCacheProfile,
  capacity: capacityProfile,
  gateway: gatewayProfile,
  "inference-single": inferenceSingleProfile,
  "inference-multi": inferenceMultiProfile,
};

export function getReportProfile(intent: ReportIntent): ReportScenarioProfile {
  return REGISTRY[intent] ?? defaultProfile;
}

export { REGISTRY as reportScenarioRegistry };
export type { ReportScenarioProfile } from "./types.js";
