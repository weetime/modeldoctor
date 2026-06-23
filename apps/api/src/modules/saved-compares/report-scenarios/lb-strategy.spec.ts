import { describe, expect, it } from "vitest";
import { lbStrategyProfile } from "./lb-strategy.js";

const sc = {
  benchmarks: [
    {
      missing: false,
      stageLabel: "ON",
      name: "on",
      serverMetrics: {
        prefixCache: {
          hitRatePct: 57.2,
          topPodSharePct: 41,
          metricTag: "v1",
          perPod: [
            { pod: "p1", queries: 800, hits: 500 },
            { pod: "p2", queries: 200, hits: 60 },
          ],
        },
      },
    },
  ],
} as never;

it("emits a per-pod distribution block citing pod shares", () => {
  const data = lbStrategyProfile.dataAssembly(sc);
  expect(data.promptBlock).toContain("ON");
  expect(data.promptBlock).toContain("80"); // p1 share% = 800/1000
  expect(data.preferredFigures).toContain("stage-bars-prefix-cache-hit");
  // Latency figures included as supporting evidence (headline stays hit-rate).
  expect(data.preferredFigures).toContain("stage-bars-ttft-p95");
  expect(data.preferredFigures).toContain("stage-bars-tpot-p95");
  expect(data.preferredFigures).toContain("stage-bars-e2e-p95");
  expect(data.preferredFigures).toContain("latency-distribution");
});
it("fragment leads with hit-rate", () => {
  expect(lbStrategyProfile.promptFragment("zh-CN")).toContain("命中率");
});
