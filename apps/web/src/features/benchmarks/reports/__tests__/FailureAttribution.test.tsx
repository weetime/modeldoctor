import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { FailureAttribution } from "../agent/FailureAttribution";

describe("FailureAttribution", () => {
  beforeAll(async () => {
    // Report copy is zh-CN by convention (see AgentReport/CompletionBars);
    // pin the locale explicitly rather than relying on fallbackLng.
    await i18n.changeLanguage("zh-CN");
  });

  it("renders attribution slices with a one-line conclusion", () => {
    render(
      <FailureAttribution attribution={{ wrong_action: 0.5, no_completion: 0.3, other: 0.2 }} />,
    );

    // Bucket label + its "50%" share appear in both the table row and the
    // one-line conclusion — assert presence (>=1 match) rather than
    // uniqueness.
    expect(screen.getAllByText(/用错工具|wrong_action/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
    // one-line conclusion names the top bucket
    expect(screen.getByText(/最主要/)).toBeInTheDocument();
  });

  it("does not render an LLM-style disclaimer (attribution is deterministic)", () => {
    render(
      <FailureAttribution attribution={{ wrong_action: 0.5, no_completion: 0.3, other: 0.2 }} />,
    );
    expect(screen.queryByText(/自动分类可能有误/)).not.toBeInTheDocument();
  });

  it("handles an empty attribution map gracefully", () => {
    render(<FailureAttribution attribution={{}} />);
    expect(screen.getByText(/无失败样本|No failed/i)).toBeInTheDocument();
  });
});
