import { describe, expect, it } from "vitest";
import {
  ALLOWED_FILE_MIMES,
  ATTACHMENT_LIMITS,
  MAX_FILE_BYTES,
  buildContentParts,
  readFileAsAttachment,
} from "./attachments";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQ=";

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

  it("emits input_file part for file kind", () => {
    const out = buildContentParts("here is a file", [
      {
        kind: "file",
        name: "doc.pdf",
        dataUrl: PDF_DATA_URL,
        mimeType: "application/pdf",
        sizeBytes: 1000,
      },
    ]);
    expect(out).toEqual([
      { type: "text", text: "here is a file" },
      { type: "input_file", file: { filename: "doc.pdf", file_data: PDF_DATA_URL } },
    ]);
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

describe("ALLOWED_FILE_MIMES", () => {
  it("contains the whitelisted mime types", () => {
    expect(ALLOWED_FILE_MIMES.has("application/pdf")).toBe(true);
    expect(ALLOWED_FILE_MIMES.has("text/plain")).toBe(true);
    expect(ALLOWED_FILE_MIMES.has("application/json")).toBe(true);
    expect(ALLOWED_FILE_MIMES.has("text/markdown")).toBe(true);
    expect(ALLOWED_FILE_MIMES.has("text/x-markdown")).toBe(true);
  });

  it("does not contain non-whitelisted mime types", () => {
    expect(ALLOWED_FILE_MIMES.has("application/x-msdownload")).toBe(false);
    expect(ALLOWED_FILE_MIMES.has("image/png")).toBe(false);
  });
});

describe("MAX_FILE_BYTES", () => {
  it("is 8 MB", () => {
    expect(MAX_FILE_BYTES).toBe(8 * 1024 * 1024);
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

  it("encodes a PDF File to dataUrl + carries metadata for file kind", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
      type: "application/pdf",
    });
    const out = await readFileAsAttachment(file, "file");
    expect(out.kind).toBe("file");
    expect(out.name).toBe("doc.pdf");
    expect(out.sizeBytes).toBe(4);
    if (out.kind !== "file") throw new Error("expected file kind");
    expect(out.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(out.mimeType).toBe("application/pdf");
  });

  it("falls back to image/png when File has empty type and kind=image", async () => {
    const file = new File([new Uint8Array([1])], "no-type.bin", { type: "" });
    const out = await readFileAsAttachment(file, "image");
    expect(out.kind).toBe("image");
    if (out.kind === "image") {
      expect(out.mimeType).toBe("image/png");
    }
  });

  it("falls back to audio/webm when File has empty type and kind=audio", async () => {
    const file = new File([new Uint8Array([1])], "no-type.bin", { type: "" });
    const out = await readFileAsAttachment(file, "audio");
    expect(out.kind).toBe("audio");
    if (out.kind === "audio") {
      expect(out.mimeType).toBe("audio/webm");
    }
  });
});
