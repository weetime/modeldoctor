import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { useChatStore } from "./store";

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

function seedChatConn() {
  useConnectionsStore.getState().create({
    name: "chat-1",
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: [],
  });
}

describe("ChatPage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useChatStore.getState().reset();
    vi.mocked(api.post).mockReset();
  });

  it("send button is disabled until a connection is selected", () => {
    seedChatConn();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /send|发送/i })).toBeDisabled();
  });

  it("sends to /api/playground/chat and renders the assistant reply", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      content: "hello back",
      latencyMs: 12,
    });
    seedChatConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );

    // Pick the connection
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Type message
    const input = screen.getByPlaceholderText(/type your message|输入消息/i);
    await user.type(input, "hi there");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/playground/chat",
        expect.objectContaining({
          apiBaseUrl: "http://x",
          apiKey: "k",
          model: "m",
          messages: [{ role: "user", content: "hi there" }],
        }),
      );
      expect(screen.getByText("hello back")).toBeInTheDocument();
    });
  });

  it("renders an error toast (or inline error) when api returns success=false", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: false,
      error: "upstream 500: boom",
      latencyMs: 1,
    });
    seedChatConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));
    await user.type(screen.getByPlaceholderText(/type your message|输入消息/i), "hi");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      expect(screen.getByText(/upstream 500: boom/)).toBeInTheDocument();
    });
  });

  it("multi-turn: turn 2 sends [user-1, assistant-1, user-2] without duplicates", async () => {
    // Turn 1: success returns "reply-1"
    vi.mocked(api.post)
      .mockResolvedValueOnce({ success: true, content: "reply-1", latencyMs: 1 })
      .mockResolvedValueOnce({ success: true, content: "reply-2", latencyMs: 1 });

    seedChatConn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );

    // Pick connection
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Turn 1
    const input = screen.getByPlaceholderText(/type your message|输入消息/i);
    await user.type(input, "hi 1");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => expect(screen.getByText("reply-1")).toBeInTheDocument());

    // Turn 2
    await user.type(input, "hi 2");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      // Confirm second call's payload has 3 messages, no duplicates
      const secondCall = vi.mocked(api.post).mock.calls[1];
      expect(secondCall[0]).toBe("/api/playground/chat");
      const body = secondCall[1] as { messages: Array<{ role: string; content: string }> };
      expect(body.messages).toEqual([
        { role: "user", content: "hi 1" },
        { role: "assistant", content: "reply-1" },
        { role: "user", content: "hi 2" },
      ]);
    });
  });
});
