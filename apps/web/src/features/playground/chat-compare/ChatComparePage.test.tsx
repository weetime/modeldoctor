import i18n from "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatComparePage } from "./ChatComparePage";
import { useCompareStore } from "./store";

vi.mock("@/lib/playground-stream", () => ({
  playgroundFetchStream: vi.fn().mockResolvedValue(undefined),
}));

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
    localStorage.clear();
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

    // Use the array-based connections-store API (we learned this in Task 11/12).
    useConnectionsStore.setState({ connections: [] } as never);
    useConnectionsStore.getState().create({
      name: "A",
      apiBaseUrl: "http://a",
      apiKey: "k",
      model: "m",
      customHeaders: "",
      queryParams: "",
      category: "chat",
      tags: [],
    } as never);
    useConnectionsStore.getState().create({
      name: "B",
      apiBaseUrl: "http://b",
      apiKey: "k",
      model: "m",
      customHeaders: "",
      queryParams: "",
      category: "chat",
      tags: [],
    } as never);

    // Save the ids for use in tests
    (globalThis as unknown as { _testConnIds: { a: string; b: string } })._testConnIds = {
      a: useConnectionsStore.getState().list()[0].id,
      b: useConnectionsStore.getState().list()[1].id,
    };

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
    const ids = (globalThis as unknown as { _testConnIds: { a: string; b: string } })._testConnIds;
    useCompareStore.setState((s) => ({
      ...s,
      panels: s.panels.map((p, i) => ({
        ...p,
        selectedConnectionId: i === 0 ? ids.a : ids.b,
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
    const ids = (globalThis as unknown as { _testConnIds: { a: string; b: string } })._testConnIds;
    useCompareStore.setState((s) => ({
      ...s,
      panels: s.panels.map((p, i) => ({
        ...p,
        selectedConnectionId: i === 0 ? ids.a : null,
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
