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
  name: "img-1",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...1234",
  model: "m",
  customHeaders: "",
  queryParams: "",
  category: "image",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
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
import { ImagePage, useImageHistoryStore } from "./ImagePage";
import { useImageStore } from "./store";

describe("ImagePage", () => {
  beforeEach(() => {
    useImageStore.getState().reset();
    useImageHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits prompt to /api/playground/images with connectionId and renders the result image", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      artifacts: [{ url: "http://image/0" }],
      latencyMs: 12,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ImagePage />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByRole("option", { name: /img-1/i }));
    await user.type(screen.getByPlaceholderText(/describe|提示|描述/i), "a red apple");
    await user.click(
      screen.getAllByRole("button", { name: /^generate$|^生成$/i }).at(-1) as HTMLElement,
    );
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/images",
        expect.objectContaining({
          prompt: "a red apple",
          size: "512x512",
          connectionId: "c1",
        }),
      );
    });
    const arg = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("apiKey");
    expect(arg).not.toHaveProperty("apiBaseUrl");
    await waitFor(() => {
      expect(screen.getByRole("img")).toHaveAttribute("src", "http://image/0");
    });
  });

  it("renders Generate + Edit tabs and toggles to InpaintMode when clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/playground/image"]}>
        <ImagePage />
      </MemoryRouter>,
    );
    expect(
      screen.getAllByRole("button", { name: /^generate$|^生成$/i }).length,
    ).toBeGreaterThanOrEqual(1);
    const editTab = screen.getByRole("button", {
      name: /^edit \(inpaint\)$|^编辑\(局部重绘\)$/i,
    });
    expect(editTab).toBeInTheDocument();
    await user.click(editTab);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /upload image|上传图片/i })).toBeInTheDocument(),
    );
  });

  it("starts in Inpaint mode when URL has ?mode=edit", () => {
    render(
      <MemoryRouter initialEntries={["/playground/image?mode=edit"]}>
        <ImagePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /upload image|上传图片/i })).toBeInTheDocument();
  });
});
