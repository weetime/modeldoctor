import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./MessageComposer";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

describe("MessageComposer file attachment validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unsupported mime type with unsupportedMime toast", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const fileInput = container.querySelector('input[type="file"][aria-label]') as HTMLInputElement;
    expect(fileInput).toBeDefined();

    const file = new File(["x"], "evil.exe", { type: "application/x-msdownload" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(toast).error).toHaveBeenCalledWith(expect.stringMatching(/not supported/i));
  });

  it("rejects file > 8 MB with tooLarge toast", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const fileInput = container.querySelector('input[type="file"][aria-label]') as HTMLInputElement;
    expect(fileInput).toBeDefined();

    const file = new File([new Uint8Array(9 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "size", { value: 9 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(toast).error).toHaveBeenCalledWith(expect.stringMatching(/too large/i));
  });

  it("accepts a PDF and shows filename without (not sent) marker", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const fileInput = container.querySelector('input[type="file"][aria-label]') as HTMLInputElement;
    expect(fileInput).toBeDefined();

    const file = new File(["%PDF-1.4"], "hello.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument();
    expect(screen.getByText("hello.pdf")).toBeInTheDocument();
  });
});

describe("MessageComposer attachment validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects 6th attachment with tooManyAttachments toast", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const imageInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    expect(imageInput).toBeDefined();

    for (let i = 0; i < 5; i++) {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], `a${i}.png`, {
        type: "image/png",
      });
      fireEvent.change(imageInput, { target: { files: [file] } });
      // Brief delay to allow async readFileAsAttachment to resolve
      await new Promise((r) => setTimeout(r, 10));
    }

    // 6th pick should trigger toast.error
    const sixth = new File([new Uint8Array([0x89])], "a6.png", {
      type: "image/png",
    });
    fireEvent.change(imageInput, { target: { files: [sixth] } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(toast).error).toHaveBeenCalled();
  });

  it("rejects oversized attachment with attachmentTooLarge toast", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const imageInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    expect(imageInput).toBeDefined();

    const file = new File([new Uint8Array([1])], "large.png", {
      type: "image/png",
    });
    // Mock the file size to exceed 10MB
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });

    fireEvent.change(imageInput, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(toast).error).toHaveBeenCalled();
  });

  it("removes attachment when chip X is clicked", async () => {
    const { container } = renderWithI18n(<MessageComposer {...baseProps} onSend={vi.fn()} />);
    const imageInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    expect(imageInput).toBeDefined();

    // Pick 2 files
    for (let i = 0; i < 2; i++) {
      const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], `a${i}.png`, {
        type: "image/png",
      });
      fireEvent.change(imageInput, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 10));
    }

    // Verify 2 chips are rendered
    const removeButtons = screen.getAllByLabelText(/remove|删除/i);
    expect(removeButtons.length).toBe(2);

    // Click the first remove button
    await userEvent.click(removeButtons[0]);

    // Verify only 1 chip remains
    const remainingButtons = screen.queryAllByLabelText(/remove|删除/i);
    expect(remainingButtons.length).toBe(1);
  });
});
