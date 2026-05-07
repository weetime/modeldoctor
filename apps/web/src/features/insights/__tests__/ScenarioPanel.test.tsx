import i18n from "@/lib/i18n";
import type { Benchmark } from "@modeldoctor/contracts";
// apps/web/src/features/insights/__tests__/ScenarioPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ScenarioPanel } from "../ScenarioPanel";

function r(ui: React.ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
}

describe("ScenarioPanel", () => {
  it("renders empty state when 0 runs", () => {
    r(
      <ScenarioPanel
        scenario="capacity"
        subScore={null}
        axisValues={{}}
        findings={[]}
        runs={[]}
        connectionId="c1"
        rangeFromISO="2026-04-01T00:00:00Z"
      />,
    );
    // i18n now resolves the namespace; assert on real translation (en-US is fallback).
    expect(screen.getAllByText(/no .* tests yet|尚无/i).length).toBeGreaterThan(0);
  });

  it("populated state renders deep-link with /benchmarks/<scenario> path and url-encoded params", () => {
    const run = {
      id: "b1",
      connectionId: "c+1",
      scenario: "inference",
      tool: "vegeta",
      status: "succeeded",
      createdAt: "2026-04-15T00:00:00Z",
    } as unknown as Benchmark;
    r(
      <ScenarioPanel
        scenario="inference"
        subScore={88}
        axisValues={{}}
        findings={[]}
        runs={[run]}
        connectionId="c+1"
        rangeFromISO="2026-04-01T00:00:00Z"
      />,
    );
    const links = screen.getAllByRole("link");
    const deepLink = links.find((l) =>
      l.getAttribute("href")?.startsWith("/benchmarks/inference?"),
    );
    expect(deepLink).toBeDefined();
    expect(deepLink?.getAttribute("href")).toBe(
      "/benchmarks/inference?connectionId=c%2B1&createdAfter=2026-04-01T00%3A00%3A00Z",
    );
  });
});
