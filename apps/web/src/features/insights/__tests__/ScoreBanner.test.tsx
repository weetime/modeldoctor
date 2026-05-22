import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { ScoreBanner } from "../ScoreBanner";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("ScoreBanner", () => {
  it("renders composite score and per-scenario sub-scores", () => {
    r(
      <ScoreBanner
        composite={87}
        perScenario={{
          inference: 92,
          capacity: 75,
          gateway: 82,
          "prefix-cache-validation": null,
          "kv-cache-stress": null,
        }}
        totalChecks={18}
        totalRuns={25}
        rangeDays={30}
      />,
    );
    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.getByText(/92/)).toBeInTheDocument();
    expect(screen.getByText(/75/)).toBeInTheDocument();
    expect(screen.getByText(/82/)).toBeInTheDocument();
  });

  it("renders en-dash when composite is null", () => {
    r(
      <ScoreBanner
        composite={null}
        perScenario={{
          inference: null,
          capacity: null,
          gateway: null,
          "prefix-cache-validation": null,
          "kv-cache-stress": null,
        }}
        totalChecks={0}
        totalRuns={0}
        rangeDays={30}
      />,
    );
    expect(screen.getByTestId("composite-score").textContent).toBe("—");
  });

  it("dims null sub-scores", () => {
    r(
      <ScoreBanner
        composite={92}
        perScenario={{
          inference: 92,
          capacity: null,
          gateway: null,
          "prefix-cache-validation": null,
          "kv-cache-stress": null,
        }}
        totalChecks={7}
        totalRuns={5}
        rangeDays={30}
      />,
    );
    expect(screen.getByTestId("subscore-capacity")).toHaveTextContent("—");
  });
});
