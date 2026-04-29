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
import { ImagePage, useImageHistoryStore } from "./ImagePage";
import { useImageStore } from "./store";

function seedConn() {
  useConnectionsStore.getState().create({
    name: "img-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "image",
    tags: [],
  });
}

describe("ImagePage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useImageStore.getState().reset();
    useImageHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits prompt to /api/playground/images and renders the result image", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      artifacts: [{ url: "http://image/0" }],
      latencyMs: 12,
    });
    seedConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImagePage />
      </MemoryRouter>,
    );
    // Pick connection — there are 2 comboboxes (connection + size). The connection is the first.
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /img-1/i }));
    await user.type(screen.getByPlaceholderText(/describe|提示|描述/i), "a red apple");
    // The Send button regex matches "Generate" but we tighten to avoid "Generating…" while in-flight
    await user.click(screen.getByRole("button", { name: /^generate$|^生成$/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/images",
        expect.objectContaining({ prompt: "a red apple", size: "512x512" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("img")).toHaveAttribute("src", "http://image/0");
    });
  });
});
