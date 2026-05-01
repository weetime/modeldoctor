import type { ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: { get: vi.fn(), post: vi.fn() },
  };
});

const SAMPLE_CONN: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "load-1",
  baseUrl: "http://host",
  apiKeyPreview: "sk-...test",
  model: "test-model",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
};

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [SAMPLE_CONN], isLoading: false, error: null }),
  useConnection: (id: string | null | undefined) => ({
    data: id === "c1" ? SAMPLE_CONN : null,
    isLoading: false,
    error: null,
  }),
  useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConnection: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { api } from "@/lib/api-client";
import { LoadTestPage } from "./LoadTestPage";
import { useLoadTestStore } from "./store";
import type { LoadTestResult } from "./types";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const FAKE_RESULT: LoadTestResult = {
  report:
    "Requests      [total, rate, throughput]  120, 2.00, 2.00\nLatencies     [mean, 50, 95, 99, max]  5ms, 5ms, 6ms, 7ms, 9ms",
  parsed: {
    requests: 120,
    success: 120,
    throughput: 2,
    latencies: { mean: "5ms", p50: "5ms", p95: "6ms", p99: "7ms", max: "9ms" },
  },
  config: {
    apiType: "chat",
    apiBaseUrl: "http://host",
    model: "test-model",
    rate: 2,
    duration: 60,
  },
};

describe("LoadTestPage (happy path)", () => {
  beforeEach(() => {
    localStorage.clear();
    useLoadTestStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("Start posts to /api/load-test with connectionId and renders metrics", async () => {
    vi.mocked(api.post).mockResolvedValue(FAKE_RESULT);
    // Pre-select the connection (the EndpointPicker is its own integration test).
    useLoadTestStore.getState().setSelected("c1");
    const user = userEvent.setup();
    render(
      <Wrapper>
        <LoadTestPage />
      </Wrapper>,
    );

    await user.click(screen.getByRole("button", { name: /^(start|开始)$/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/120/).length).toBeGreaterThan(0);
    });

    expect(api.post).toHaveBeenCalledWith(
      "/api/load-test",
      expect.objectContaining({
        apiType: "chat",
        connectionId: "c1",
      }),
    );
    const arg = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("apiKey");
    expect(arg).not.toHaveProperty("apiBaseUrl");
  });

  it("Reset clears the last result from view", async () => {
    useLoadTestStore.getState().setLastResult(FAKE_RESULT);
    const user = userEvent.setup();
    render(
      <Wrapper>
        <LoadTestPage />
      </Wrapper>,
    );

    expect(screen.getAllByText(/120/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /^(reset|重置)$/i }));

    await waitFor(() => {
      expect(screen.queryAllByText(/120/).length).toBe(0);
    });
    expect(useLoadTestStore.getState().lastResult).toBeNull();
  });
});
