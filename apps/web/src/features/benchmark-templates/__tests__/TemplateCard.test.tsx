import "@/lib/i18n";
import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TemplateCard } from "../TemplateCard";

function tpl(overrides: Partial<BenchmarkTemplate> = {}): BenchmarkTemplate {
  return {
    id: "tpl-42",
    name: "vLLM single concurrency",
    description: "low load",
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: false,
    createdBy: "u1",
    tags: [],
    categories: ["chat"],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("TemplateCard", () => {
  it("renders 'use this template' CTA pointing to /benchmarks/new with scenario+templateId", () => {
    render(
      <MemoryRouter>
        <TemplateCard
          template={tpl({ scenario: "gateway", id: "tpl-42" })}
          canEdit={false}
          onDeleteClick={() => {}}
        />
      </MemoryRouter>,
    );
    const cta = screen.getByRole("link", { name: /use this template|使用此模板/i });
    expect(cta).toHaveAttribute("href", "/benchmarks/new?scenario=gateway&templateId=tpl-42");
  });

  it("still renders detail link on the card name area", () => {
    render(
      <MemoryRouter>
        <TemplateCard template={tpl()} canEdit={false} onDeleteClick={() => {}} />
      </MemoryRouter>,
    );
    const detailLink = screen.getByRole("link", { name: /vLLM single concurrency/i });
    expect(detailLink).toHaveAttribute("href", "/benchmark-templates/tpl-42");
  });
});
