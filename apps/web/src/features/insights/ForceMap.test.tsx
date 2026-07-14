// apps/web/src/features/insights/ForceMap.test.tsx
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ForceMap } from "./ForceMap";

const MATRIX_FIXTURE: InsightsMatrixResponse = {
  aggregate: "scenario",
  range: "30d",
  generatedAt: "2026-07-01T00:00:00Z",
  dimensions: [{ key: "inference", label: "Inference", count: 1 }],
  endpoints: [
    {
      id: "c1",
      name: "n",
      model: "m",
      baseUrl: "http://x",
      category: "chat",
      serverKind: "vllm",
    },
  ],
  cells: [
    {
      endpointId: "c1",
      dimKey: "inference",
      runs: 3,
      score: 80,
      band: "usable",
      nativeMetric: { kind: "e2e.p95", value: 1200, unit: "ms" },
    },
  ],
};

function renderMap(data: InsightsMatrixResponse) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ForceMap data={data} onNodeClick={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("ForceMap", () => {
  it("renders the canvas graph + legend chrome without throwing", () => {
    const { container } = renderMap(MATRIX_FIXTURE);

    // The bespoke canvas engine mounts a <canvas>; jsdom returns a null 2d
    // context so the sim is skipped, but the DOM chrome (canvas + legend)
    // still renders. A search input is part of the left drawer.
    expect(container.querySelector("canvas")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders an empty state (no canvas) when there are no dimensions or endpoints", () => {
    const { container } = renderMap({
      ...MATRIX_FIXTURE,
      dimensions: [],
      endpoints: [],
      cells: [],
    });

    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });
});
