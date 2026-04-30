import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";

export interface ChatSnippetInput {
  apiBaseUrl: string;
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}

export interface CodeSnippets {
  curlReadable: string;
  curlFull: string;
  pythonReadable: string;
  pythonFull: string;
  nodeReadable: string;
  nodeFull: string;
}

const PLACEHOLDER = "<YOUR_API_KEY>";

/**
 * Truncates a data URL (data:[mime];base64,<body>) so that readable snippets
 * show only the first `headChars` characters of the base64 body plus a
 * human-friendly KB count, while the full variant retains the original.
 */
export function truncateDataUrl(
  dataUrl: string,
  headChars = 8,
): { readable: string; full: string } {
  const m = dataUrl.match(/^(data:[^;]+;base64,)([A-Za-z0-9+/=]+)$/);
  if (!m) return { readable: dataUrl, full: dataUrl };
  const head = m[1];
  const body = m[2];
  // Don't truncate small payloads — keep readable === full so the
  // "Copy readable" view stays executable. Spec § 9.1: banner only
  // shown when base64 > 1 KB, so sub-1-KB stays single-Copy.
  if (body.length <= 1024) return { readable: dataUrl, full: dataUrl };
  const kb = Math.round((body.length * 0.75) / 1024);
  return {
    readable: `${head}${body.slice(0, headChars)}...{${kb} KB truncated}`,
    full: dataUrl,
  };
}

/**
 * Truncates a raw base64 string (no data-URL prefix) for readable view.
 * Returns both readable and full variants.
 */
export function truncateBase64(b64: string, headChars = 8): { readable: string; full: string } {
  // Don't truncate small payloads — keep readable === full so the
  // "Copy readable" view stays executable. Spec § 9.1: banner only
  // shown when base64 > 1 KB, so sub-1-KB stays single-Copy.
  if (b64.length <= 1024) return { readable: b64, full: b64 };
  const kb = Math.round((b64.length * 0.75) / 1024);
  return {
    readable: `${b64.slice(0, headChars)}...{${kb} KB truncated}`,
    full: b64,
  };
}

function buildMessages(messages: ChatMessage[], variant: "readable" | "full"): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    return {
      ...m,
      content: m.content.map((p) => {
        if (p.type === "image_url" && p.image_url.url.startsWith("data:")) {
          const { readable, full } = truncateDataUrl(p.image_url.url);
          return { ...p, image_url: { url: variant === "readable" ? readable : full } };
        }
        if (p.type === "input_audio") {
          const { readable, full } = truncateBase64(p.input_audio.data);
          return {
            ...p,
            input_audio: {
              ...p.input_audio,
              data: variant === "readable" ? readable : full,
            },
          };
        }
        return p;
      }),
    };
  });
}

function buildBody(input: ChatSnippetInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  };
  const p = input.params;
  if (p.temperature !== undefined) body.temperature = p.temperature;
  if (p.maxTokens !== undefined) body.max_tokens = p.maxTokens;
  if (p.topP !== undefined) body.top_p = p.topP;
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.seed !== undefined) body.seed = p.seed;
  if (p.stop !== undefined) body.stop = p.stop;
  if (p.stream !== undefined) body.stream = p.stream;
  return body;
}

function buildSnippets(
  input: ChatSnippetInput,
  variant: "readable" | "full",
): { curl: string; python: string; node: string } {
  const messages = buildMessages(input.messages, variant);
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const body = buildBody({ ...input, messages });
  const bodyJson = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${bodyJson}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.chat.completions.create(${pyKwargs(body)})
print(resp.choices[0].message.content)`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${input.apiBaseUrl}",
  apiKey: "${PLACEHOLDER}",
});
const resp = await client.chat.completions.create(${bodyJson});
console.log(resp.choices[0].message.content);`;
  return { curl, python, node };
}

export function genChatSnippets(input: ChatSnippetInput): CodeSnippets {
  const readable = buildSnippets(input, "readable");
  const full = buildSnippets(input, "full");
  return {
    curlReadable: readable.curl,
    curlFull: full.curl,
    pythonReadable: readable.python,
    pythonFull: full.python,
    nodeReadable: readable.node,
    nodeFull: full.node,
  };
}

function pyKwargs(body: Record<string, unknown>): string {
  // Render { a: 1, b: "x" } as `\n    a=1,\n    b="x",\n`
  const lines = Object.entries(body).map(([k, v]) => `    ${k}=${JSON.stringify(v)}`);
  return `\n${lines.join(",\n")},\n`;
}

/**
 * Convenience helper for generators that produce no base64 content.
 * Returns a CodeSnippets where readable === full for all languages.
 */
export function noBase64Snippets(curl: string, python: string, node: string): CodeSnippets {
  return {
    curlReadable: curl,
    curlFull: curl,
    pythonReadable: python,
    pythonFull: python,
    nodeReadable: node,
    nodeFull: node,
  };
}
