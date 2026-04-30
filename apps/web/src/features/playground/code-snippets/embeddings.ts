import { noBase64Snippets } from "./chat";
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface EmbeddingsSnippetInput {
  apiBaseUrl: string;
  model: string;
  input: string | string[];
  encodingFormat?: "float" | "base64";
  dimensions?: number;
}

export function genEmbeddingsSnippets(input: EmbeddingsSnippetInput): CodeSnippets {
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}/v1/embeddings`;
  const body: Record<string, unknown> = { model: input.model, input: input.input };
  if (input.encodingFormat) body.encoding_format = input.encodingFormat;
  if (input.dimensions) body.dimensions = input.dimensions;
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `from openai import OpenAI

client = OpenAI(base_url="${input.apiBaseUrl}", api_key="${PLACEHOLDER}")
resp = client.embeddings.create(model=${JSON.stringify(input.model)}, input=${JSON.stringify(input.input)})
print(len(resp.data[0].embedding))`;
  const node = `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${input.apiBaseUrl}", apiKey: "${PLACEHOLDER}" });
const resp = await client.embeddings.create(${json});
console.log(resp.data[0].embedding.length);`;
  return noBase64Snippets(curl, python, node);
}
