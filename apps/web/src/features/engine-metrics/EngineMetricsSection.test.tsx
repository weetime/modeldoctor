import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EngineMetricsSection } from "./EngineMetricsSection.js";

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

  it("shows the live badge and queries a now-bounded window when finishedAt is null", async () => {
    // Pin the clock to just after startedAt so live mode is deterministic
    // regardless of the host's real date. shouldAdvanceTime keeps waitFor +
    // react-query timers ticking. setSystemTime fixes Date.now()/new Date().
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-09T00:05:00.000Z"));
    try {
      const { api } = await import("@/lib/api-client");
      const getSpy = vi.mocked(api.get);
      getSpy.mockClear();
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <EngineMetricsSection
          connectionId="c1"
          startedAt="2026-05-09T00:00:00.000Z"
          finishedAt={null}
        />,
        { wrapper: wrap(qc) },
      );
      // Live indicator is present. (This test's i18n returns raw keys, so we
      // assert on the liveBadge key rather than the translated phrase.)
      await waitFor(() => expect(screen.getByText(/section\.liveBadge/)).toBeInTheDocument());
      // The window's upper bound tracks "now" (00:05), not the fixed
      // startedAt+1min the non-live window would use.
      const url = getSpy.mock.calls.at(-1)?.[0] as string;
      const to = new URLSearchParams(url.split("?")[1]).get("to");
      expect(to).toBeTruthy();
      expect(new Date(to as string).getTime()).toBeGreaterThan(
        new Date("2026-05-09T00:01:00.000Z").getTime(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
