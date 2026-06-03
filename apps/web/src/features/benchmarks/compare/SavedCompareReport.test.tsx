import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { CompareNarrative } from "@modeldoctor/contracts";
import { SavedCompareReport } from "./SavedCompareReport";

const narrative: CompareNarrative = {
  schemaVersion: 2,
  locale: "zh-CN",
  hero: { eyebrow: "EB", title: "Hero Title", subtitle: "Sub", metaItems: [] },
  summaryCards: [],
  sections: [
    { id: "summary", num: "01", title: "Summary", bodyMarkdown: "body one" },
    { id: "advice", num: "06", title: "Advice", bodyMarkdown: "body six" },
  ],
  figures: [],
  lintWarnings: [],
};

describe("SavedCompareReport", () => {
  it("renders the TOC nav in standalone mode", () => {
    const { container } = render(<SavedCompareReport narrative={narrative} runs={[]} />);
    expect(screen.getByRole("navigation", { name: /contents/i })).toBeInTheDocument();
    expect(container.querySelector("[data-report-root]")).not.toBeNull();
  });

  it("drops the TOC nav and data-report-root in embedded mode", () => {
    const { container } = render(<SavedCompareReport narrative={narrative} runs={[]} embedded />);
    expect(screen.queryByRole("navigation", { name: /contents/i })).not.toBeInTheDocument();
    expect(container.querySelector(".pr-layout-embedded")).not.toBeNull();
    expect(container.querySelector("[data-report-root]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Hero Title" })).toBeInTheDocument();
  });
});
