import { describe, expect, it } from "vitest";
import { buildPodHeatmap } from "./PodDistributionChart";

describe("buildPodHeatmap", () => {
  it("pivots stages × pods into cells with min/max", () => {
    const hm = buildPodHeatmap([
      {
        stage: "OFF",
        pods: [
          { pod: "p1", value: 10 },
          { pod: "p2", value: 30 },
        ],
      },
      {
        stage: "ON",
        pods: [
          { pod: "p1", value: 20 },
          { pod: "p2", value: 40 },
        ],
      },
    ]);
    expect(hm.stages).toEqual(["OFF", "ON"]);
    expect(hm.pods).toEqual(["p1", "p2"]);
    expect(hm.cells).toHaveLength(4);
    expect(hm.cells).toContainEqual([0, 0, 10]);
    expect(hm.cells).toContainEqual([1, 1, 40]);
    expect(hm.min).toBe(10);
    expect(hm.max).toBe(40);
  });

  it("omits a cell for a pod missing from a stage", () => {
    const hm = buildPodHeatmap([
      { stage: "OFF", pods: [{ pod: "p1", value: 5 }] },
      {
        stage: "ON",
        pods: [
          { pod: "p1", value: 6 },
          { pod: "p2", value: 7 },
        ],
      },
    ]);
    expect(hm.pods).toEqual(["p1", "p2"]);
    expect(hm.cells).toHaveLength(3); // p2 absent from OFF
  });

  it("handles empty input", () => {
    const hm = buildPodHeatmap([]);
    expect(hm.cells).toHaveLength(0);
    expect(hm.min).toBe(0);
    expect(hm.max).toBe(1);
  });
});
