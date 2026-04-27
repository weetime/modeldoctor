import type {
  BenchmarkRun,
  CreateBenchmarkRequest,
  ListBenchmarksQuery,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { benchmarkApi } from "./api";

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarksQuery>) => [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
};

export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

// Hooks added in Task 2 (list) and Task 5 (detail).

export function useBenchmarkDetail(id: string) {
  return useQuery({
    queryKey: benchmarkKeys.detail(id),
    queryFn: () => benchmarkApi.get(id),
    enabled: id.length > 0,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const data = query.state.data as BenchmarkRun | undefined;
      if (!data) return 2000;
      if ((TERMINAL_STATES as readonly string[]).includes(data.state)) {
        return false;
      }
      return 2000;
    },
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      const status = (error as { status?: number } | null)?.status;
      if (status !== undefined && status < 500) return false;
      return failureCount < 3;
    },
    retryDelay: (failureCount) => Math.min(5000 * failureCount, 30_000),
  });
}

export function useBenchmarkList(q: Partial<ListBenchmarksQuery>) {
  return useQuery({
    queryKey: benchmarkKeys.list(q),
    queryFn: () => benchmarkApi.list(q),
  });
}

export function useCreateBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBenchmarkRequest) => benchmarkApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCancelBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.cancel(id),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
      qc.invalidateQueries({ queryKey: benchmarkKeys.detail(run.id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.delete(id),
    onSuccess: (_data, id: string) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
      qc.removeQueries({ queryKey: benchmarkKeys.detail(id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
