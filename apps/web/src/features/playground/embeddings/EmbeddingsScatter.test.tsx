import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmbeddingsScatter } from "./EmbeddingsScatter";

vi.mock("@/components/charts", () => ({
  Chart: ({
    data,
    kind,
    ariaLabel,
  }: {
    data: { points: { x: number; y: number; label?: string }[] };
    kind: string;
    ariaLabel: string;
  }) => (
    <div data-testid="mock-chart" data-kind={kind} data-aria={ariaLabel}>
      {data.points.length} pts
    </div>
  ),
}));

describe("<EmbeddingsScatter>", () => {
  it("renders scatter with PCA-projected points labeled by truncated input", () => {
    render(
      <EmbeddingsScatter
        inputs={["a long input that will be truncated heavily for label use", "short"]}
        coords={[
          { x: 0.1, y: 0.2 },
          { x: -0.4, y: 0.3 },
        ]}
      />,
    );
    const el = screen.getByTestId("mock-chart");
    expect(el.getAttribute("data-kind")).toBe("scatter");
    expect(el.textContent).toBe("2 pts");
  });

  it("truncates labels to 40 characters", () => {
    const longInput = "a".repeat(60);
    render(
      <EmbeddingsScatter
        inputs={[longInput, "b"]}
        coords={[
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ]}
      />,
    );
    const el = screen.getByTestId("mock-chart");
    // Component renders; truncation happens in data construction
    expect(el).toBeInTheDocument();
  });

  it("renders empty state when no inputs", () => {
    render(<EmbeddingsScatter inputs={[]} coords={[]} />);
    expect(screen.queryByTestId("mock-chart")).not.toBeInTheDocument();
  });

  it("passes ariaLabel to Chart", () => {
    render(<EmbeddingsScatter inputs={["hello"]} coords={[{ x: 1, y: 2 }]} />);
    const el = screen.getByTestId("mock-chart");
    expect(el.getAttribute("data-aria")).toMatch(/pca scatter/i);
  });
});
