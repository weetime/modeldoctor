import i18n from "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/playground-stream", () => ({
  playgroundFetchStream: vi.fn().mockResolvedValue(undefined),
}));

const CONN_A: ConnectionPublic = {
  id: "ca",
  userId: "u1",
  name: "A",
  baseUrl: "http://a",
  apiKeyPreview: "sk-...1234",
  model: "m",
  customHeaders: "",
  queryParams: "",
  category: "chat",
  tags: [],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
};
const CONN_B: ConnectionPublic = { ...CONN_A, id: "cb", name: "B", baseUrl: "http://b" };

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [CONN_A, CONN_B], isLoading: false, error: null }),
  useConnection: (id: string | null | undefined) => ({
    data: id === "ca" ? CONN_A : id === "cb" ? CONN_B : null,
    isLoading: false,
    error: null,
  }),
}));

import { ChatComparePage } from "./ChatComparePage";
import { useCompareStore } from "./store";

const renderPage = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ChatComparePage />
      </MemoryRouter>
    </I18nextProvider>,
  );

describe("ChatComparePage", () => {
  beforeEach(() => {
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      panels: [
        {
          selectedConnectionId: null,
          params: {},
          messages: [],
          sending: false,
          streaming: false,
          abortController: null,
          error: null,
        },
        {
          selectedConnectionId: null,
          params: {},
          messages: [],
          sending: false,
          streaming: false,
          abortController: null,
          error: null,
        },
      ],
      sharedSystemMessage: "",
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, content: "hi", latencyMs: 1 }), {
          status: 200,
        }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders default 2 panels", () => {
    renderPage();
    // PanelCountSwitcher highlights 2
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
  });

  it("switches panel count to 4 and renders 4 panels", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(useCompareStore.getState().panelCount).toBe(4);
    expect(useCompareStore.getState().panels).toHaveLength(4);
  });

  it("panel-count switcher renders buttons for all 5 values: 2, 3, 4, 6, 8", () => {
    renderPage();
    for (const n of [2, 3, 4, 6, 8]) {
      expect(screen.getByRole("button", { name: String(n) })).toBeInTheDocument();
    }
  });

  it("switches panel count to 6 and updates the store", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "6" }));
    expect(useCompareStore.getState().panelCount).toBe(6);
    expect(useCompareStore.getState().panels).toHaveLength(6);
  });

  it("switches panel count to 8 and updates the store", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "8" }));
    expect(useCompareStore.getState().panelCount).toBe(8);
    expect(useCompareStore.getState().panels).toHaveLength(8);
  });

  it("grid container uses auto-fit layout (not hard-coded grid-cols-N)", () => {
    const { container } = renderPage();
    // The grid div should use inline style with auto-fit minmax
    const gridDiv = container.querySelector<HTMLElement>("[style*='auto-fit']");
    expect(gridDiv).not.toBeNull();
  });

  it("send broadcasts to N panels (one fetch call per panel with a connection)", async () => {
    useCompareStore.setState((s) => ({
      ...s,
      panels: s.panels.map((p, i) => ({
        ...p,
        selectedConnectionId: i === 0 ? "ca" : "cb",
        params: { stream: false },
      })),
    }));
    renderPage();
    // Type into the composer textarea
    const textareas = screen.getAllByRole("textbox");
    // The composer's main textarea is the one without the system-message expander; pick the last
    await userEvent.type(textareas[textareas.length - 1], "hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });
  });

  it("panel without a connection is skipped and shown a noConnection error", async () => {
    useCompareStore.setState((s) => ({
      ...s,
      panels: s.panels.map((p, i) => ({
        ...p,
        selectedConnectionId: i === 0 ? "ca" : null,
        params: { stream: false },
      })),
    }));
    renderPage();
    const textareas = screen.getAllByRole("textbox");
    await userEvent.type(textareas[textareas.length - 1], "hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => {
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect(useCompareStore.getState().panels[1].error).toBeTruthy();
    });
  });
});
