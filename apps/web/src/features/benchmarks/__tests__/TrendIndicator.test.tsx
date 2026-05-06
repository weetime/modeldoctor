import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { TrendIndicator } from "../TrendIndicator";

function withI18n(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe("TrendIndicator", () => {
  it("renders both values + ▲ red marker when last > first × 1.05 (regression)", () => {
    render(withI18n(<TrendIndicator first={147} last={296} unitSuffix="ms" />));
    expect(screen.getByText("147")).toBeInTheDocument();
    expect(screen.getByText(/296/)).toBeInTheDocument();
    const arrow = screen.getByLabelText(/regression|劣化/i);
    expect(arrow).toBeInTheDocument();
    expect(arrow).toHaveTextContent(/▲/);
  });

  it("renders ▼ green marker when last < first × 0.95 (improvement)", () => {
    render(withI18n(<TrendIndicator first={300} last={200} unitSuffix="ms" />));
    const arrow = screen.getByLabelText(/improvement|改善/i);
    expect(arrow).toHaveTextContent(/▼/);
  });

  it("renders ▬ muted marker within ±5% (stable)", () => {
    render(withI18n(<TrendIndicator first={100} last={102} unitSuffix="ms" />));
    const arrow = screen.getByLabelText(/stable|稳定/i);
    expect(arrow).toHaveTextContent(/▬/);
  });

  it("renders single value when only `last` is provided", () => {
    render(withI18n(<TrendIndicator first={null} last={147} unitSuffix="ms" />));
    expect(screen.getByText(/147/)).toBeInTheDocument();
    expect(screen.queryByText(/▲|▼|▬/)).not.toBeInTheDocument();
  });

  it("renders an em dash when both null", () => {
    render(withI18n(<TrendIndicator first={null} last={null} unitSuffix="ms" />));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
