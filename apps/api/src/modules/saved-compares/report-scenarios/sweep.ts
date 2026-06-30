import {
  availableSweepFigures,
  type FigureRefId,
  type HydratedSavedCompare,
} from "@modeldoctor/contracts";
import { buildSweepSeries, formatSweepMatrix } from "../sweep-prompt.js";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

// Figure hierarchy (mirrors lb-strategy's headline→support→mechanism→data shape,
// mixing chart types instead of all-lines): trend-line headline → verdict BARS
// at peak concurrency → latency lines → engine-internal mechanism lines → the
// data-matrix table. Filtered to what the aggregated data can fill.
const FIGURE_ORDER: FigureRefId[] = [
  "sweep-throughput",
  "sweep-peak",
  "sweep-ttft",
  "sweep-kv-cache",
  "sweep-queue",
  "sweep-e2e",
  "sweep-matrix",
];

const ZH = `本报告是参数扫描(sweep):同一 workload 在多个并发档上跑,按引擎分 series。
- 主轴是并发(concurrency);图是 metric-vs-并发折线,一条线一个引擎。
- 叙述要讲清:① 吞吐随并发的扩展曲线与饱和/回退拐点;② 引擎间的交叉点(谁在低并发领先、谁在高并发反超);③ 用引擎内部指标(KV cache 使用率、调度排队深度)对延迟/吞吐拐点做根因归因(如"排队深度暴涨→首字延迟崩"、"KV 打满→吞吐回退")。
- HEADLINE 用最高并发档的吞吐领先幅度 + 一个引擎内部归因点。务必引用 Sweep matrix 里的具体数值。
- 图表分层(混用图型,别全折线):趋势折线(sweep-throughput)打头 → sweep-peak 柱给"峰值并发谁赢"的判决快照 → sweep-ttft 等时延折线佐证 → sweep-kv-cache/sweep-queue 折线做机制归因 → sweep-matrix 表给全量数据。
- 不要逐 stage 罗列;以"引擎 × 并发曲线"组织。`;

const EN = `This is a parametric sweep report: one workload across several concurrency levels, grouped into series by engine.
- The axis is concurrency; figures are metric-vs-concurrency lines, one line per engine.
- The narrative must cover: (1) the throughput scaling curve and its saturation/regression knee; (2) cross-engine crossover points (who leads at low concurrency, who overtakes at high); (3) root-cause attribution of latency/throughput knees using engine-internal metrics (KV-cache usage, scheduler waiting-queue depth) — e.g. "waiting depth explodes → TTFT collapses", "KV saturates → throughput regresses".
- Headline with the top-concurrency throughput lead plus one engine-internal attribution. Always cite concrete numbers from the Sweep matrix.
- Figure hierarchy (mix chart types, not all lines): the trend line (sweep-throughput) leads → sweep-peak BARS give the "who wins at peak concurrency" verdict snapshot → latency lines (sweep-ttft, …) as support → sweep-kv-cache / sweep-queue lines for mechanism attribution → sweep-matrix table for the full data.
- Do NOT enumerate stage-by-stage; organize around engine × concurrency curves.`;

function assemble(sc: HydratedSavedCompare): ScenarioData {
  const series = buildSweepSeries(sc);
  const avail = availableSweepFigures(series);
  return {
    promptBlock: formatSweepMatrix(series),
    // Offer in hierarchy order, filtered to what the data can fill.
    preferredFigures: FIGURE_ORDER.filter((r) => avail.has(r)),
  };
}

export const sweepProfile: ReportScenarioProfile = {
  intent: "sweep",
  promptFragment: (l: Locale) => (l === "en-US" ? EN : ZH),
  dataAssembly: assemble,
};
