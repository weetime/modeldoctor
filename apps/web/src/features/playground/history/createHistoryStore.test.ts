import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "./createHistoryStore";

interface DummySnap {
  text: string;
}

describe("createHistoryStore", () => {
  beforeEach(() => {
    // localStorage is no longer the backing store (IDB is), but clear it anyway
    // for completeness; IDB state is isolated by unique name keys per test.
    localStorage.clear();
  });

  it("seeds with one current empty entry on first read", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    const list = useStore.getState().list;
    expect(list).toHaveLength(1);
    expect(list[0].snapshot).toEqual({ text: "" });
    expect(useStore.getState().currentId).toBe(list[0].id);
  });

  it("save() updates the current (top) entry's snapshot+preview", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-2",
      blank: () => ({ text: "" }),
      preview: (s) => s.text.slice(0, 10),
    });
    const id = useStore.getState().currentId;
    useStore.getState().save({ text: "hello world" });
    const top = useStore.getState().list[0];
    expect(top.id).toBe(id); // same id, mutated in place
    expect(top.snapshot.text).toBe("hello world");
    expect(top.preview).toBe("hello worl");
  });

  it("newSession() prepends a fresh blank and switches currentId", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-3",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    useStore.getState().save({ text: "old" });
    const oldId = useStore.getState().currentId;
    useStore.getState().newSession();
    const list = useStore.getState().list;
    expect(list).toHaveLength(2);
    expect(list[0].snapshot.text).toBe("");
    expect(list[1].id).toBe(oldId);
    expect(useStore.getState().currentId).toBe(list[0].id);
  });

  it("restore(id) copies that entry's snapshot into the current top entry", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-4",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    const oldId = useStore.getState().list[1].id;
    useStore.getState().restore(oldId);
    expect(useStore.getState().list[0].snapshot.text).toBe("first");
    // Original "first" entry remains in list (not deleted)
    expect(useStore.getState().list.some((e) => e.id === oldId)).toBe(true);
  });

  it("LRU caps the list at 20 entries", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-5",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    for (let i = 0; i < 25; i++) {
      useStore.getState().save({ text: `s${i}` });
      useStore.getState().newSession();
    }
    expect(useStore.getState().list).toHaveLength(20);
  });

  it("scheduleAutoSave debounces rapid save calls", async () => {
    vi.useFakeTimers();
    try {
      const useStore = createHistoryStore<DummySnap>({
        name: "md-test-history-6",
        blank: () => ({ text: "" }),
        preview: (s) => s.text,
      });
      useStore.getState().scheduleAutoSave({ text: "a" });
      useStore.getState().scheduleAutoSave({ text: "ab" });
      useStore.getState().scheduleAutoSave({ text: "abc" });
      vi.advanceTimersByTime(1499);
      expect(useStore.getState().list[0].snapshot.text).toBe("");
      vi.advanceTimersByTime(1);
      expect(useStore.getState().list[0].snapshot.text).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeEntry deletes a non-current entry but is a no-op for current", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-remove",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    useStore.getState().save({ text: "first" });
    useStore.getState().newSession();
    useStore.getState().save({ text: "second" });
    expect(useStore.getState().list).toHaveLength(2);

    const oldId = useStore.getState().list[1].id;
    useStore.getState().removeEntry(oldId);
    expect(useStore.getState().list).toHaveLength(1);

    // current is no-op
    const currentId = useStore.getState().currentId;
    useStore.getState().removeEntry(currentId);
    expect(useStore.getState().list).toHaveLength(1);
    expect(useStore.getState().currentId).toBe(currentId);
  });

  it("restoreVersion bumps on newSession and restore but not on save/autosave", () => {
    const useStore = createHistoryStore<DummySnap>({
      name: "md-test-history-7",
      blank: () => ({ text: "" }),
      preview: (s) => s.text,
    });
    const v0 = useStore.getState().restoreVersion;
    expect(v0).toBe(0);

    useStore.getState().save({ text: "x" });
    expect(useStore.getState().restoreVersion).toBe(v0); // save does not bump

    useStore.getState().newSession();
    const v1 = useStore.getState().restoreVersion;
    expect(v1).toBe(v0 + 1);

    useStore.getState().save({ text: "y" });
    expect(useStore.getState().restoreVersion).toBe(v1); // still no bump

    const oldId = useStore.getState().list[1].id;
    useStore.getState().restore(oldId);
    expect(useStore.getState().restoreVersion).toBe(v1 + 1);
  });

  it("putBlob then getBlob round-trips a Blob keyed by entryId+attachmentKey", async () => {
    const useStore = createHistoryStore<{ x: number }>({
      name: "md-test-blob",
      blank: () => ({ x: 0 }),
      preview: () => "",
    });
    // Use Node.js native Blob so structuredClone works in fake-indexeddb
    const blob = new NodeBlob(["payload"], { type: "image/png" }) as unknown as Blob;
    const id = useStore.getState().currentId;
    await useStore.getState().putBlob(id, "thumb", blob);
    const got = await useStore.getState().getBlob(id, "thumb");
    expect(got).not.toBeNull();
    const ab = await got?.arrayBuffer();
    expect(Buffer.from(ab ?? new ArrayBuffer(0)).toString("utf8")).toBe("payload");
  });

  it("removeEntry also clears its blobs", async () => {
    const useStore = createHistoryStore<{ x: number }>({
      name: "md-test-blob-cleanup",
      blank: () => ({ x: 0 }),
      preview: () => "",
    });
    // create a 2nd entry, attach blob, remove
    useStore.getState().newSession(); // makes a fresh entry, pushes prev to position 1
    const prevId = useStore.getState().list[1].id;
    await useStore.getState().putBlob(prevId, "k", new NodeBlob(["x"]) as unknown as Blob);
    expect(await useStore.getState().getBlob(prevId, "k")).not.toBeNull();
    useStore.getState().removeEntry(prevId);
    // give async cleanup a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(await useStore.getState().getBlob(prevId, "k")).toBeNull();
  });
});
