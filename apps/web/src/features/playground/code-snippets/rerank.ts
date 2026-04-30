import { noBase64Snippets } from "./chat";
import type { CodeSnippets } from "./chat";

const PLACEHOLDER = "<YOUR_API_KEY>";

export interface RerankSnippetInput {
  apiBaseUrl: string;
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  returnDocuments?: boolean;
  wire: "cohere" | "tei";
}

export function genRerankSnippets(input: RerankSnippetInput): CodeSnippets {
  const path = input.wire === "tei" ? "/rerank" : "/v1/rerank";
  const url = `${input.apiBaseUrl.replace(/\/+$/, "")}${path}`;
  const body: Record<string, unknown> =
    input.wire === "tei"
      ? { model: input.model, query: input.query, texts: input.documents }
      : { model: input.model, query: input.query, documents: input.documents };
  if (input.wire === "cohere") {
    if (input.topN !== undefined) body.top_n = input.topN;
    if (input.returnDocuments !== undefined) body.return_documents = input.returnDocuments;
  }
  const json = JSON.stringify(body, null, 2);
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer ${PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${json}'`;
  const python = `import requests, json

resp = requests.post(
    "${url}",
    headers={"Authorization": "Bearer ${PLACEHOLDER}", "Content-Type": "application/json"},
    data=json.dumps(${json}),
)
print(resp.json())`;
  const node = `const resp = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: "Bearer ${PLACEHOLDER}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${json}),
});
console.log(await resp.json());`;
  return noBase64Snippets(curl, python, node);
}
