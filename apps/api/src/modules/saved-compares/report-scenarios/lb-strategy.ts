import type { HydratedSavedCompare } from "@modeldoctor/contracts";
import { readPodDistribution } from "../metrics.js";
import type { Locale, ReportScenarioProfile, ScenarioData } from "./types.js";

const FRAGMENT_ZH = `本报告是负载均衡 / 路由策略验证(lb-strategy)。
- HEADLINE 与第一张 summary card 必须是 prefix cache 命中率的变化——这是实验存在的理由。
- 用 stage-bars-prefix-cache-hit 展示命中率,pod-traffic-distribution 展示每 pod 流量占比(集中度),pod-hit-rate 展示每 pod 命中率。
- 吞吐 / 时延(TTFT/TPOT/E2E)是次要佐证,不是 headline:小模型 prefill 便宜,命中率上升未必改善时延——但在数据支持时仍要给出 stage-bars-ttft-p95、stage-bars-tpot-p95、stage-bars-e2e-p95、latency-distribution 这几张图,并如实说明(改善 / 持平 / 回退),不要拿一个持平的吞吐差当 headline。
- top-pod share 持平而命中率上升 = 更好的缓存局部性且无热点(好事),不是失败。
- stage 标签 OFF/ON 指路由开关,不是离线/在线。`;

const FRAGMENT_EN = `This is a load-balancer / routing-strategy validation (lb-strategy).
- The HEADLINE and first summary card MUST be the prefix-cache hit-rate change — that is why the experiment exists.
- Use stage-bars-prefix-cache-hit for hit rate, pod-traffic-distribution for each pod's traffic share (concentration), pod-hit-rate for per-pod hit rate.
- Treat throughput / latency (TTFT/TPOT/E2E) as secondary evidence, not the headline: on small models prefill is cheap, so a higher hit rate need not improve latency — but when supported by the data, still include the stage-bars-ttft-p95, stage-bars-tpot-p95, stage-bars-e2e-p95 and latency-distribution figures and report what they show (gain / flat / regression) plainly, rather than leading with a flat throughput delta.
- A flat top-pod share alongside a rising hit rate means better cache locality without hot-spotting (good), not a failure.
- Stage labels OFF/ON mean the routing toggle, not offline/online.`;

function assemble(sc: HydratedSavedCompare): ScenarioData {
  const lines: string[] = [];
  for (const b of sc.benchmarks) {
    if (b.missing) continue;
    const pods = readPodDistribution(b.serverMetrics);
    if (!pods || pods.length === 0) continue;
    const total = pods.reduce((s, p) => s + p.queries, 0) || 1;
    const top = pods
      .map((p) => ({
        pod: p.pod,
        sharePct: (p.queries / total) * 100,
        hitPct: p.queries > 0 ? (p.hits / p.queries) * 100 : 0,
      }))
      .sort((a, z) => z.sharePct - a.sharePct)
      .slice(0, 6)
      .map((p) => `    ${p.pod}: share=${p.sharePct.toFixed(0)}% hit=${p.hitPct.toFixed(0)}%`)
      .join("\n");
    lines.push(`  [${b.stageLabel}] per-pod (top by share):\n${top}`);
  }
  const promptBlock =
    lines.length > 0 ? `## Per-pod traffic distribution\n${lines.join("\n")}` : "";
  return {
    promptBlock,
    preferredFigures: [
      "stage-bars-prefix-cache-hit",
      "pod-traffic-distribution",
      "pod-hit-rate",
      "stage-bars-top-pod-share",
      // Latency as supporting evidence — headline stays hit-rate. Each renders
      // only when every run carries that distribution (availableFigureRefIds).
      "stage-bars-ttft-p95",
      "stage-bars-tpot-p95",
      "stage-bars-e2e-p95",
      "latency-distribution",
      // Engine-metric mechanism evidence (durable serverMetrics.engineMetrics
      // snapshot): why latency moved — KV-cache pressure / preemption / queueing.
      "stage-bars-kv-cache",
      "stage-bars-preemption",
      "stage-bars-queue",
    ],
  };
}

export const lbStrategyProfile: ReportScenarioProfile = {
  intent: "lb-strategy",
  promptFragment: (locale: Locale) => (locale === "en-US" ? FRAGMENT_EN : FRAGMENT_ZH),
  dataAssembly: assemble,
};
