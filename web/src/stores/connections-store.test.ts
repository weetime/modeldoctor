import { beforeEach, describe, expect, it } from "vitest";
import { useConnectionsStore } from "./connections-store";

const baseInput = {
  name: "prod",
  apiUrl: "http://x/y",
  apiKey: "sk-1",
  model: "m1",
  customHeaders: "",
  queryParams: "",
};

describe("connectionsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionsStore.setState({ connections: [] });
  });

  it("starts empty", () => {
    expect(useConnectionsStore.getState().list()).toEqual([]);
  });

  it("creates a connection with id and timestamps", () => {
    const c = useConnectionsStore.getState().create(baseInput);
    expect(c.id).toBeTruthy();
    expect(c.createdAt).toBeTruthy();
    expect(c.updatedAt).toBe(c.createdAt);
    expect(useConnectionsStore.getState().list()).toHaveLength(1);
  });

  it("rejects duplicate names", () => {
    useConnectionsStore.getState().create(baseInput);
    expect(() => useConnectionsStore.getState().create(baseInput)).toThrow(
      /name.*exists/i,
    );
  });

  it("get returns null for unknown id", () => {
    expect(useConnectionsStore.getState().get("nope")).toBeNull();
  });

  it("update modifies fields and bumps updatedAt", async () => {
    const c = useConnectionsStore.getState().create(baseInput);
    await new Promise((r) => setTimeout(r, 5));
    const updated = useConnectionsStore.getState().update(c.id, { model: "m2" });
    expect(updated.model).toBe("m2");
    expect(updated.updatedAt).not.toBe(c.updatedAt);
  });

  it("update rejects renaming to an existing name on another connection", () => {
    const a = useConnectionsStore.getState().create(baseInput);
    useConnectionsStore.getState().create({ ...baseInput, name: "stage" });
    expect(() =>
      useConnectionsStore.getState().update(a.id, { name: "stage" }),
    ).toThrow(/name.*exists/i);
  });

  it("remove deletes the connection", () => {
    const c = useConnectionsStore.getState().create(baseInput);
    useConnectionsStore.getState().remove(c.id);
    expect(useConnectionsStore.getState().list()).toHaveLength(0);
  });

  it("exportAll produces a versioned envelope", () => {
    useConnectionsStore.getState().create(baseInput);
    const json = useConnectionsStore.getState().exportAll();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.connections).toHaveLength(1);
  });

  it("importAll merge preserves existing names and skips collisions", () => {
    useConnectionsStore.getState().create(baseInput);
    const incoming = JSON.stringify({
      version: 1,
      connections: [
        { ...baseInput, id: "ext-1", createdAt: "x", updatedAt: "x" },
        { ...baseInput, id: "ext-2", name: "new", createdAt: "x", updatedAt: "x" },
      ],
    });
    const r = useConnectionsStore.getState().importAll(incoming, "merge");
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(useConnectionsStore.getState().list()).toHaveLength(2);
  });

  it("importAll replace wipes existing", () => {
    useConnectionsStore.getState().create(baseInput);
    const incoming = JSON.stringify({
      version: 1,
      connections: [
        { ...baseInput, id: "ext-1", name: "only", createdAt: "x", updatedAt: "x" },
      ],
    });
    const r = useConnectionsStore.getState().importAll(incoming, "replace");
    expect(r.added).toBe(1);
    expect(useConnectionsStore.getState().list()).toHaveLength(1);
    expect(useConnectionsStore.getState().list()[0].name).toBe("only");
  });

  it("importAll rejects unknown version", () => {
    expect(() =>
      useConnectionsStore
        .getState()
        .importAll(JSON.stringify({ version: 99, connections: [] }), "merge"),
    ).toThrow(/version/i);
  });
});
