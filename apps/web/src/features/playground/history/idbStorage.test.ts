import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createIdbStorage } from "./idbStorage";

// jsdom's Blob does not implement the structured-clone algorithm correctly,
// so we use Node.js's native Blob (which does) for round-trip tests.
const makeBlob = (content: string, type = "text/plain") =>
  new NodeBlob([content], { type }) as unknown as Blob;

const readBlob = async (blob: Blob): Promise<string> => {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab).toString("utf8");
};

// Use a unique DB name per test to avoid cross-test IDB state contamination.
let counter = 0;
const freshDb = () => `test-idb-storage-${++counter}`;

describe("idbStorage", () => {
  it("getItem returns null when key absent", async () => {
    const s = createIdbStorage(freshDb());
    expect(await s.getItem("missing")).toBeNull();
  });

  it("setItem then getItem round-trips JSON string", async () => {
    const s = createIdbStorage(freshDb());
    await s.setItem("k1", JSON.stringify({ hello: "world" }));
    expect(await s.getItem("k1")).toBe(JSON.stringify({ hello: "world" }));
  });

  it("removeItem deletes the entry", async () => {
    const s = createIdbStorage(freshDb());
    await s.setItem("k1", "v1");
    await s.removeItem("k1");
    expect(await s.getItem("k1")).toBeNull();
  });

  it("blob put/get round-trips a Blob", async () => {
    const s = createIdbStorage(freshDb());
    const blob = makeBlob("hello", "text/plain");
    await s.putBlob("entry1", "att1", blob);
    const got = await s.getBlob("entry1", "att1");
    expect(got).not.toBeNull();
    expect(await readBlob(got as Blob)).toBe("hello");
  });

  it("blob get returns null when missing", async () => {
    const s = createIdbStorage(freshDb());
    expect(await s.getBlob("e", "k")).toBeNull();
  });

  it("deleteEntryBlobs removes all blobs for entry", async () => {
    const s = createIdbStorage(freshDb());
    await s.putBlob("e1", "a", makeBlob("a"));
    await s.putBlob("e1", "b", makeBlob("b"));
    await s.putBlob("e2", "a", makeBlob("x"));
    await s.deleteEntryBlobs("e1");
    expect(await s.getBlob("e1", "a")).toBeNull();
    expect(await s.getBlob("e1", "b")).toBeNull();
    expect(await s.getBlob("e2", "a")).not.toBeNull();
  });
});
