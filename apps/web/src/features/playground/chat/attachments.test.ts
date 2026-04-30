import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS, buildContentParts, readFileAsAttachment } from "./attachments";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

describe("buildContentParts", () => {
  it("returns plain string when no attachments", () => {
    expect(buildContentParts("hi", [])).toBe("hi");
  });

  it("returns text + image_url part for one image attachment", () => {
    const out = buildContentParts("describe this", [
      {
        kind: "image",
        dataUrl: PNG_DATA_URL,
        mimeType: "image/png",
        sizeBytes: 100,
        name: "a.png",
      },
    ]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: PNG_DATA_URL } },
    ]);
  });

  it("returns input_audio part with format split from mimeType", () => {
    const out = buildContentParts("transcribe", [
      {
        kind: "audio",
        dataUrl: "data:audio/webm;codecs=opus;base64,Zm9vYmFy",
        mimeType: "audio/webm;codecs=opus",
        sizeBytes: 50,
        name: "rec.webm",
      },
    ]);
    expect(out).toEqual([
      { type: "text", text: "transcribe" },
      { type: "input_audio", input_audio: { data: "Zm9vYmFy", format: "webm" } },
    ]);
  });

  it("silently drops file kind (placeholder, not sent)", () => {
    const out = buildContentParts("here is a file", [
      { kind: "file", name: "doc.pdf", sizeBytes: 1000 },
    ]);
    expect(out).toEqual([{ type: "text", text: "here is a file" }]);
  });

  it("omits empty text part when text is whitespace-only", () => {
    const out = buildContentParts("   ", [
      { kind: "image", dataUrl: PNG_DATA_URL, mimeType: "image/png", sizeBytes: 10, name: "a.png" },
    ]);
    expect(out).toEqual([{ type: "image_url", image_url: { url: PNG_DATA_URL } }]);
  });
});

describe("ATTACHMENT_LIMITS", () => {
  it("matches spec — 5 max count, 10MB max each", () => {
    expect(ATTACHMENT_LIMITS.maxCount).toBe(5);
    expect(ATTACHMENT_LIMITS.maxSizeBytes).toBe(10 * 1024 * 1024);
  });
});

describe("readFileAsAttachment", () => {
  it("encodes a PNG File to dataUrl + carries metadata", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", {
      type: "image/png",
    });
    const out = await readFileAsAttachment(file, "image");
    expect(out.kind).toBe("image");
    if (out.kind !== "image") throw new Error("expected image kind");
    expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.name).toBe("a.png");
    expect(out.sizeBytes).toBe(4);
    expect(out.mimeType).toBe("image/png");
  });

  it("returns kind=file with no dataUrl", async () => {
    const file = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    const out = await readFileAsAttachment(file, "file");
    expect(out.kind).toBe("file");
    expect(out.name).toBe("doc.pdf");
    expect(out.sizeBytes).toBe(1);
    expect("dataUrl" in out).toBe(false);
  });
});
