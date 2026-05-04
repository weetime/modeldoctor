import type { Run } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { DetailVerdictRow } from "../DetailVerdictRow";

function makeRun(id: string, p95: number): Run {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    kind: "benchmark",
    tool: "guidellm",
    scenario: {},
    mode: "fixed",
    driverKind: "local",
    name: id,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { p95 },
        requestsPerSecond: { mean: 10 },
        requests: { total: 100, success: 100, error: 0, incomplete: 0 },
      },
    } as unknown as Run["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("DetailVerdictRow", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("renders 3 verdict badges when baseline run loads", async () => {
    const current = makeRun("c", 240);
    // Sequence: useBaselines list, useRunDetail for baseline run
    vi.mocked(api.get)
      .mockResolvedValueOnce({
        items: [
          {
            id: "b_1",
            userId: "u",
            runId: "br",
            name: "anchor",
            description: null,
            tags: [],
            templateId: null,
            templateVersion: null,
            active: true,
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce(makeRun("br", 200));

    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText(/vs baseline|vs 基准/i)).toBeInTheDocument());
    // p95 +20% should show a regressed badge
    expect(screen.getByText(/\+20/)).toBeInTheDocument();
  });

  it("renders loading state while baseline list loads", () => {
    // The query is in flight on initial render — it resolves on the next
    // microtask, but the synchronous `getByText` runs before that. Returning
    // a never-resolving Promise hangs the vitest@1 worker, so we hand back a
    // resolvable empty-list response instead.
    vi.mocked(api.get).mockResolvedValue({ items: [] });
    const current = makeRun("c", 240);
    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    expect(screen.getByText(/Loading baseline|加载基准中/i)).toBeInTheDocument();
  });

  it("renders error state when baseline list fetch fails", async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error("boom"));
    const current = makeRun("c", 240);
    render(<DetailVerdictRow run={current} baselineId="b_1" />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Could not load baseline|无法加载基准/i)).toBeInTheDocument(),
    );
  });
});
