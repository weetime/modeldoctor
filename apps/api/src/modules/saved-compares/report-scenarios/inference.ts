import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const MULTI_ZH = `本报告是多引擎推理对比(inference,多 run)。
- 主线是不同引擎在吞吐 / TTFT / E2E 上的相对位置;用 compare-grid + stage-bars-throughput + stage-bars-ttft-p95。
- HEADLINE 用赢家引擎与其吞吐领先幅度;同档差距 <10% 不作为优势判定,直说并列。`;
const MULTI_EN = `This is a multi-engine inference comparison (inference, multiple runs).
- The through-line is each engine's relative standing on throughput / TTFT / E2E; use compare-grid + stage-bars-throughput + stage-bars-ttft-p95.
- Headline with the winning engine and its throughput lead; a <10% gap in a tier is not an advantage — call it a tie.`;
const SINGLE_ZH = `本报告是单引擎推理基线(inference,单 run 或同引擎多配置)。
- 主线是该配置的 TTFT / E2E 分布与吞吐;用 stage-bars-ttft-p95 + stage-bars-e2e-p95。
- 没有跨引擎对比时,不要硬造"赢家";聚焦绝对水平与是否达 SLO。`;
const SINGLE_EN = `This is a single-engine inference baseline (inference, one run or same-engine configs).
- The through-line is this config's TTFT / E2E distribution and throughput; use stage-bars-ttft-p95 + stage-bars-e2e-p95.
- With no cross-engine comparison, do not manufacture a "winner"; focus on absolute levels and SLO attainment.`;

function makeProfile(multi: boolean): ReportScenarioProfile {
  return {
    intent: multi ? "inference-multi" : "inference-single",
    promptFragment: (l: Locale) =>
      multi ? (l === "en-US" ? MULTI_EN : MULTI_ZH) : l === "en-US" ? SINGLE_EN : SINGLE_ZH,
    dataAssembly: (_sc: HydratedSavedCompare): ScenarioData => ({
      promptBlock: "",
      preferredFigures: multi
        ? ["compare-grid", "stage-bars-throughput", "stage-bars-ttft-p95", "latency-distribution"]
        : [
            "stage-bars-ttft-p95",
            "stage-bars-e2e-p95",
            "stage-bars-throughput",
            "latency-distribution",
          ],
    }),
  };
}
export const inferenceMultiProfile = makeProfile(true);
export const inferenceSingleProfile = makeProfile(false);
