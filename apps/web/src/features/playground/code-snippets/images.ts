import { noBase64Snippets } from "./chat";
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface ImagesSnippetInput {
  apiBaseUrl: string;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  responseFormat?: "url" | "b64_json";
  seed?: number;
}

export function genImagesSnippets(input: ImagesSnippetInput): CodeSnippets {
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/images/generations`;
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt };
  if (input.size) body.size = input.size;
  if (input.n) body.n = input.n;
  if (input.responseFormat) body.response_format = input.responseFormat;
  if (input.seed !== undefined) body.seed = input.seed;
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.images.generate(${pyKw(body)})
print(resp.data[0].url or resp.data[0].b64_json[:32])`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${input.apiBaseUrl}", apiKey: "${PLACEHOLDER}" });
const resp = await client.images.generate(${json});
console.log(resp.data[0].url ?? resp.data[0].b64_json?.slice(0, 32));`;
  return noBase64Snippets(curl, python, node);
}

function pyKw(body: Record<string, unknown>): string {
  const lines = Object.entries(body).map(([k, v]) => `    ${k}=${JSON.stringify(v)}`);
  return `\n${lines.join(",\n")},\n`;
}
