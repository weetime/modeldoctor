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

vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="echart" style={style} />
  ),
}));

const SAMPLE_CONN: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  name: "emb-1",
  baseUrl: "http://x",
  apiKeyPreview: "sk-...1234",
  model: "m",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
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
import { EmbeddingsPage, useEmbeddingsHistoryStore } from "./EmbeddingsPage";
import { useEmbeddingsStore } from "./store";

describe("EmbeddingsPage", () => {
  beforeEach(() => {
    useEmbeddingsStore.getState().reset();
    useEmbeddingsHistoryStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("submits inputs to /api/playground/embeddings with connectionId", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.2, 0.1, 0.4],
        [0.5, 0.5, 0.5],
      ],
      latencyMs: 12,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EmbeddingsPage />
      </MemoryRouter>,
    );
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
        expect.objectContaining({ input: ["a", "b", "c"], connectionId: "c1" }),
      );
    });
    const arg = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("apiKey");
    expect(arg).not.toHaveProperty("apiBaseUrl");
    expect(await screen.findByLabelText(/pca scatter/i)).toBeInTheDocument();
  });
});
