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
import { EmbeddingsPage, useEmbeddingsHistoryStore } from "./EmbeddingsPage";
import { useEmbeddingsStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "emb-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: [],
  });
}

describe("EmbeddingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useEmbeddingsStore.getState().reset();
    useEmbeddingsHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits inputs to /api/playground/embeddings and renders chart placeholder until ≥3", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.2, 0.1, 0.4],
        [0.5, 0.5, 0.5],
      ],
      latencyMs: 12,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EmbeddingsPage />
      </MemoryRouter>,
    );
    // Connection combobox is the first combobox (the params panel also has a
    // Select for encoding format).
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[0]);
    await user.click(screen.getByRole("option", { name: /emb-1/i }));
    await user.click(screen.getByRole("button", { name: /\+ add|添加/i }));
    await user.click(screen.getByRole("button", { name: /\+ add|添加/i }));
    const inputs = screen.getAllByRole("textbox");
    await user.type(inputs[0], "a");
    await user.type(inputs[1], "b");
    await user.type(inputs[2], "c");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/embeddings",
        expect.objectContaining({ input: ["a", "b", "c"] }),
      );
    });
    expect(await screen.findByRole("img", { name: /pca scatter/i })).toBeInTheDocument();
  });
});
