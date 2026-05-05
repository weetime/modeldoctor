import type { Baseline, CreateBaseline, ListBaselinesResponse } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { baselineApi } from "./api";

export const baselineKeys = {
  all: ["baselines"] as const,
  lists: () => [...baselineKeys.all, "list"] as const,
};

export function useBaselines() {
  return useQuery<ListBaselinesResponse>({
    queryKey: baselineKeys.lists(),
    queryFn: () => baselineApi.list(),
    staleTime: 30_000,
  });
}

export function useCreateBaseline() {
  const qc = useQueryClient();
  return useMutation<Baseline, Error, CreateBaseline>({
    mutationFn: (body) => baselineApi.create(body),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: baselineKeys.all });
      // The Benchmark that just became a baseline now has baselineFor set;
      // refetch its detail entry.
      qc.invalidateQueries({ queryKey: ["benchmarks", "detail", created.benchmarkId] });
      qc.invalidateQueries({ queryKey: ["benchmarks", "list"] });
    },
  });
}

export function useDeleteBaseline() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => baselineApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baselineKeys.all });
      qc.invalidateQueries({ queryKey: ["benchmarks", "detail"] });
      qc.invalidateQueries({ queryKey: ["benchmarks", "list"] });
    },
  });
}

/**
 * Selects one baseline from the cached list by id. Avoids adding a
 * `GET /api/baselines/:id` endpoint since the full list is already
 * fetched on demand and cached for 30s.
 */
export function useBaselineById(id: string | null | undefined) {
  return useQuery({
    queryKey: baselineKeys.lists(),
    queryFn: () => baselineApi.list(),
    staleTime: 30_000,
    select: (resp: ListBaselinesResponse): Baseline | undefined =>
      id ? resp.items.find((b) => b.id === id) : undefined,
    enabled: !!id,
  });
}
