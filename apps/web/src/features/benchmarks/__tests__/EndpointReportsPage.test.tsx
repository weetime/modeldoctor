import i18n from "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EndpointReportsResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EndpointReportsPage } from "../EndpointReportsPage";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TooltipProvider>{node}</TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

const oneItem: EndpointReportsResponse = {
  range: "30d",
  generatedAt: "2026-05-06T00:00:00.000Z",
  items: [
    {
      connection: {
        id: "c_1",
        name: "bge-by-mis-tei",
        model: "gen-studio_bge-m3-uZbs",
        baseUrl: "http://183.240.109.2:30888",
        category: "embeddings",
      },
      totalRuns: 12,
      statusCounts: { completed: 11, failed: 1, canceled: 0, inProgress: 0 },
      successRate: 99.8,
      p95Latency: { first: 147, last: 296 },
      latestRun: {
        id: "b_99",
        name: "weetime-04",
        status: "completed",
        createdAt: "2026-05-05T16:53:00.000Z",
      },
    },
  ],
};

describe("EndpointReportsPage", () => {
  it("renders empty state when items is []", async () => {
    vi.mocked(api.get).mockResolvedValue({
      range: "30d",
      generatedAt: "2026-05-06T00:00:00.000Z",
      items: [],
    } satisfies EndpointReportsResponse);
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() =>
      expect(screen.getByText(/No report data|暂无报告数据/i)).toBeInTheDocument(),
    );
  });

  it("renders one card per connection with name, model, baseUrl, runs, success rate", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));

    await waitFor(() => expect(screen.getByText("bge-by-mis-tei")).toBeInTheDocument());
    expect(screen.getByText("gen-studio_bge-m3-uZbs")).toBeInTheDocument();
    expect(screen.getByText("http://183.240.109.2:30888")).toBeInTheDocument();
    expect(screen.getByText(/12/)).toBeInTheDocument(); // run count
    expect(screen.getByText(/99\.8/)).toBeInTheDocument(); // success rate %
  });

  it("renders the regression marker when p95 last > first × 1.05", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() => expect(screen.getByLabelText(/regression|劣化/i)).toBeInTheDocument());
  });

  it("'View history' link points to /benchmarks/reports/<id>?range=<range>", async () => {
    vi.mocked(api.get).mockResolvedValue(oneItem);
    render(withProviders(<EndpointReportsPage />));
    const link = await screen.findByRole("link", { name: /View history|查看历史/i });
    expect(link).toHaveAttribute("href", "/benchmarks/reports/c_1?range=30d");
  });

  it("renders status breakdown text with completed / failed / canceled counts", async () => {
    vi.mocked(api.get).mockResolvedValue({
      ...oneItem,
      items: [
        {
          ...oneItem.items[0],
          totalRuns: 12,
          statusCounts: { completed: 10, failed: 1, canceled: 1, inProgress: 0 },
        },
      ],
    } satisfies EndpointReportsResponse);
    render(withProviders(<EndpointReportsPage />));
    await waitFor(() =>
      expect(
        screen.getByText(/成功 10 · 失败 1 · 取消 1|Success 10 · Failed 1 · Canceled 1/i),
      ).toBeInTheDocument(),
    );
  });
});
