import type { ListBenchmarksQuery } from "@modeldoctor/contracts";

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarksQuery>) =>
    [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
};

export const TERMINAL_STATES = ["completed", "failed", "canceled"] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { benchmarkApi } from "./api";
import type {
  CreateBenchmarkRequest,
  ListBenchmarksQuery as LBQ,
} from "@modeldoctor/contracts";

export function useBenchmarkList(q: Partial<LBQ>) {
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
    onSuccess: (_: void, id: string) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
      qc.removeQueries({ queryKey: benchmarkKeys.detail(id) });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
