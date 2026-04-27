import { api } from "@/lib/api-client";
import type {
  BenchmarkRun,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
  ListBenchmarksResponse,
} from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListBenchmarksQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.state) usp.set("state", q.state);
  if (q.profile) usp.set("profile", q.profile);
  if (q.search) usp.set("search", q.search);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const benchmarkApi = {
  list: (q: Partial<ListBenchmarksQuery>) =>
    api.get<ListBenchmarksResponse>(`/api/benchmarks${buildListQuery(q)}`),
  get: (id: string) => api.get<BenchmarkRun>(`/api/benchmarks/${id}`),
  create: (body: CreateBenchmarkRequest) => api.post<BenchmarkRun>("/api/benchmarks", body),
  cancel: (id: string) => api.post<BenchmarkRun>(`/api/benchmarks/${id}/cancel`, {}),
  delete: (id: string) => api.del<void>(`/api/benchmarks/${id}`),
};
