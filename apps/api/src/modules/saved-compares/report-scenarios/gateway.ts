import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const ZH = `本报告是网关 / HTTP 层压测(gateway,vegeta)。
- 关注 HTTP 吞吐与时延(e2e),没有 LLM 语义指标(TTFT/TPOT 不适用,不要提)。
- HEADLINE 用吞吐(req/s)或 e2e p95;错误率与状态码分布作为稳定性佐证。`;
const EN = `This is a gateway / HTTP-layer load test (gateway, vegeta).
- Focus on HTTP throughput and latency (e2e); there are no LLM semantic metrics (TTFT/TPOT do not apply — do not mention them).
- Headline with throughput (req/s) or e2e p95; error rate and status-code mix support the stability story.`;

function assemble(_sc: HydratedSavedCompare): ScenarioData {
  return {
    promptBlock: "",
    preferredFigures: ["stage-bars-throughput", "stage-bars-e2e-p95", "stage-bars-error-rate"],
  };
}
export const gatewayProfile: ReportScenarioProfile = {
  intent: "gateway",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
