import { api } from "@/lib/api-client";
import type {
  Benchmark,
  BenchmarkChartsResponse,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
  ListBenchmarksResponse,
} from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListBenchmarksQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.scenario) usp.set("scenario", q.scenario);
  if (q.tool) usp.set("tool", q.tool);
  if (q.status) usp.set("status", q.status);
  if (q.connectionId) usp.set("connectionId", q.connectionId);
  if (q.search) usp.set("search", q.search);
  if (q.createdAfter) usp.set("createdAfter", q.createdAfter);
  if (q.createdBefore) usp.set("createdBefore", q.createdBefore);
  if (q.isBaseline !== undefined) usp.set("isBaseline", String(q.isBaseline));
  if (q.referencesBaseline !== undefined)
    usp.set("referencesBaseline", String(q.referencesBaseline));
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const benchmarkApi = {
  list: (q: Partial<ListBenchmarksQuery>) =>
    api.get<ListBenchmarksResponse>(`/api/benchmarks${buildListQuery(q)}`),
  get: (id: string) => api.get<Benchmark>(`/api/benchmarks/${id}`),
  create: (body: CreateBenchmarkRequest) => api.post<Benchmark>("/api/benchmarks", body),
  cancel: (id: string) => api.post<Benchmark>(`/api/benchmarks/${id}/cancel`, {}),
  delete: (id: string) => api.del<void>(`/api/benchmarks/${id}`),
  getCharts: (id: string) => api.get<BenchmarkChartsResponse>(`/api/benchmarks/${id}/charts`),
};
