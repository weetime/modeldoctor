import { describe, expect, it } from "vitest";
import { savedCompareSchema } from "./saved-compares.js";

const base = {
  id: "c1",
  userId: "u1",
  name: "n",
  benchmarkIds: ["a", "b"],
  stageLabels: { a: "OFF", b: "ON" },
  baselineId: null,
  context: null,
  classification: "internal",
  clientName: null,
  version: 1,
  narrative: null,
  narrativeAt: null,
  createdAt: "2026-06-22T00:00:00.000Z",
  updatedAt: "2026-06-22T00:00:00.000Z",
};

it("accepts nullable scenario/tool", () => {
  const p = savedCompareSchema.parse({ ...base, scenario: "lb-strategy", tool: "aiperf" });
  expect(p.scenario).toBe("lb-strategy");
  expect(savedCompareSchema.parse({ ...base }).scenario ?? null).toBeNull();
});
