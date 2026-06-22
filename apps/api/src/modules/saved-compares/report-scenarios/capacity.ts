import type { FigureRefId, HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是容量规划(capacity),工具按并发/负载做了 sweep。
- 主图是 throughput-vs-concurrency:展示吞吐随并发的拐点(饱和点)。
- HEADLINE 用饱和点的并发档与对应吞吐;若曲线缺失(旧数据)则退回最终聚合百分位,并在 caveats 注明无 sweep 曲线。`;
const EN = `This is a capacity-planning report (capacity); the tool swept concurrency/load.
- The lead figure is throughput-vs-concurrency: show the saturation knee.
- Headline with the knee's concurrency level and its throughput; if the curve is missing (legacy data) fall back to final aggregate percentiles and note "no sweep curve" in caveats.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return { promptBlock: "", preferredFigures: ["throughput-vs-concurrency" as FigureRefId, "compare-grid"] };
}
export const capacityProfile: ReportScenarioProfile = {
  intent: "capacity",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
