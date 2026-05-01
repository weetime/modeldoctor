import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  name: "smoke-1",
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
import { E2ESmokePage } from "./E2ESmokePage";
import { useE2EStore } from "./store";
import type { E2ETestResponse } from "./types";

/**
 * The page renders one "Run" button per probe card AND a "Run Category"
 * button below the grid. We disambiguate by always picking the LAST
 * button matching the run regex — that's the run-category one. (Per-probe
 * cards render before the action row in the JSX.)
 */
function getRunCategoryButton(): HTMLElement {
  const all = screen.getAllByRole("button").filter((b) => /run|运行/i.test(b.textContent ?? ""));
  if (all.length === 0) throw new Error("no run-category button found");
  return all[all.length - 1] as HTMLElement;
}

describe("E2ESmokePage (default Chat category)", () => {
  beforeEach(() => {
    localStorage.clear();
    useE2EStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("Run-category button is disabled until a connection is picked", async () => {
    render(<E2ESmokePage />);
    const btn = getRunCategoryButton();
    expect(btn).toBeDisabled();

    useE2EStore.getState().setSelected("c1");
    await waitFor(() => expect(getRunCategoryButton()).toBeEnabled());
  });

  it("Run posts probes for the chat category and renders Pass cards", async () => {
    const response: E2ETestResponse = {
      runId: "test-run-id",
      success: true,
      results: [
        {
          probe: "chat-text",
          pass: true,
          latencyMs: 12,
          checks: [{ name: "HTTP status 200", pass: true, info: "200" }],
          details: { content: "OK-TEXT-123" },
        },
        {
          probe: "chat-vision",
          pass: true,
          latencyMs: 34,
          checks: [{ name: "Reply mentions 'cat'", pass: true }],
          details: { content: "Cat" },
        },
      ],
    };
    vi.mocked(api.post).mockResolvedValue(response);

    useE2EStore.getState().setSelected("c1");
    const user = userEvent.setup();
    render(<E2ESmokePage />);

    await user.click(getRunCategoryButton());

    await waitFor(() => {
      const badges = screen.getAllByText(/^(pass|通过)$/i);
      expect(badges).toHaveLength(2);
    });

    expect(api.post).toHaveBeenCalledWith(
      "/api/e2e-test",
      expect.objectContaining({
        connectionId: "c1",
        probes: ["chat-text", "chat-vision"],
      }),
    );
    const arg = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("apiKey");
    expect(arg).not.toHaveProperty("apiBaseUrl");
  });

  it("renders Fail badges when probes return pass=false", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      results: [
        { probe: "chat-text", pass: false, latencyMs: 10, checks: [], details: {} },
        { probe: "chat-vision", pass: false, latencyMs: 10, checks: [], details: {} },
      ],
    });

    useE2EStore.getState().setSelected("c1");
    const user = userEvent.setup();
    render(<E2ESmokePage />);

    await user.click(getRunCategoryButton());

    await waitFor(() => {
      const fails = screen.getAllByText(/^(fail|失败)$/i);
      expect(fails).toHaveLength(2);
    });
  });

  it("path override only sent for probes the user customized", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, results: [] });
    useE2EStore.getState().setPathOverride("chat-text", "/custom/chat");
    useE2EStore.getState().setSelected("c1");

    const user = userEvent.setup();
    render(<E2ESmokePage />);

    await user.click(getRunCategoryButton());

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/e2e-test",
        expect.objectContaining({
          pathOverride: { "chat-text": "/custom/chat" },
        }),
      ),
    );
  });
});
