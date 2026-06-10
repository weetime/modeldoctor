import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { PrefixCachePanel } from "../PrefixCachePanel";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("PrefixCachePanel", () => {
  it("renders hit rate, top-pod share, and pod row when annotation is present", () => {
    const serverMetrics = {
      prefixCache: {
        hitRatePct: 96.6,
        topPodSharePct: 100,
        perPod: [{ pod: "p0", queries: 300, hits: 290 }],
        metricTag: "v1",
      },
    };
    r(<PrefixCachePanel serverMetrics={serverMetrics} />);
    expect(screen.getByText(/96\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/100\.0%/)).toBeInTheDocument();
    expect(screen.getByText("p0")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("290")).toBeInTheDocument();
  });

  it("renders degrade note when serverMetrics is null", () => {
    r(<PrefixCachePanel serverMetrics={null} />);
    // Resolve noData via the same i18n instance used by the component
    const noDataText = i18n.t("reports.prefixCache.noData", { ns: "benchmarks" });
    expect(screen.getByText(noDataText)).toBeInTheDocument();
  });

  it("renders degrade note when prefixCache field is absent", () => {
    r(<PrefixCachePanel serverMetrics={{}} />);
    // Should not crash and should not render any table
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders degrade note when prefixCache data is invalid", () => {
    r(<PrefixCachePanel serverMetrics={{ prefixCache: { invalid: true } }} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
