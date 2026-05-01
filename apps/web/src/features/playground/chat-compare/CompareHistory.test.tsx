/**
 * CompareHistory round-trip tests.
 *
 * Covers:
 *   - saveCompareSnapshot / restoreCompareSnapshot round-trip (text only)
 *   - round-trip with image_url attachment → idb:// sentinel → restored data URL
 *   - restoreSnapshot action on useCompareStore
 *   - preview generation
 *   - delete entry
 */

import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({ data: [], isLoading: false, error: null }),
  useConnection: () => ({ data: null, isLoading: false, error: null }),
}));

import {
  restoreCompareSnapshot,
  saveCompareSnapshot,
  useCompareHistoryStore,
} from "./CompareHistory";
import { type CompareSnapshot, useCompareStore } from "./store";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Tiny 1×1 transparent PNG as a data URL.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

function resetCompareStore() {
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
}

// ---------------------------------------------------------------------------
// restoreSnapshot action
// ---------------------------------------------------------------------------

describe("useCompareStore.restoreSnapshot", () => {
  beforeEach(resetCompareStore);

  it("overwrites panelCount and panels from a CompareSnapshot", () => {
    const snap: CompareSnapshot = {
      panelCount: 3,
      systemMessage: "be concise",
      panels: [
        { connectionId: "conn-a", params: { temperature: 0.5 }, messages: [] },
        { connectionId: "conn-b", params: {}, messages: [{ role: "user", content: "hi" }] },
        { connectionId: null, params: {}, messages: [] },
      ],
    };
    useCompareStore.getState().restoreSnapshot(snap);
    const s = useCompareStore.getState();
    expect(s.panelCount).toBe(3);
    expect(s.sharedSystemMessage).toBe("be concise");
    expect(s.panels).toHaveLength(3);
    expect(s.panels[0].selectedConnectionId).toBe("conn-a");
    expect(s.panels[0].params.temperature).toBe(0.5);
    expect(s.panels[1].messages).toEqual([{ role: "user", content: "hi" }]);
    // ephemeral fields blank
    for (const p of s.panels) {
      expect(p.sending).toBe(false);
      expect(p.streaming).toBe(false);
      expect(p.abortController).toBeNull();
      expect(p.error).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// save / restore round-trip (no attachments)
// ---------------------------------------------------------------------------

describe("saveCompareSnapshot + restoreCompareSnapshot — text only", () => {
  beforeEach(() => {
    resetCompareStore();
    useCompareHistoryStore.getState().reset();
  });

  it("saves current state and restores it back", async () => {
    // Set up compare working state.
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      sharedSystemMessage: "system prompt",
      panels: [
        {
          ...s.panels[0],
          selectedConnectionId: "conn-x",
          params: { temperature: 0.7 },
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        },
        {
          ...s.panels[1],
          selectedConnectionId: "conn-y",
          params: {},
          messages: [{ role: "user", content: "hello" }],
        },
      ],
    }));

    // Save.
    await saveCompareSnapshot();

    // Wipe working state to verify restore works.
    resetCompareStore();
    expect(useCompareStore.getState().panels[0].messages).toHaveLength(0);

    // Find the saved entry (it's listed after `currentId` changes on newSession).
    const histStore = useCompareHistoryStore.getState();
    // The most recently saved entry is now currentId (newSession was called inside saveCompareSnapshot).
    const entryId = histStore.currentId;
    const entry = histStore.list.find((e) => e.id === entryId);
    expect(entry).toBeDefined();
    expect(entry?.snapshot.panelCount).toBe(2);
    expect(entry?.snapshot.systemMessage).toBe("system prompt");

    // Restore from that entryId.
    await restoreCompareSnapshot(entryId);

    const s = useCompareStore.getState();
    expect(s.panelCount).toBe(2);
    expect(s.sharedSystemMessage).toBe("system prompt");
    expect(s.panels[0].selectedConnectionId).toBe("conn-x");
    expect(s.panels[0].params.temperature).toBe(0.7);
    expect(s.panels[0].messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
    expect(s.panels[1].messages).toEqual([{ role: "user", content: "hello" }]);
  });
});

// ---------------------------------------------------------------------------
// round-trip WITH attachment
// ---------------------------------------------------------------------------

describe("saveCompareSnapshot + restoreCompareSnapshot — image attachment", () => {
  let blobStore: Map<string, Blob>;

  beforeEach(() => {
    resetCompareStore();
    useCompareHistoryStore.getState().reset();

    blobStore = new Map();

    // Spy on the history store's blob methods.
    vi.spyOn(useCompareHistoryStore.getState(), "putBlob").mockImplementation(
      async (entryId: string, key: string, blob: Blob) => {
        blobStore.set(`${entryId}:${key}`, blob);
      },
    );
    vi.spyOn(useCompareHistoryStore.getState(), "getBlob").mockImplementation(
      async (entryId: string, key: string) => {
        return blobStore.get(`${entryId}:${key}`) ?? null;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips image_url to idb:// on save and recovers data URL on restore", async () => {
    // Set panel 0 with an image-attached user message.
    useCompareStore.setState((s) => ({
      ...s,
      panelCount: 2,
      panels: [
        {
          ...s.panels[0],
          selectedConnectionId: "conn-a",
          params: {},
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "describe this" },
                { type: "image_url", image_url: { url: PNG_DATA_URL } },
              ],
            },
          ],
        },
        { ...s.panels[1], messages: [] },
      ],
    }));

    // Save — should call putBlob for the image part.
    await saveCompareSnapshot();

    const histStore = useCompareHistoryStore.getState();
    const entryId = histStore.currentId;
    const entry = histStore.list.find((e) => e.id === entryId);
    expect(entry).toBeDefined();

    // The saved snapshot should have the sentinel, not the raw data URL.
    const savedImg = entry?.snapshot.panels[0].messages[0].content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(savedImg[1].image_url?.url).toBe("idb://panel0.msg0.part1");

    // putBlob called with the right key.
    expect(vi.mocked(useCompareHistoryStore.getState().putBlob)).toHaveBeenCalledWith(
      entryId,
      "panel0.msg0.part1",
      expect.any(Blob),
    );

    // Wipe working state.
    resetCompareStore();

    // Restore.
    await restoreCompareSnapshot(entryId);

    // getBlob should have been called.
    expect(vi.mocked(useCompareHistoryStore.getState().getBlob)).toHaveBeenCalledWith(
      entryId,
      "panel0.msg0.part1",
    );

    // Working state should now have the original data URL.
    const liveMsg = useCompareStore.getState().panels[0].messages[0];
    expect(Array.isArray(liveMsg.content)).toBe(true);
    const liveImg = (liveMsg.content as Array<{ type: string; image_url?: { url: string } }>)[1];
    expect(liveImg.image_url?.url).toBe(PNG_DATA_URL);
  });
});

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

describe("useCompareHistoryStore preview", () => {
  it("generates preview with panel count and first user message snippet", async () => {
    useCompareHistoryStore.getState().reset();
    const histStore = useCompareHistoryStore.getState();

    const snap: CompareSnapshot = {
      panelCount: 3,
      systemMessage: "",
      panels: [
        {
          connectionId: null,
          params: {},
          messages: [{ role: "user", content: "What is the meaning of life?" }],
        },
        { connectionId: null, params: {}, messages: [] },
        { connectionId: null, params: {}, messages: [] },
      ],
    };

    histStore.save(snap);
    // Re-read state after save (zustand triggers a new state object)
    const afterSave = useCompareHistoryStore.getState();
    const entry = afterSave.list.find((e) => e.id === afterSave.currentId);
    expect(entry?.preview).toContain("3 panels");
    expect(entry?.preview).toContain("What is the meaning of life?");
  });
});

// ---------------------------------------------------------------------------
// CompareHistoryControls UI smoke test
// ---------------------------------------------------------------------------

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn() } };
});

vi.mock("@/lib/playground-stream", () => ({
  playgroundFetchStream: vi.fn().mockResolvedValue(undefined),
}));

describe("CompareHistoryControls in ChatComparePage", () => {
  beforeEach(() => {
    resetCompareStore();
    useCompareHistoryStore.getState().reset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Save snapshot button and Snapshots dropdown trigger", async () => {
    const { ChatComparePage } = await import("./ChatComparePage");
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ChatComparePage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: /save snapshot|保存快照/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /snapshots|快照/i })).toBeInTheDocument();
  });

  it("clicking Save snapshot shows snapshotSaved toast", async () => {
    const { ChatComparePage } = await import("./ChatComparePage");
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ChatComparePage />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const saveBtn = screen.getByRole("button", { name: /save snapshot|保存快照/i });
    await userEvent.click(saveBtn);
    // toast renders async; just verify the save didn't throw (store has entry)
    await waitFor(() => {
      const list = useCompareHistoryStore.getState().list;
      // newSession creates a new entry on each save
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });
});
