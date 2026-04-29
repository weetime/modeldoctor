import { describe, expect, it } from "vitest";
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
