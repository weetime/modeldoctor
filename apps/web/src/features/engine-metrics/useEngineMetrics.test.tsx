import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEngineMetrics } from "./useEngineMetrics.js";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      expect(path).toMatch(/\/api\/engine-metrics\/c1\/snapshot\?/);
      return {
        engineId: "vllm",
        capability: "generative",
        window: {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
          step: 15,
        },
        panels: [],
      };
    }),
  },
}));

function wrap(client: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useEngineMetrics", () => {
  it("queries when connectionId + range are present", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useEngineMetrics("c1", {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
          step: 15,
        }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(result.current.data?.engineId).toBe("vllm"));
  });

  it("disabled when connectionId is null", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useEngineMetrics(null, {
          from: "2026-05-09T00:00:00.000Z",
          to: "2026-05-09T00:01:00.000Z",
        }),
      { wrapper: wrap(qc) },
    );
    expect(result.current.fetchStatus).toBe("idle");
  });
});
