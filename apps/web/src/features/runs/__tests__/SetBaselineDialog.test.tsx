import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { SetBaselineDialog } from "../SetBaselineDialog";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("SetBaselineDialog", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it("submits {runId, name, description, tags} and calls onSuccess", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "b_1",
      userId: "u_1",
      runId: "r_1",
      name: "anchor",
      description: "desc",
      tags: ["a", "b"],
      templateId: null,
      templateVersion: null,
      active: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const onSuccess = vi.fn();
    render(
      <SetBaselineDialog runId="r_1" open={true} onOpenChange={() => {}} onSuccess={onSuccess} />,
      { wrapper: Wrapper },
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name|名称/), "anchor");
    await user.type(screen.getByLabelText(/Description|备注/), "desc");
    await user.type(screen.getByLabelText(/Tags|标签/), "a, b");
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Save|保存/ }));
    });
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith("/api/baselines", {
      runId: "r_1",
      name: "anchor",
      description: "desc",
      tags: ["a", "b"],
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("does not submit when name is empty", async () => {
    render(
      <SetBaselineDialog runId="r_1" open={true} onOpenChange={() => {}} onSuccess={() => {}} />,
      { wrapper: Wrapper },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Save|保存/ }));
    expect(api.post).not.toHaveBeenCalled();
  });
});
