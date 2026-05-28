import { ChatMessageContentPartSchema, ChatMessageSchema } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import { MODALITY_BODY_TEMPLATES } from "./body-templates.js";

const MODEL = "Qwen2.5-0.5B-Instruct";

describe("MODALITY_BODY_TEMPLATES — JSON validity", () => {
  it.each([
    "chat",
    "chat-vision",
    "chat-audio",
    "embeddings",
    "rerank",
    "images",
  ] as const)("%s default body parses as JSON with the requested model", (apiType) => {
    const raw = MODALITY_BODY_TEMPLATES[apiType](MODEL);
    const parsed = JSON.parse(raw);
    expect(parsed.model).toBe(MODEL);
  });
});

describe("MODALITY_BODY_TEMPLATES — chat-vision shape", () => {
  it("emits a content-parts array with one image_url part", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES["chat-vision"](MODEL));
    const message = body.messages[0];
    expect(Array.isArray(message.content)).toBe(true);
    const imageParts = message.content.filter((p: { type: string }) => p.type === "image_url");
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("validates against ChatMessageSchema (OpenAI-compatible)", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES["chat-vision"](MODEL));
    for (const m of body.messages) {
      expect(() => ChatMessageSchema.parse(m)).not.toThrow();
    }
  });
});

describe("MODALITY_BODY_TEMPLATES — chat-audio shape", () => {
  it("emits a content-parts array with one input_audio part", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES["chat-audio"](MODEL));
    const message = body.messages[0];
    expect(Array.isArray(message.content)).toBe(true);
    const audioParts = message.content.filter((p: { type: string }) => p.type === "input_audio");
    expect(audioParts).toHaveLength(1);
    expect(audioParts[0].input_audio.format).toBe("wav");
    expect(typeof audioParts[0].input_audio.data).toBe("string");
    expect(audioParts[0].input_audio.data.length).toBeGreaterThan(0);
  });

  it("each part validates against ChatMessageContentPartSchema", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES["chat-audio"](MODEL));
    for (const part of body.messages[0].content) {
      expect(() => ChatMessageContentPartSchema.parse(part)).not.toThrow();
    }
  });
});

describe("MODALITY_BODY_TEMPLATES — non-chat shapes unchanged", () => {
  it("embeddings keeps { model, input } shape", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES.embeddings(MODEL));
    expect(body).toEqual({ model: MODEL, input: "hello" });
  });

  it("rerank keeps { model, query, documents } shape", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES.rerank(MODEL));
    expect(body.query).toBe("what is 2+2");
    expect(body.documents).toEqual(["four", "five"]);
  });

  it("images keeps { model, prompt } shape", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES.images(MODEL));
    expect(body.prompt).toBe("a cat");
  });

  it("plain chat keeps single user message", () => {
    const body = JSON.parse(MODALITY_BODY_TEMPLATES.chat(MODEL));
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
