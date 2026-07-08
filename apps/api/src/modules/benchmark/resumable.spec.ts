import { describe, expect, it } from "vitest";
import { isResumable } from "./resumable.js";

describe("isResumable", () => {
  it("tau3 resumable, guidellm not, unknown false", () => {
    expect(isResumable("tau3")).toBe(true);
    expect(isResumable("guidellm")).toBe(false);
    expect(isResumable("nope")).toBe(false);
  });
});
