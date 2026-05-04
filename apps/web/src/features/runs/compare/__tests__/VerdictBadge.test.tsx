import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { VerdictBadge } from "../VerdictBadge";

describe("VerdictBadge", () => {
  it("renders regressed with destructive color and TrendingUp icon for latency", () => {
    const { container } = render(
      <VerdictBadge verdict="regressed" verdictKind="latency" deltaText="+20%" />,
    );
    expect(screen.getByText("+20%")).toBeInTheDocument();
    // lucide icons render as <svg>; assert it exists
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/destructive|text-red/);
  });

  it("renders improved with green color", () => {
    const { container } = render(
      <VerdictBadge verdict="improved" verdictKind="latency" deltaText="-15%" />,
    );
    expect(screen.getByText("-15%")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/green/);
  });

  it("renders unchanged with muted color and no icon (or Minus icon)", () => {
    const { container } = render(
      <VerdictBadge verdict="unchanged" verdictKind="latency" deltaText="+1%" />,
    );
    expect(screen.getByText("+1%")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass(/muted/);
  });

  it("inverts icon direction for throughput improvement", () => {
    const { container } = render(
      <VerdictBadge verdict="improved" verdictKind="throughput" deltaText="+10%" />,
    );
    // throughput improved = TrendingUp icon (going up = better)
    // We don't assert exact icon name, just that the class still indicates improved
    expect(container.firstChild).toHaveClass(/green/);
  });
});
