import { api } from "@/lib/api-client";
import type {
  BenchmarkTemplate,
  CreateBenchmarkTemplateRequest,
  ListBenchmarkTemplatesQuery,
  ListBenchmarkTemplatesResponse,
  UpdateBenchmarkTemplateRequest,
} from "@modeldoctor/contracts";

function buildListQuery(q: Partial<ListBenchmarkTemplatesQuery>): string {
  const usp = new URLSearchParams();
  if (q.limit !== undefined) usp.set("limit", String(q.limit));
  if (q.cursor) usp.set("cursor", q.cursor);
  if (q.scenario) usp.set("scenario", q.scenario);
  if (q.tool) usp.set("tool", q.tool);
  if (q.category) usp.set("category", q.category);
  if (q.isOfficial !== undefined) usp.set("isOfficial", String(q.isOfficial));
  if (q.search) usp.set("search", q.search);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const benchmarkTemplateApi = {
  list: (q: Partial<ListBenchmarkTemplatesQuery>) =>
    api.get<ListBenchmarkTemplatesResponse>(`/api/benchmark-templates${buildListQuery(q)}`),
  get: (id: string) => api.get<BenchmarkTemplate>(`/api/benchmark-templates/${id}`),
  create: (body: CreateBenchmarkTemplateRequest) =>
    api.post<BenchmarkTemplate>("/api/benchmark-templates", body),
  update: (id: string, body: Partial<UpdateBenchmarkTemplateRequest>) =>
    api.patch<BenchmarkTemplate>(`/api/benchmark-templates/${id}`, body),
  delete: (id: string) => api.del<void>(`/api/benchmark-templates/${id}`),
};
