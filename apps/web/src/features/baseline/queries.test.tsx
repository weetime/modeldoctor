import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { ApiError, api } from "@/lib/api-client";
import { useBaselines, useCreateBaseline, useDeleteBaseline } from "./queries";

function makeWrapper() {
  return ({ children }: { children: ReactNode }) => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("baseline queries", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.del).mockReset();
  });

  it("useBaselines fetches GET /api/baselines and returns items", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [] });
    const { result } = renderHook(() => useBaselines(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/api/baselines");
    expect(result.current.data?.items).toEqual([]);
  });

  it("useCreateBaseline POSTs and returns the created BaselineDto", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "b_1",
      userId: "u_1",
      runId: "r_1",
      name: "anchor",
      description: null,
      tags: [],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const { result } = renderHook(() => useCreateBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ runId: "r_1", name: "anchor", tags: [] });
    });
    expect(api.post).toHaveBeenCalledWith("/api/baselines", {
      runId: "r_1",
      name: "anchor",
      tags: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("b_1");
  });

  it("useCreateBaseline surfaces 409 as ApiError", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, "Run r_1 already has a baseline"));
    const { result } = renderHook(() => useCreateBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ runId: "r_1", name: "x", tags: [] }),
      ).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(409);
  });

  it("useDeleteBaseline DELETEs the baseline by id", async () => {
    vi.mocked(api.del).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteBaseline(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync("b_1");
    });
    expect(api.del).toHaveBeenCalledWith("/api/baselines/b_1");
  });
});
