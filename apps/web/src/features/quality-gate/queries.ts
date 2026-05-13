import type { CreateRunRequest } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qgApi } from "./api";

const KEY = {
  evaluations: ["quality-gate", "evaluations"] as const,
  evaluation: (id: string) => ["quality-gate", "evaluations", id] as const,
  runs: (filter: object) => ["quality-gate", "runs", filter] as const,
  run: (id: string) => ["quality-gate", "runs", id] as const,
  samples: (runId: string, filter: object) =>
    ["quality-gate", "runs", runId, "samples", filter] as const,
};

// ── Evaluations ──────────────────────────────────────────────────────────────

export function useEvaluations() {
  return useQuery({
    queryKey: KEY.evaluations,
    queryFn: () => qgApi.listEvaluations().then((r) => r.items),
  });
}

export function useEvaluation(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEY.evaluation(id) : ["quality-gate", "evaluations", "disabled"],
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => qgApi.getEvaluation(id!),
    enabled: !!id,
  });
}

export function useCreateEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.createEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}

export function useUpdateEvaluation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof qgApi.updateEvaluation>[1]) =>
      qgApi.updateEvaluation(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.evaluations });
      qc.invalidateQueries({ queryKey: KEY.evaluation(id) });
    },
  });
}

export function useDeleteEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.deleteEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}

export function useImportEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qgApi.importEvaluation,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.evaluations }),
  });
}

export function useSetBaseline(evaluationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string | null) =>
      qgApi.updateEvaluation(evaluationId, { baselineRunId: runId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY.evaluation(evaluationId) });
      qc.invalidateQueries({ queryKey: KEY.evaluations });
    },
  });
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function useRuns(filter: Partial<Parameters<typeof qgApi.listRuns>[0]> = {}) {
  return useQuery({
    queryKey: KEY.runs(filter),
    queryFn: () => qgApi.listRuns(filter),
  });
}

export function useRun(id: string | undefined, opts?: { pollWhileRunning?: boolean }) {
  return useQuery({
    queryKey: id ? KEY.run(id) : ["quality-gate", "runs", "disabled"],
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => qgApi.getRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      if (!opts?.pollWhileRunning) return false;
      const status = query.state.data?.status;
      return status === "PENDING" || status === "RUNNING" ? 2000 : false;
    },
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRunRequest) => qgApi.createRun(body),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ["quality-gate", "runs"] });
      qc.setQueryData(KEY.run(run.id), run);
    },
  });
}

export function useCancelRun(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => qgApi.cancelRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.run(id) }),
  });
}

export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => qgApi.deleteRun(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality-gate", "runs"] }),
  });
}

// ── Run Samples ───────────────────────────────────────────────────────────────

export function useRunSamples(
  runId: string | undefined,
  filter: Partial<Parameters<typeof qgApi.listSamples>[1]> = {},
) {
  return useQuery({
    queryKey: runId ? KEY.samples(runId, filter) : ["quality-gate", "samples", "disabled", filter],
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => qgApi.listSamples(runId!, filter),
    enabled: !!runId,
  });
}
