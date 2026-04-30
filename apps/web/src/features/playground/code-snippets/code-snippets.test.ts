import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@modeldoctor/contracts";
import { genChatSnippets } from "./chat";
import { genEmbeddingsSnippets } from "./embeddings";
import { genImagesSnippets } from "./images";
import { genRerankSnippets } from "./rerank";

describe("genChatSnippets", () => {
  it("renders curl/python/node with placeholder API key (snapshot)", () => {
    const snips = genChatSnippets({
      apiBaseUrl: "http://upstream.test",
      model: "m1",
      messages: [{ role: "user", content: "hi" }],
      params: { temperature: 0.5, maxTokens: 100 },
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
    expect(snips.node).toMatchSnapshot();
    // API key MUST appear as the placeholder, never blank or omitted
    expect(snips.curl).toContain("<YOUR_API_KEY>");
    expect(snips.python).toContain("<YOUR_API_KEY>");
    expect(snips.node).toContain("<YOUR_API_KEY>");
  });
});

describe("genEmbeddingsSnippets", () => {
  it("renders single + array input (snapshot)", () => {
    const single = genEmbeddingsSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      input: "hello",
    });
    const arr = genEmbeddingsSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      input: ["a", "b"],
    });
    expect(single.curl).toMatchSnapshot();
    expect(arr.python).toMatchSnapshot();
  });
});

describe("genRerankSnippets", () => {
  it("renders cohere wire (snapshot)", () => {
    const snips = genRerankSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      topN: 2,
      wire: "cohere",
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
    expect(snips.node).toMatchSnapshot();
  });

  it("renders tei wire (snapshot)", () => {
    const snips = genRerankSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      query: "q",
      documents: ["a", "b"],
      wire: "tei",
    });
    expect(snips.curl).toMatchSnapshot();
  });
});

describe("genImagesSnippets", () => {
  it("renders prompt + size + n (snapshot)", () => {
    const snips = genImagesSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      prompt: "a red apple",
      size: "512x512",
      n: 1,
    });
    expect(snips.curl).toMatchSnapshot();
    expect(snips.python).toMatchSnapshot();
  });
});

describe("genChatSnippets multimodal truncation", () => {
  it("replaces image_url data URLs and input_audio data with truncation markers", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "describe" },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${"A".repeat(50000)}`,
            },
          },
          { type: "input_audio", input_audio: { data: "B".repeat(50000), format: "webm" } },
        ],
      },
    ];
    const out = genChatSnippets({
      apiBaseUrl: "http://x", model: "m", messages, params: {},
    });
    expect(out.curl).toContain("<BASE64_IMAGE_DATA_TRUNCATED>");
    expect(out.curl).toContain("<BASE64_AUDIO_DATA_TRUNCATED>");
    expect(out.curl).not.toContain("A".repeat(1000));
    expect(out.python).toContain("<BASE64_IMAGE_DATA_TRUNCATED>");
    expect(out.node).toContain("<BASE64_AUDIO_DATA_TRUNCATED>");
    expect(out).toMatchSnapshot();
  });
});
