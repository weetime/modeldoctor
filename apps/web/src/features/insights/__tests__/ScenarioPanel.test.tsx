// apps/web/src/features/insights/__tests__/ScenarioPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/lib/i18n";
import { ScenarioPanel } from "../ScenarioPanel";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider>);
}

describe("ScenarioPanel", () => {
  it("renders empty state when 0 runs", () => {
    r(<ScenarioPanel scenario="capacity" subScore={null} axisValues={{}} findings={[]} runs={[]} connectionId="c1" rangeFromISO="2026-04-01T00:00:00Z" />);
    expect(screen.getAllByText(/尚无|empty/i).length).toBeGreaterThan(0);
  });
});
