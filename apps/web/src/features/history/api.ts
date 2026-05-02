import { api } from "@/lib/api-client";
import type { ListRunsQuery, ListRunsResponse, Run } from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListRunsQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.kind) usp.set("kind", q.kind);
  if (q.tool) usp.set("tool", q.tool);
  if (q.status) usp.set("status", q.status);
  if (q.connectionId) usp.set("connectionId", q.connectionId);
  if (q.search) usp.set("search", q.search);
  if (q.createdAfter) usp.set("createdAfter", q.createdAfter);
  if (q.createdBefore) usp.set("createdBefore", q.createdBefore);
  if (q.isBaseline !== undefined) usp.set("isBaseline", String(q.isBaseline));
  if (q.referencesBaseline !== undefined) usp.set("referencesBaseline", String(q.referencesBaseline));
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const historyApi = {
  list: (q: Partial<ListRunsQuery>) =>
    api.get<ListRunsResponse>(`/api/runs${buildListQuery(q)}`),
  get: (id: string) => api.get<Run>(`/api/runs/${id}`),
};
