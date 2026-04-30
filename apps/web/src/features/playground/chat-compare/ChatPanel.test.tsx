import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { ChatPanel } from "./ChatPanel";
import { useCompareStore } from "./store";

const renderPanel = (i: number) =>
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPanel index={i} />
    </I18nextProvider>,
  );

describe("ChatPanel", () => {
  it("clear button only clears its own panel's messages", () => {
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      panels: [
        { ...s.panels[0], messages: [{ role: "user", content: "a" }] },
        { ...s.panels[1], messages: [{ role: "user", content: "b" }] },
      ],
    }));
    renderPanel(0);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(useCompareStore.getState().panels[0].messages).toEqual([]);
    expect(useCompareStore.getState().panels[1].messages).toHaveLength(1);
  });

  it("Stop button only appears while streaming", () => {
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      panels: [
        { ...s.panels[0], streaming: false },
        ...s.panels.slice(1),
      ],
    }));
    const { rerender } = renderPanel(0);
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();

    useCompareStore.setState((s) => ({
      ...s,
      panels: s.panels.map((p, i) => (i === 0 ? { ...p, streaming: true } : p)),
    }));
    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatPanel index={0} />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });
});
