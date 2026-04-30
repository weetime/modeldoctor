import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./MessageComposer";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const baseProps = {
  systemMessage: "",
  onSystemMessageChange: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  sending: false,
  streaming: false,
  disabled: false,
};

describe("MessageComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("send button is disabled when draft is empty and no attachments", () => {
    renderWithI18n(<MessageComposer {...baseProps} />);
    expect(screen.getByRole("button", { name: /^send$|^发送$/i })).toBeDisabled();
  });

  it("calls onSend with text and empty attachments when submitted", async () => {
    const onSend = vi.fn();
    renderWithI18n(<MessageComposer {...baseProps} onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText(/type your message|输入消息/i), "hello");
    await userEvent.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    expect(onSend).toHaveBeenCalledWith("hello", []);
  });

  it("clears draft after send", async () => {
    renderWithI18n(<MessageComposer {...baseProps} />);
    const textarea = screen.getByPlaceholderText(/type your message|输入消息/i);
    await userEvent.type(textarea, "hi");
    await userEvent.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    expect(textarea).toHaveValue("");
  });

  it("shows Stop button and hides Send when streaming", () => {
    renderWithI18n(<MessageComposer {...baseProps} streaming={true} />);
    expect(screen.getByRole("button", { name: /^stop$|^停止$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^send$|^发送$/i })).not.toBeInTheDocument();
  });

  it("calls onStop when Stop button is clicked", async () => {
    const onStop = vi.fn();
    renderWithI18n(<MessageComposer {...baseProps} streaming={true} onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$|^停止$/i }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows disabledReason when disabled", () => {
    renderWithI18n(
      <MessageComposer {...baseProps} disabled={true} disabledReason="Pick a connection first" />,
    );
    expect(screen.getByText("Pick a connection first")).toBeInTheDocument();
  });

  it("respects sendLabelOverride", () => {
    renderWithI18n(<MessageComposer {...baseProps} sendLabelOverride="Send to 2" />);
    // The override is visible even when button is disabled — check it renders
    expect(screen.getByRole("button", { name: /send to 2/i })).toBeInTheDocument();
  });

  it("submits via Enter (not Shift+Enter)", async () => {
    const onSend = vi.fn();
    renderWithI18n(<MessageComposer {...baseProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/type your message|输入消息/i);
    await userEvent.type(textarea, "press enter{Enter}");
    expect(onSend).toHaveBeenCalledWith("press enter", []);
  });
});

describe("MessageComposer attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onSend with empty attachments when no files picked", async () => {
    const onSend = vi.fn();
    renderWithI18n(<MessageComposer {...baseProps} onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText(/type your message|输入消息/i), "hello");
    await userEvent.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    expect(onSend).toHaveBeenCalledWith("hello", []);
  });

  it("does not send when both draft and attachments are empty", async () => {
    const onSend = vi.fn();
    renderWithI18n(<MessageComposer {...baseProps} onSend={onSend} />);
    const sendBtn = screen.getByRole("button", { name: /^send$|^发送$/i });
    expect(sendBtn).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});
