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
      // The Run that just became a baseline now has baselineFor set; refetch.
      qc.invalidateQueries({ queryKey: ["runs", "detail", created.runId] });
      qc.invalidateQueries({ queryKey: ["runs", "list"] });
    },
  });
}

export function useDeleteBaseline() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => baselineApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: baselineKeys.all });
      qc.invalidateQueries({ queryKey: ["runs", "detail"] });
      qc.invalidateQueries({ queryKey: ["runs", "list"] });
    },
  });
}
