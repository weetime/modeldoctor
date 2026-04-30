import type { ChatMessage } from "@modeldoctor/contracts";
import { describe, expect, it } from "vitest";
import type { SttSlice, TtsSlice } from "../audio/store";
import { genAudioSnippets } from "./audio";
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

describe("genAudioSnippets — TTS", () => {
  it("includes /v1/audio/speech path and key fields in all 3 languages", () => {
    const tts: TtsSlice = {
      input: "Hello world.",
      voice: "alloy",
      format: "mp3",
      speed: 1.0,
      autoPlay: true,
      result: null,
      sending: false,
      error: null,
    };
    const stt: SttSlice = {
      fileName: null,
      fileSize: null,
      fileMimeType: null,
      language: "",
      task: "transcribe",
      prompt: "",
      temperature: undefined,
      result: null,
      sending: false,
      error: null,
    };
    const out = genAudioSnippets({
      activeTab: "tts",
      apiBaseUrl: "https://upstream.example",
      tts,
      stt,
    });
    expect(out.curl).toContain("/v1/audio/speech");
    expect(out.curl).toContain("Hello world.");
    expect(out.curl).toContain("<YOUR_API_KEY>");
    expect(out.python).toContain("audio.speech");
    expect(out.node).toContain("audio.speech");
    expect(out).toMatchSnapshot();
  });
});

describe("genAudioSnippets — STT", () => {
  it("includes /v1/audio/transcriptions path and multipart -F flags", () => {
    const tts: TtsSlice = {
      input: "",
      voice: "alloy",
      format: "mp3",
      speed: undefined,
      autoPlay: true,
      result: null,
      sending: false,
      error: null,
    };
    const stt: SttSlice = {
      fileName: "audio.wav",
      fileSize: 1024,
      fileMimeType: "audio/wav",
      language: "zh",
      task: "transcribe",
      prompt: "domain terms",
      temperature: 0.2,
      result: null,
      sending: false,
      error: null,
    };
    const out = genAudioSnippets({
      activeTab: "stt",
      apiBaseUrl: "https://upstream.example",
      tts,
      stt,
    });
    expect(out.curl).toContain("/v1/audio/transcriptions");
    expect(out.curl).toContain('-F "file=@');
    expect(out.curl).toContain('-F "model=');
    expect(out.python).toContain("audio.transcriptions.create");
    expect(out.node).toContain("audio.transcriptions.create");
    expect(out).toMatchSnapshot();
  });
});

describe("genChatSnippets multimodal truncation (readable / full dual view)", () => {
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

  it("readable view truncates image and audio data; full view preserves them", () => {
    const out = genChatSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      messages,
      params: {},
    });
    // readable truncates with new marker
    expect(out.curlReadable).toMatch(/AAAAAAAA\.\.\.\{\d+ KB truncated\}/);
    expect(out.curlReadable).toMatch(/BBBBBBBB\.\.\.\{\d+ KB truncated\}/);
    expect(out.curlReadable).not.toContain("A".repeat(1000));
    expect(out.curlReadable).not.toContain("B".repeat(1000));
    // full preserves all data
    expect(out.curlFull).toContain("A".repeat(1000));
    expect(out.curlFull).toContain("B".repeat(1000));
    // legacy .curl === readable
    expect(out.curl).toBe(out.curlReadable);
    // python and node dual fields
    expect(out.pythonReadable).toMatch(/AAAAAAAA\.\.\.\{\d+ KB truncated\}/);
    expect(out.pythonFull).toContain("A".repeat(1000));
    expect(out.nodeReadable).toMatch(/AAAAAAAA\.\.\.\{\d+ KB truncated\}/);
    expect(out.nodeFull).toContain("A".repeat(1000));
  });

  it("plain text messages: readable === full across all languages", () => {
    const out = genChatSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      params: {},
    });
    expect(out.curlReadable).toBe(out.curlFull);
    expect(out.pythonReadable).toBe(out.pythonFull);
    expect(out.nodeReadable).toBe(out.nodeFull);
  });

  it("image_url with short base64 (≤ 24 chars) is not truncated", () => {
    const shortData = `data:image/png;base64,${"A".repeat(24)}`;
    const out = genChatSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: shortData } }] }],
      params: {},
    });
    expect(out.curlReadable).toBe(out.curlFull);
  });

  it("snapshot: multimodal readable and full (snapshot)", () => {
    const out = genChatSnippets({
      apiBaseUrl: "http://x",
      model: "m",
      messages,
      params: {},
    });
    expect(out).toMatchSnapshot();
  });
});

describe("base64 readable / full split (plan Step 2 tests)", () => {
  const reqWithImage = {
    apiBaseUrl: "http://api.example.com",
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(200)}` } },
        ],
      },
    ],
    params: {},
  };

  it("produces both readable and full curl strings", () => {
    const out = genChatSnippets(reqWithImage as Parameters<typeof genChatSnippets>[0]);
    expect(out).toHaveProperty("curlReadable");
    expect(out).toHaveProperty("curlFull");
    // readable truncates
    expect(out.curlReadable).toMatch(/AAAAAAAA\.\.\.\{\d+ KB truncated\}/);
    expect(out.curlReadable).not.toContain("A".repeat(200));
    // full preserves
    expect(out.curlFull).toContain("A".repeat(200));
  });

  it("produces matching python and node duals", () => {
    const out = genChatSnippets(reqWithImage as Parameters<typeof genChatSnippets>[0]);
    expect(out.pythonReadable).not.toContain("A".repeat(200));
    expect(out.pythonFull).toContain("A".repeat(200));
    expect(out.nodeReadable).not.toContain("A".repeat(200));
    expect(out.nodeFull).toContain("A".repeat(200));
  });

  it("when no base64 fields, readable === full", () => {
    const plain = { ...reqWithImage, messages: [{ role: "user", content: "hi" }] };
    const out = genChatSnippets(plain as Parameters<typeof genChatSnippets>[0]);
    expect(out.curlReadable).toBe(out.curlFull);
  });
});
