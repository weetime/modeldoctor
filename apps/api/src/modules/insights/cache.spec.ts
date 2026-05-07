import { describe, expect, it } from "vitest";
import { LruCache } from "./cache.js";

describe("LruCache", () => {
  it("evicts least-recently-used when capacity exceeded", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a"); // touch a
    c.set("c", 3); // should evict b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("respects ttl", () => {
    const c = new LruCache<string, number>(10, { ttlMs: 100 });
    c.set("a", 1, Date.now() - 200); // already expired
    expect(c.get("a")).toBeUndefined();
  });
});
