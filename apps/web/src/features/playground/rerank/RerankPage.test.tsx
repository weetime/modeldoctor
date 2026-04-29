import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {}
  return { ApiError, api: { post: vi.fn() } };
});
import { api } from "@/lib/api-client";
import { RerankPage, useRerankHistoryStore } from "./RerankPage";
import { useRerankStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "rk-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "rerank",
    tags: [],
  });
}

describe("RerankPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useRerankStore.getState().reset();
    useRerankHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits a rerank request and displays scored results", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      results: [
        { index: 1, score: 0.9 },
        { index: 0, score: 0.4 },
      ],
      latencyMs: 5,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RerankPage />
      </MemoryRouter>,
    );
    // Connection selector is the first combobox (wire selector is the second)
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /rk-1/i }));
    await user.type(screen.getByPlaceholderText(/query|查询/i), "what");
    await user.click(screen.getByRole("button", { name: /\+ doc|文档/i }));
    const docs = screen.getAllByRole("textbox");
    // textboxes (in order): query input, doc-1 textarea, doc-2 textarea
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
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/0\.900/)).toBeInTheDocument();
    });
  });
});
