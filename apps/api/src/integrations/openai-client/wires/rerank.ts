export interface BuildRerankBodyInput {
  model: string;
  query: string;
  documents: string[];
  topN?: number;
  returnDocuments?: boolean;
  wire: "cohere" | "tei";
}

export function buildRerankBody(input: BuildRerankBodyInput): Record<string, unknown> {
  if (input.wire === "tei") {
    return { model: input.model, query: input.query, texts: input.documents };
  }
  const body: Record<string, unknown> = {
    model: input.model,
    query: input.query,
    documents: input.documents,
  };
  if (input.topN !== undefined) body.top_n = input.topN;
  if (input.returnDocuments !== undefined) body.return_documents = input.returnDocuments;
  return body;
}

export interface RerankHit {
  index: number;
  score: number;
}

export function parseRerankResponse(json: unknown): RerankHit[] {
  if (Array.isArray(json)) {
    return json
      .filter(
        (r): r is { index: number; score: number } =>
          !!r &&
          typeof (r as { index?: unknown }).index === "number" &&
          typeof (r as { score?: unknown }).score === "number",
      )
      .map((r) => ({ index: r.index, score: r.score }));
  }
  const j = (json ?? {}) as {
    results?: { index?: unknown; relevance_score?: unknown }[];
  };
  return (j.results ?? [])
    .filter(
      (r): r is { index: number; relevance_score: number } =>
        typeof r.index === "number" && typeof r.relevance_score === "number",
    )
    .map((r) => ({ index: r.index, score: r.relevance_score }));
}
