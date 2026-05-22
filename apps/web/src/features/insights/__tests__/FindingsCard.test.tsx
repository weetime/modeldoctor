import type { Finding } from "@modeldoctor/contracts";
// apps/web/src/features/insights/__tests__/FindingsCard.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { FindingsCard } from "../FindingsCard";

function f(
  severity: Finding["severity"],
  scenario: Finding["scenario"],
  checkId: string,
  value: number,
  recommendation = "fix it",
): Finding {
  return {
    checkId,
    scenario,
    axis: "responsiveness",
    severity,
    value,
    weight: 1,
    threshold: { warn: 100, crit: 200 },
    recommendation,
    contributingRunIds: [],
  };
}

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("FindingsCard", () => {
  it("ranks crit > warn > good and shows top 5 by default", () => {
    const fs: Finding[] = [
      f("good", "inference", "a", 1),
      f("warn", "inference", "b", 2),
      f("crit", "inference", "c", 3),
      f("good", "inference", "d", 4),
      f("crit", "inference", "e", 5),
      f("warn", "inference", "f", 6),
      f("good", "inference", "g", 7),
    ];
    r(<FindingsCard findings={fs} />);
    const items = screen.getAllByTestId(/^finding-/);
    expect(items.length).toBe(5);
    // first two should be crit
    expect(items[0]).toHaveAttribute("data-severity", "crit");
    expect(items[1]).toHaveAttribute("data-severity", "crit");
  });

  it("expand button reveals all findings", async () => {
    const fs: Finding[] = Array.from({ length: 8 }, (_, i) => f("good", "inference", `c${i}`, i));
    r(<FindingsCard findings={fs} />);
    expect(screen.getAllByTestId(/^finding-/).length).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: /展开|expand/i }));
    expect(screen.getAllByTestId(/^finding-/).length).toBe(8);
  });

  it("hides no_data findings entirely", () => {
    const fs: Finding[] = [f("no_data", "inference", "a", 0)];
    r(<FindingsCard findings={fs} />);
    expect(screen.queryByTestId(/^finding-/)).toBeNull();
  });
});
