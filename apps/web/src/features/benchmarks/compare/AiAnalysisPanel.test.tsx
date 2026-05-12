import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiAnalysisPanel } from "./AiAnalysisPanel";

describe("AiAnalysisPanel", () => {
  it("renders narrative sections when provided", () => {
    render(
      <AiAnalysisPanel
        narrative={{
          tldr: [{ headline: "QPS 升", oneLine: "B 比 A 高 27%" }],
          analysis: [{ metricLabel: "QPS", body: "缓存命中提高。" }],
          conclusion: { recommendation: "选 B", caveats: ["err 率略高"] },
        }}
        onGenerate={() => {}}
        canGenerate
        isGenerating={false}
      />,
    );
    expect(screen.getByText("QPS 升")).toBeInTheDocument();
    expect(screen.getByText(/缓存命中提高/)).toBeInTheDocument();
    expect(screen.getByText(/选 B/)).toBeInTheDocument();
    expect(screen.getByText(/err 率略高/)).toBeInTheDocument();
  });

  it("renders generate button when narrative is null", () => {
    render(
      <AiAnalysisPanel narrative={null} onGenerate={() => {}} canGenerate isGenerating={false} />,
    );
    expect(screen.getByRole("button", { name: /生成|generate/i })).toBeInTheDocument();
  });
});
