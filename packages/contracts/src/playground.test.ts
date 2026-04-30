import { describe, expect, it } from "vitest";
import {
  ChatMessageContentPartSchema,
  ChatMessageSchema,
  PlaygroundChatRequestSchema,
  PlaygroundChatResponseSchema,
  PlaygroundEmbeddingsRequestSchema,
  PlaygroundEmbeddingsResponseSchema,
  PlaygroundImagesEditMultipartFieldsSchema,
  PlaygroundImagesRequestSchema,
  PlaygroundImagesResponseSchema,
  PlaygroundRerankRequestSchema,
  PlaygroundRerankResponseSchema,
  PlaygroundTranscriptionsBodySchema,
  PlaygroundTranscriptionsResponseSchema,
  PlaygroundTtsRequestSchema,
  PlaygroundTtsResponseSchema,
} from "./playground.js";

describe("ChatMessageContentPartSchema — input_file", () => {
  it("accepts input_file with PDF base64 data URL", () => {
    const r = ChatMessageContentPartSchema.parse({
      type: "input_file",
      file: {
        filename: "doc.pdf",
        file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
      },
    });
    expect(r.type).toBe("input_file");
  });

  it("accepts input_file with text/plain mime", () => {
    const r = ChatMessageContentPartSchema.parse({
      type: "input_file",
      file: {
        filename: "readme.txt",
        file_data: "data:text/plain;base64,aGVsbG8=",
      },
    });
    expect(r.type).toBe("input_file");
  });

  it("rejects input_file with non-whitelisted mime", () => {
    expect(() =>
      ChatMessageContentPartSchema.parse({
        type: "input_file",
        file: {
          filename: "x.exe",
          file_data: "data:application/x-msdownload;base64,AA==",
        },
      }),
    ).toThrow();
  });

  it("rejects input_file with missing filename", () => {
    expect(() =>
      ChatMessageContentPartSchema.parse({
        type: "input_file",
        file: {
          filename: "",
          file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
        },
      }),
    ).toThrow();
  });
});

describe("ChatMessageSchema", () => {
  it("accepts a string-content message", () => {
    expect(() => ChatMessageSchema.parse({ role: "user", content: "hello" })).not.toThrow();
  });

  it("accepts a content-parts array with text + image_url", () => {
    expect(() =>
      ChatMessageSchema.parse({
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVB..." } },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() => ChatMessageSchema.parse({ role: "tool", content: "hi" })).toThrow();
  });
});

describe("PlaygroundChatRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x.test",
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts a minimal request", () => {
    expect(() => PlaygroundChatRequestSchema.parse(base)).not.toThrow();
  });

  it("requires at least one message", () => {
    expect(() => PlaygroundChatRequestSchema.parse({ ...base, messages: [] })).toThrow();
  });

  it("defaults params to an empty object", () => {
    const out = PlaygroundChatRequestSchema.parse(base);
    expect(out.params).toEqual({});
  });
});

describe("PlaygroundChatResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: true,
        content: "hi back",
        latencyMs: 123,
      }),
    ).not.toThrow();
  });

  it("accepts an error shape", () => {
    expect(() =>
      PlaygroundChatResponseSchema.parse({
        success: false,
        error: "upstream 500",
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundEmbeddingsRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", input: "one" };
  it("accepts string input", () => {
    expect(() => PlaygroundEmbeddingsRequestSchema.parse(base)).not.toThrow();
  });
  it("accepts string[] input", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: ["a", "b"] }),
    ).not.toThrow();
  });
  it("rejects empty string[] input", () => {
    expect(() => PlaygroundEmbeddingsRequestSchema.parse({ ...base, input: [] })).toThrow();
  });
  it("validates encodingFormat enum", () => {
    expect(() =>
      PlaygroundEmbeddingsRequestSchema.parse({ ...base, encodingFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundEmbeddingsResponseSchema", () => {
  it("accepts the OK shape", () => {
    expect(() =>
      PlaygroundEmbeddingsResponseSchema.parse({
        success: true,
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        latencyMs: 12,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundRerankRequestSchema", () => {
  const base = {
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    query: "q",
    documents: ["a", "b"],
  };
  it("defaults wire to 'cohere'", () => {
    const out = PlaygroundRerankRequestSchema.parse(base);
    expect(out.wire).toBe("cohere");
  });
  it("rejects empty documents", () => {
    expect(() => PlaygroundRerankRequestSchema.parse({ ...base, documents: [] })).toThrow();
  });
});

describe("PlaygroundRerankResponseSchema", () => {
  it("accepts results with index + score", () => {
    expect(() =>
      PlaygroundRerankResponseSchema.parse({
        success: true,
        results: [{ index: 0, score: 0.9 }],
        latencyMs: 5,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundImagesRequestSchema", () => {
  const base = { apiBaseUrl: "http://x", apiKey: "k", model: "m", prompt: "p" };
  it("accepts minimal request", () => {
    expect(() => PlaygroundImagesRequestSchema.parse(base)).not.toThrow();
  });
  it("validates n is positive int", () => {
    expect(() => PlaygroundImagesRequestSchema.parse({ ...base, n: 0 })).toThrow();
  });
  it("validates responseFormat enum", () => {
    expect(() =>
      PlaygroundImagesRequestSchema.parse({ ...base, responseFormat: "bogus" }),
    ).toThrow();
  });
});

describe("PlaygroundImagesResponseSchema", () => {
  it("accepts artifacts with url-only or b64-only entries", () => {
    expect(() =>
      PlaygroundImagesResponseSchema.parse({
        success: true,
        artifacts: [{ url: "http://a" }, { b64Json: "AAA" }],
        latencyMs: 50,
      }),
    ).not.toThrow();
  });
});

describe("PlaygroundImagesEditMultipartFieldsSchema", () => {
  const base = {
    apiBaseUrl: "http://x",
    apiKey: "k",
    model: "m",
    prompt: "make the dog wear a hat",
  };
  it("accepts a minimal request", () => {
    expect(() => PlaygroundImagesEditMultipartFieldsSchema.parse(base)).not.toThrow();
  });
  it("accepts n as a numeric string", () => {
    const parsed = PlaygroundImagesEditMultipartFieldsSchema.parse({ ...base, n: "2" });
    expect(parsed.n).toBe("2");
  });
  it("rejects non-numeric n string", () => {
    expect(() =>
      PlaygroundImagesEditMultipartFieldsSchema.parse({ ...base, n: "two" }),
    ).toThrow();
  });
  it("rejects empty prompt", () => {
    expect(() => PlaygroundImagesEditMultipartFieldsSchema.parse({ ...base, prompt: "" })).toThrow();
  });
});

describe("PlaygroundTtsRequestSchema", () => {
  it("applies defaults for voice + format", () => {
    const parsed = PlaygroundTtsRequestSchema.parse({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "m",
      input: "hi",
    });
    expect(parsed.voice).toBe("alloy");
    expect(parsed.format).toBe("mp3");
  });

  it("rejects invalid format", () => {
    expect(() =>
      PlaygroundTtsRequestSchema.parse({
        apiBaseUrl: "http://x",
        apiKey: "k",
        model: "m",
        input: "hi",
        format: "wav-bogus",
      }),
    ).toThrow();
  });

  it("rejects empty input", () => {
    expect(() =>
      PlaygroundTtsRequestSchema.parse({
        apiBaseUrl: "http://x",
        apiKey: "k",
        model: "m",
        input: "",
      }),
    ).toThrow();
  });
});

describe("PlaygroundTranscriptionsBodySchema", () => {
  it("applies default task=transcribe", () => {
    const parsed = PlaygroundTranscriptionsBodySchema.parse({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "whisper-1",
    });
    expect(parsed.task).toBe("transcribe");
  });

  it("accepts language + prompt + temperature", () => {
    const parsed = PlaygroundTranscriptionsBodySchema.parse({
      apiBaseUrl: "http://x",
      apiKey: "k",
      model: "whisper-1",
      language: "zh",
      prompt: "domain terms",
      temperature: 0.2,
    });
    expect(parsed.language).toBe("zh");
    expect(parsed.temperature).toBe(0.2);
  });

  it("rejects invalid task", () => {
    expect(() =>
      PlaygroundTranscriptionsBodySchema.parse({
        apiBaseUrl: "http://x",
        apiKey: "k",
        model: "m",
        task: "summarize",
      }),
    ).toThrow();
  });
});

describe("PlaygroundTtsResponseSchema + PlaygroundTranscriptionsResponseSchema", () => {
  it("response shapes are validatable", () => {
    expect(
      PlaygroundTtsResponseSchema.parse({
        success: true,
        audioBase64: "abc",
        format: "mp3",
        latencyMs: 100,
      }).success,
    ).toBe(true);
    expect(
      PlaygroundTranscriptionsResponseSchema.parse({ success: true, text: "hello", latencyMs: 100 })
        .success,
    ).toBe(true);
  });
});

describe("PlaygroundTtsRequestSchema reference fields", () => {
  it("accepts reference_audio_base64 + reference_text", () => {
    const r = PlaygroundTtsRequestSchema.parse({
      apiBaseUrl: "https://x.example.com",
      apiKey: "k",
      model: "m",
      input: "hello",
      voice: "alloy",
      format: "wav",
      reference_audio_base64: "data:audio/wav;base64,UklGRgAAAA==",
      reference_text: "transcript",
    });
    expect(r.reference_audio_base64).toMatch(/^data:audio\//);
    expect(r.reference_text).toBe("transcript");
  });
  it("rejects malformed data URL", () => {
    expect(() =>
      PlaygroundTtsRequestSchema.parse({
        apiBaseUrl: "https://x",
        apiKey: "k",
        model: "m",
        input: "x",
        voice: "alloy",
        format: "wav",
        reference_audio_base64: "not-a-data-url",
      }),
    ).toThrow();
  });
  it("accepts omitted reference fields (fully optional)", () => {
    const r = PlaygroundTtsRequestSchema.parse({
      apiBaseUrl: "https://x",
      apiKey: "k",
      model: "m",
      input: "hi",
    });
    expect(r.reference_audio_base64).toBeUndefined();
    expect(r.reference_text).toBeUndefined();
  });
});
