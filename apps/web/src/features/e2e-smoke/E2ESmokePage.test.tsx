import "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { E2ESmokePage } from "./E2ESmokePage";
import { useE2EStore } from "./store";
import type { E2ETestResponse } from "./types";

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

import { api } from "@/lib/api-client";

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

  it("Run-category button is disabled until endpoint fields are filled", async () => {
    render(<E2ESmokePage />);
    const btn = getRunCategoryButton();
    expect(btn).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/api base url/i), "http://host");
    await user.type(screen.getByLabelText(/api key/i), "sk-test");
    await user.type(screen.getByLabelText(/^model$/i), "test-model");

    expect(btn).toBeEnabled();
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

    const user = userEvent.setup();
    render(<E2ESmokePage />);
    await user.type(screen.getByLabelText(/api base url/i), "http://host");
    await user.type(screen.getByLabelText(/api key/i), "sk-test");
    await user.type(screen.getByLabelText(/^model$/i), "test-model");

    await user.click(getRunCategoryButton());

    await waitFor(() => {
      const badges = screen.getAllByText(/^(pass|通过)$/i);
      expect(badges).toHaveLength(2);
    });

    expect(api.post).toHaveBeenCalledWith(
      "/api/e2e-test",
      expect.objectContaining({
        apiBaseUrl: "http://host",
        apiKey: "sk-test",
        model: "test-model",
        probes: ["chat-text", "chat-vision"],
      }),
    );
  });

  it("renders Fail badges when probes return pass=false", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      results: [
        { probe: "chat-text", pass: false, latencyMs: 10, checks: [], details: {} },
        { probe: "chat-vision", pass: false, latencyMs: 10, checks: [], details: {} },
      ],
    });

    const user = userEvent.setup();
    render(<E2ESmokePage />);
    await user.type(screen.getByLabelText(/api base url/i), "http://host");
    await user.type(screen.getByLabelText(/api key/i), "sk-test");
    await user.type(screen.getByLabelText(/^model$/i), "test-model");

    await user.click(getRunCategoryButton());

    await waitFor(() => {
      const fails = screen.getAllByText(/^(fail|失败)$/i);
      expect(fails).toHaveLength(2);
    });
  });

  it("path override only sent for probes the user customized", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, results: [] });
    useE2EStore.getState().setPathOverride("chat-text", "/custom/chat");

    const user = userEvent.setup();
    render(<E2ESmokePage />);
    await user.type(screen.getByLabelText(/api base url/i), "http://host");
    await user.type(screen.getByLabelText(/api key/i), "sk-test");
    await user.type(screen.getByLabelText(/^model$/i), "test-model");

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
