import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {}
  return { ApiError, api: { post: vi.fn() } };
});

const SAMPLE_CONN: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "rk-1",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...1234",
  model: "m",
  customHeaders: "",
  queryParams: "",
  category: "rerank",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
  prometheusUrl: null,
  serverKind: null,
};

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [SAMPLE_CONN], isLoading: false, error: null }),
  useConnection: (id: string | null | undefined) => ({
    data: id === "c1" ? SAMPLE_CONN : null,
    isLoading: false,
    error: null,
  }),
}));

import { api } from "@/lib/api-client";
import { RerankPage, useRerankHistoryStore } from "./RerankPage";
import { useRerankStore } from "./store";

describe("RerankPage", () => {
  beforeEach(() => {
    useRerankStore.getState().reset();
    useRerankHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits a rerank request with connectionId", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      results: [
        { index: 1, score: 0.9 },
        { index: 0, score: 0.4 },
      ],
      latencyMs: 5,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RerankPage />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /rk-1/i }));
    await user.type(screen.getByPlaceholderText(/query|查询/i), "what");
    await user.click(screen.getByRole("button", { name: /\+ doc|文档/i }));
    const docs = screen.getAllByRole("textbox");
    await user.type(docs[1], "doc-a");
    await user.type(docs[2], "doc-b");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/rerank",
        expect.objectContaining({
          query: "what",
          documents: ["doc-a", "doc-b"],
          wire: "cohere",
          connectionId: "c1",
        }),
      );
    });
    const arg = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("apiKey");
    expect(arg).not.toHaveProperty("apiBaseUrl");
    await waitFor(() => {
      expect(screen.getByText(/0\.900/)).toBeInTheDocument();
    });
  });
});
