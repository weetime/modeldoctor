import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "../../components/MetricCard";

describe("MetricCard", () => {
  it("renders title and rows", () => {
    render(
      <MetricCard
        title="Latency"
        rows={[
          { label: "p50", value: "12.3 ms" },
          { label: "p95", value: "45.6 ms" },
        ]}
      />,
    );
    expect(screen.getByText("Latency")).toBeInTheDocument();
    expect(screen.getByText("p50")).toBeInTheDocument();
    expect(screen.getByText("12.3 ms")).toBeInTheDocument();
    expect(screen.getByText("p95")).toBeInTheDocument();
    expect(screen.getByText("45.6 ms")).toBeInTheDocument();
  });

  it("renders empty value as em-dash", () => {
    render(<MetricCard title="X" rows={[{ label: "v", value: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
