import "@/lib/i18n";
import { useConnectionsStore } from "@/stores/connections-store";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage, persistAttachments, rehydrateChatBlobs } from "./ChatPage";
import { type ChatHistorySnapshot, useChatHistoryStore } from "./history";
import { DEFAULT_CHAT_PARAMS, useChatStore } from "./store";

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
    // Reset the module-level history singleton (localStorage.clear() doesn't
    // touch its in-memory state) and prime its current entry with stream:false
    // so the ChatPage's mount-time restore effect doesn't override our intent.
    useChatHistoryStore.getState().reset();
    useChatHistoryStore.getState().save({
      systemMessage: "",
      messages: [],
      params: { ...DEFAULT_CHAT_PARAMS, stream: false },
      selectedConnectionId: null,
    });
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

describe("ChatPage file attachment upload", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useChatStore.getState().reset();
    useChatHistoryStore.getState().reset();
    useChatHistoryStore.getState().save({
      systemMessage: "",
      messages: [],
      params: { ...DEFAULT_CHAT_PARAMS, stream: false },
      selectedConnectionId: null,
    });
    vi.mocked(api.post).mockReset();
  });

  it("sends input_file content part when a PDF file attachment is added", async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      content: "file analyzed",
      latencyMs: 10,
    });
    seedChatConn();
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );

    // Pick the connection
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Attach a PDF file
    const fileInput = container.querySelector('input[type="file"][aria-label]') as HTMLInputElement;
    const pdfFile = new File(["%PDF-1.4 hello"], "report.pdf", {
      type: "application/pdf",
    });
    // Fire file pick (FileReader runs async)
    const { fireEvent: fe } = await import("@testing-library/react");
    fe.change(fileInput, { target: { files: [pdfFile] } });
    // Wait for FileReader to complete
    await new Promise((r) => setTimeout(r, 50));

    // Type text and send
    await user.type(screen.getByPlaceholderText(/type your message|输入消息/i), "analyze");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => {
      const [, body] = vi.mocked(api.post).mock.calls[0] as [
        string,
        { messages: Array<{ role: string; content: unknown }> },
      ];
      const content = body.messages[0].content as Array<{
        type: string;
        file?: { filename: string };
      }>;
      expect(Array.isArray(content)).toBe(true);
      const filePart = content.find((p) => p.type === "input_file");
      expect(filePart).toBeDefined();
      expect(filePart?.file?.filename).toBe("report.pdf");
    });
  });
});

// ---------------------------------------------------------------------------
// persistAttachments + rehydrateChatBlobs round-trip tests
// ---------------------------------------------------------------------------

// Helper: a tiny valid 1x1 transparent PNG as base64.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

describe("persistAttachments + rehydrateChatBlobs", () => {
  // Stored blobs keyed "entryId:key" → Blob, mimicking IDB behaviour.
  let blobStore: Map<string, Blob>;

  beforeEach(() => {
    useChatHistoryStore.getState().reset();
    useChatStore.getState().reset();

    blobStore = new Map();

    vi.spyOn(useChatHistoryStore.getState(), "putBlob").mockImplementation(
      async (entryId: string, key: string, blob: Blob) => {
        blobStore.set(`${entryId}:${key}`, blob);
      },
    );

    vi.spyOn(useChatHistoryStore.getState(), "getBlob").mockImplementation(
      async (entryId: string, key: string) => {
        return blobStore.get(`${entryId}:${key}`) ?? null;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves string-content messages unchanged", async () => {
    const snap: ChatHistorySnapshot = {
      systemMessage: "sys",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;
    const out = await persistAttachments(entryId, snap);
    expect(out).toEqual(snap);
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).not.toHaveBeenCalled();
  });

  it("leaves text-only multimodal content unchanged", async () => {
    const snap: ChatHistorySnapshot = {
      systemMessage: "",
      messages: [{ role: "user", content: [{ type: "text", text: "only text" }] }],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;
    const out = await persistAttachments(entryId, snap);
    expect(out.messages[0].content).toEqual([{ type: "text", text: "only text" }]);
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).not.toHaveBeenCalled();
  });

  it("round-trips an image_url attachment: data URL → idb:// sentinel → restored data URL", async () => {
    const snap: ChatHistorySnapshot = {
      systemMessage: "",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image_url", image_url: { url: PNG_DATA_URL } },
          ],
        },
      ],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;

    // Step 1: persist — inline data replaced with sentinel
    const serialised = await persistAttachments(entryId, snap);
    const imgPart = (serialised.messages[0].content as Array<{ type: string; image_url?: { url: string } }>)[1];
    expect(imgPart.image_url?.url).toBe("idb://msg0.part1");
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part1",
      expect.any(Blob),
    );

    // Step 2: restore sync state from the serialised snapshot
    const s = useChatStore.getState();
    s.reset();
    s.setSystemMessage(serialised.systemMessage);
    s.patchParams(serialised.params);
    s.setSelected(serialised.selectedConnectionId);
    for (const m of serialised.messages) s.appendMessage(m);

    // Step 3: rehydrate
    await rehydrateChatBlobs(entryId, serialised);

    // Step 4: the live store should now have the original data URL back
    expect(vi.mocked(useChatHistoryStore.getState().getBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part1",
    );
    const liveMsg = useChatStore.getState().messages[0];
    expect(Array.isArray(liveMsg.content)).toBe(true);
    const livePart = (liveMsg.content as Array<{ type: string; image_url?: { url: string } }>)[1];
    expect(livePart.image_url?.url).toBe(PNG_DATA_URL);
  });

  it("round-trips an input_audio attachment: raw base64 → idb:// sentinel → restored base64", async () => {
    const audioB64 = btoa("\x00\x01\x02\x03audio-bytes");
    const snap: ChatHistorySnapshot = {
      systemMessage: "",
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audioB64, format: "webm" } },
          ],
        },
      ],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;

    const serialised = await persistAttachments(entryId, snap);
    const audioPart = (serialised.messages[0].content as Array<{ type: string; input_audio?: { data: string; format: string } }>)[0];
    expect(audioPart.input_audio?.data).toBe("idb://msg0.part0");
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part0",
      expect.any(Blob),
    );

    // Restore
    const s = useChatStore.getState();
    s.reset();
    for (const m of serialised.messages) s.appendMessage(m);

    await rehydrateChatBlobs(entryId, serialised);

    expect(vi.mocked(useChatHistoryStore.getState().getBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part0",
    );
    const livePart = (useChatStore.getState().messages[0].content as Array<{ type: string; input_audio?: { data: string; format: string } }>)[0];
    expect(livePart.input_audio?.data).toBe(audioB64);
    expect(livePart.input_audio?.format).toBe("webm");
  });

  it("round-trips an input_file attachment: data URL → idb:// sentinel → restored data URL", async () => {
    const fileDataUrl = `data:application/pdf;base64,${btoa("%PDF-1.4 test")}`;
    const snap: ChatHistorySnapshot = {
      systemMessage: "",
      messages: [
        {
          role: "user",
          content: [
            { type: "input_file", file: { filename: "doc.pdf", file_data: fileDataUrl } },
          ],
        },
      ],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;

    const serialised = await persistAttachments(entryId, snap);
    const filePart = (serialised.messages[0].content as Array<{ type: string; file?: { filename: string; file_data: string } }>)[0];
    expect(filePart.file?.file_data).toBe("idb://msg0.part0");
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part0",
      expect.any(Blob),
    );

    // Restore
    const s = useChatStore.getState();
    s.reset();
    for (const m of serialised.messages) s.appendMessage(m);

    await rehydrateChatBlobs(entryId, serialised);

    expect(vi.mocked(useChatHistoryStore.getState().getBlob)).toHaveBeenCalledWith(
      entryId,
      "msg0.part0",
    );
    const livePart = (useChatStore.getState().messages[0].content as Array<{ type: string; file?: { filename: string; file_data: string } }>)[0];
    expect(livePart.file?.file_data).toBe(fileDataUrl);
    expect(livePart.file?.filename).toBe("doc.pdf");
  });

  it("restoring a snapshot without attachments causes no errors and no spurious blob fetches", async () => {
    const snap: ChatHistorySnapshot = {
      systemMessage: "be helpful",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      params: {},
      selectedConnectionId: null,
    };
    const entryId = useChatHistoryStore.getState().currentId;

    // No blob should be stored
    const serialised = await persistAttachments(entryId, snap);
    expect(serialised).toEqual(snap);
    expect(vi.mocked(useChatHistoryStore.getState().putBlob)).not.toHaveBeenCalled();

    // Restore + rehydrate should succeed without throwing
    const s = useChatStore.getState();
    s.reset();
    for (const m of serialised.messages) s.appendMessage(m);

    await expect(rehydrateChatBlobs(entryId, serialised)).resolves.toBeUndefined();
    expect(vi.mocked(useChatHistoryStore.getState().getBlob)).not.toHaveBeenCalled();

    // State unchanged
    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().messages[0].content).toBe("hi");
  });
});

describe("ChatPage streaming", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
    useChatStore.getState().reset();
    useChatHistoryStore.getState().reset(); // NEW — same singleton-clear concern
    vi.mocked(api.post).mockReset();
  });

  it("streams SSE tokens into the assistant message and the Stop button aborts", async () => {
    seedChatConn();
    // Mock playgroundFetchStream by hijacking fetch
    const encoder = new TextEncoder();
    let abortedByCaller = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
            // Wait for caller abort
            await new Promise<void>((resolve) => {
              (init.signal as AbortSignal).addEventListener(
                "abort",
                () => {
                  abortedByCaller = true;
                  resolve();
                },
                { once: true },
              );
            });
          },
          cancel() {},
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }),
    );

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

    await waitFor(() => expect(screen.getByText(/^hel$/)).toBeInTheDocument());

    // Stop button visible while streaming
    const stopBtn = await screen.findByRole("button", { name: /^stop$|^停止$/i });
    await user.click(stopBtn);
    await waitFor(() => expect(abortedByCaller).toBe(true));
    vi.unstubAllGlobals();
  });

  it("multi-turn after abort: turn 2 includes turn-1 user + partial assistant + turn-2 user", async () => {
    seedChatConn();
    const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          messages: Array<{ role: string; content: string }>;
        };
        calls.push(body);
        const enc = new TextEncoder();
        const sig = init.signal as AbortSignal;
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(
              enc.encode(`data: {"choices":[{"delta":{"content":"R${calls.length}"}}]}\n\n`),
            );
            await new Promise<void>((resolve) =>
              sig.addEventListener("abort", () => resolve(), { once: true }),
            );
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: /chat-1/i }));

    // Turn 1
    const input = screen.getByPlaceholderText(/type your message|输入消息/i);
    await user.type(input, "hi 1");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));
    await waitFor(() => expect(screen.getByText(/^R1$/)).toBeInTheDocument());
    await user.click(await screen.findByRole("button", { name: /^stop$|^停止$/i }));

    // Turn 2 — should send [user-hi-1, assistant-R1, user-hi-2]
    // After abort, streaming flips false; the Stop button is replaced by Send.
    // (Send remains disabled until we type, since !draft.trim() disables it.)
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^stop$|^停止$/i })).not.toBeInTheDocument(),
    );
    await user.type(input, "hi 2");
    await user.click(screen.getByRole("button", { name: /^send$|^发送$/i }));

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].messages).toEqual([
      { role: "user", content: "hi 1" },
      { role: "assistant", content: "R1" },
      { role: "user", content: "hi 2" },
    ]);
    vi.unstubAllGlobals();
  });
});
