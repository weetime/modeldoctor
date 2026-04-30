import { describe, expect, it } from "vitest";
import { base64ToBlob, blobToDataUrl, dataUrlToBlob } from "./dataUrl";

describe("dataUrlToBlob", () => {
  it("converts a data URL to a Blob with the correct MIME type", () => {
    // 1-pixel transparent PNG in base64
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("round-trips: dataUrlToBlob → blobToDataUrl reproduces original data URL", async () => {
    const original =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const blob = dataUrlToBlob(original);
    const restored = await blobToDataUrl(blob);
    expect(restored).toBe(original);
  });
});

describe("base64ToBlob", () => {
  it("converts raw base64 + MIME to a Blob", async () => {
    // Small PCM-like binary encoded as base64
    const raw = btoa("\x00\x01\x02\x03");
    const blob = base64ToBlob(raw, "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBe(4);
    const restored = await blobToDataUrl(blob);
    expect(restored).toBe(`data:audio/webm;base64,${raw}`);
  });
});

describe("blobToDataUrl", () => {
  it("converts a Blob to a data URL string", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const url = await blobToDataUrl(blob);
    expect(url).toMatch(/^data:text\/plain;base64,/);
  });
});
