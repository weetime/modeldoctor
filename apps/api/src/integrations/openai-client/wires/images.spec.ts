import { describe, expect, it } from "vitest";
import {
  buildPlaygroundImagesBody,
  buildPlaygroundImagesEditFormData,
  parseImagesResponse,
} from "./images.js";

describe("buildPlaygroundImagesBody", () => {
  it("maps required fields", () => {
    expect(buildPlaygroundImagesBody({ model: "m", prompt: "a", size: "256x256", n: 2 })).toEqual({
      model: "m",
      prompt: "a",
      size: "256x256",
      n: 2,
    });
  });
  it("forwards seed + responseFormat", () => {
    const body = buildPlaygroundImagesBody({
      model: "m",
      prompt: "a",
      seed: 7,
      responseFormat: "b64_json",
    });
    expect(body).toMatchObject({ seed: 7, response_format: "b64_json" });
  });
});

describe("parseImagesResponse", () => {
  it("maps b64_json snake → camel", () => {
    expect(parseImagesResponse({ data: [{ url: "u" }, { b64_json: "AAA" }] })).toEqual([
      { url: "u", b64Json: undefined },
      { url: undefined, b64Json: "AAA" },
    ]);
  });
  it("returns [] for empty / missing data", () => {
    expect(parseImagesResponse({})).toEqual([]);
    expect(parseImagesResponse(null)).toEqual([]);
  });
});

describe("buildPlaygroundImagesEditFormData", () => {
  const baseImg = {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    originalname: "input.png",
    mimetype: "image/png",
  };
  const baseMask = {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    originalname: "mask.png",
    mimetype: "image/png",
  };

  it("appends image + mask + prompt + model", () => {
    const form = buildPlaygroundImagesEditFormData({
      image: baseImg,
      mask: baseMask,
      model: "gpt-image-1",
      prompt: "make it blue",
    });
    expect(form.get("model")).toBe("gpt-image-1");
    expect(form.get("prompt")).toBe("make it blue");
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);
    expect((form.get("image") as Blob).type).toBe("image/png");
  });

  it("appends n + size when provided", () => {
    const form = buildPlaygroundImagesEditFormData({
      image: baseImg,
      mask: baseMask,
      model: "m",
      prompt: "p",
      n: 3,
      size: "1024x1024",
    });
    expect(form.get("n")).toBe("3");
    expect(form.get("size")).toBe("1024x1024");
  });

  it("omits empty size string", () => {
    const form = buildPlaygroundImagesEditFormData({
      image: baseImg,
      mask: baseMask,
      model: "m",
      prompt: "p",
      size: "  ",
    });
    expect(form.has("size")).toBe(false);
  });
});
