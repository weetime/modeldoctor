import type { ChatMessage, ChatParams } from "@modeldoctor/contracts";

export interface ChatSnippetInput {
  apiBaseUrl: string;
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}

export interface CodeSnippets {
  curl: string;
  python: string;
  node: string;
}

const PLACEHOLDER = "<YOUR_API_KEY>";

function shortenForSnippet(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    return {
      ...m,
      content: m.content.map((p) => {
        if (p.type === "image_url" && p.image_url.url.startsWith("data:")) {
          const head = p.image_url.url.slice(0, 30); // e.g. "data:image/png;base64,"
          return { ...p, image_url: { url: `${head}<BASE64_IMAGE_DATA_TRUNCATED>` } };
        }
        if (p.type === "input_audio") {
          return {
            ...p,
            input_audio: { ...p.input_audio, data: "<BASE64_AUDIO_DATA_TRUNCATED>" },
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

export function genChatSnippets(input: ChatSnippetInput): CodeSnippets {
  const safeMessages = shortenForSnippet(input.messages);
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const body = buildBody({ ...input, messages: safeMessages });
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

function pyKwargs(body: Record<string, unknown>): string {
  // Render { a: 1, b: "x" } as `\n    a=1,\n    b="x",\n`
  const lines = Object.entries(body).map(([k, v]) => `    ${k}=${JSON.stringify(v)}`);
  return `\n${lines.join(",\n")},\n`;
}
