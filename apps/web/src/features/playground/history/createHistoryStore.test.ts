import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "./createHistoryStore";

interface DummySnap {
  text: string;
}

describe("createHistoryStore", () => {
  beforeEach(() => {
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
});
