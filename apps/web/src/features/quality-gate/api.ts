import { api } from "@/lib/api-client";
import type {
  CreateEvaluationRequest,
  CreateRunRequest,
  Evaluation,
  EvaluationRun,
  ImportEvaluationRequest,
  ListEvaluationsResponse,
  ListRunSamplesQuery,
  ListRunSamplesResponse,
  ListRunsQuery,
  ListRunsResponse,
  UpdateEvaluationRequest,
} from "@modeldoctor/contracts";

export const qgApi = {
  listEvaluations: () => api.get<ListEvaluationsResponse>("/api/quality-gate/evaluations"),
  getEvaluation: (id: string) => api.get<Evaluation>(`/api/quality-gate/evaluations/${id}`),
  createEvaluation: (body: CreateEvaluationRequest) =>
    api.post<Evaluation>("/api/quality-gate/evaluations", body),
  updateEvaluation: (id: string, body: UpdateEvaluationRequest) =>
    api.patch<Evaluation>(`/api/quality-gate/evaluations/${id}`, body),
  deleteEvaluation: (id: string) => api.del<void>(`/api/quality-gate/evaluations/${id}`),
  importEvaluation: (body: { name: string; import: ImportEvaluationRequest }) =>
    api.post<Evaluation>("/api/quality-gate/evaluations/import", body),

  listRuns: (q: Partial<ListRunsQuery>) => {
    const usp = new URLSearchParams();
    if (q.status) usp.set("status", q.status);
    if (q.evaluationId) usp.set("evaluationId", q.evaluationId);
    if (q.page !== undefined) usp.set("page", String(q.page));
    if (q.pageSize !== undefined) usp.set("pageSize", String(q.pageSize));
    const qs = usp.toString();
    return api.get<ListRunsResponse>(`/api/quality-gate/runs${qs ? `?${qs}` : ""}`);
  },
  getRun: (id: string) => api.get<EvaluationRun>(`/api/quality-gate/runs/${id}`),
  createRun: (body: CreateRunRequest) => api.post<EvaluationRun>("/api/quality-gate/runs", body),
  cancelRun: (id: string) =>
    api.post<{ ok: true }>(`/api/quality-gate/runs/${id}/cancel`, {}),
  deleteRun: (id: string) => api.del<void>(`/api/quality-gate/runs/${id}`),

  listSamples: (runId: string, q: Partial<ListRunSamplesQuery>) => {
    const usp = new URLSearchParams();
    if (q.filter) usp.set("filter", q.filter);
    if (q.sortBy) usp.set("sortBy", q.sortBy);
    if (q.page !== undefined) usp.set("page", String(q.page));
    if (q.pageSize !== undefined) usp.set("pageSize", String(q.pageSize));
    const qs = usp.toString();
    return api.get<ListRunSamplesResponse>(
      `/api/quality-gate/runs/${runId}/samples${qs ? `?${qs}` : ""}`,
    );
  },
};
