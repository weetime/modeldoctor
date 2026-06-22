import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是引擎 KV / 前缀缓存冷热对比(engine-kv-cache)。
- 主线是冷(R1)→热(R2)的提升:用 cold-warm-delta 展示配对 stage 的吞吐/TTFT Δ%。
- HEADLINE 用「热轮相对冷轮」的最大增益指标(通常 TTFT 或吞吐)。
- 命名以 "(rerun)" 配对冷/热;若只有单轮,退化为单点描述,不要编造冷热差。`;
const EN = `This is an engine KV / prefix-cache cold-vs-warm comparison (engine-kv-cache).
- The through-line is the cold (R1) → warm (R2) gain: use cold-warm-delta for the paired-stage throughput/TTFT Δ%.
- Lead with the largest warm-vs-cold gain metric (usually TTFT or throughput).
- Cold/warm pair by the "(rerun)" name suffix; with a single round, degrade to a single-point description — do not invent a cold/warm delta.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return { promptBlock: "", preferredFigures: ["cold-warm-delta", "stage-bars-ttft-p95", "stage-bars-throughput"] };
}
export const engineKvCacheProfile: ReportScenarioProfile = {
  intent: "engine-kv-cache",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
