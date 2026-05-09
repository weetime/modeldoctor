import i18n from "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { PrefixCacheProbeReport } from "../PrefixCacheProbeReport";

function r(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const sample = {
  stickinessPct: 95.0,
  deterministic: true,
  perPod: [
    { pod: "vllm-0", queries: 100, hits: 92 },
    { pod: "vllm-1", queries: 100, hits: 88 },
  ],
  promptSets: [
    { label: "set-0", dominantPod: "vllm-0", dominantPct: 100.0, totalRequests: 10 },
    { label: "set-1", dominantPod: "vllm-1", dominantPct: 90.0, totalRequests: 10 },
  ],
};

describe("PrefixCacheProbeReport", () => {
  it("renders stickinessPct and deterministic flag", () => {
    r(<PrefixCacheProbeReport data={sample} />);
    expect(screen.getByText(/95(\.0)?%/)).toBeInTheDocument();
  });

  it("lists per-pod queries and hits", () => {
    r(<PrefixCacheProbeReport data={sample} />);
    expect(screen.getAllByText("vllm-0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("vllm-1").length).toBeGreaterThan(0);
  });

  it("renders empty-state copy when no queries observed", () => {
    const empty = {
      ...sample,
      stickinessPct: 0,
      perPod: [],
      promptSets: [{ label: "set-0", dominantPod: "unknown", dominantPct: 0, totalRequests: 0 }],
    };
    r(<PrefixCacheProbeReport data={empty} />);
    expect(screen.getByText(/prefix caching|未观察到/i)).toBeInTheDocument();
  });
});
