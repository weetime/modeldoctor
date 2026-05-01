import i18n from "@/lib/i18n";
import type { ChatMessage } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import { MessageList } from "./MessageList";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("MessageList smoke", () => {
  it("shows empty state when no messages", () => {
    renderWithI18n(<MessageList messages={[]} />);
    expect(screen.getByText(/send a message|发送一条消息/i)).toBeInTheDocument();
  });

  it("renders a plain string content message", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hello world" }];
    renderWithI18n(<MessageList messages={messages} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders role label for assistant message", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "hi back" }];
    renderWithI18n(<MessageList messages={messages} />);
    expect(screen.getByText("hi back")).toBeInTheDocument();
  });
});

describe("MessageList multimodal", () => {
  it("renders text + image part", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ];
    const { container } = renderWithI18n(<MessageList messages={messages} />);
    expect(screen.getByText("describe this")).toBeInTheDocument();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  it("renders input_audio part as <audio>", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: "Zm9v", format: "webm" } }],
      },
    ];
    const { container } = renderWithI18n(<MessageList messages={messages} />);
    const audio = container.querySelector("audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toBe("data:audio/webm;base64,Zm9v");
  });

  it("renders <img> with object-contain, w-auto, and self-start to prevent flex stretch (Issue #32)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }],
      },
    ];
    const { container } = renderWithI18n(<MessageList messages={messages} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.className).toContain("object-contain");
    expect(img?.className).toContain("w-auto");
    expect(img?.className).toContain("self-start");
  });
});
