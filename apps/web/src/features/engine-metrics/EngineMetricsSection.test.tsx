import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EngineMetricsSection } from "./EngineMetricsSection.js";

vi.mock("echarts-for-react", () => ({ default: () => <div data-testid="echart" /> }));

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => ({
      engineId: "vllm",
      capability: "generative",
      window: {
        from: "2026-05-09T00:00:00.000Z",
        to: "2026-05-09T00:01:00.000Z",
        step: 15,
      },
      panels: [
        {
          key: "ttft_p99",
          unit: "ms",
          unavailable: false,
          series: [{ samples: [[1715212800, 187.4]] }],
        },
        {
          key: "kv_cache_usage",
          unit: "%",
          unavailable: false,
          series: [{ label: "infer-0", samples: [[1715212800, 60]] }],
        },
        {
          key: "stage_breakdown",
          unit: "ms",
          unavailable: true,
          reason: "no_data",
          series: [],
        },
      ],
    })),
  },
}));

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("<EngineMetricsSection>", () => {
  it("renders panels grouped by group", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <EngineMetricsSection
        connectionId="c1"
        startedAt="2026-05-09T00:00:00.000Z"
        finishedAt="2026-05-09T00:01:00.000Z"
      />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(screen.getByText(/187 ms/)).toBeInTheDocument());
  });

  it("flags unavailable panels with placeholder", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <EngineMetricsSection
        connectionId="c1"
        startedAt="2026-05-09T00:00:00.000Z"
        finishedAt="2026-05-09T00:01:00.000Z"
      />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(/不上报|not reported|no data|unavailable/i).length,
      ).toBeGreaterThan(0),
    );
  });
});
