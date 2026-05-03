import type { CreateRunRequest, ListRunsQuery } from "@modeldoctor/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runApi } from "./api";

export const runKeys = {
  all: ["runs"] as const,
  lists: () => [...runKeys.all, "list"] as const,
  list: (q: Partial<ListRunsQuery>) => [...runKeys.lists(), q] as const,
  details: () => [...runKeys.all, "detail"] as const,
  detail: (id: string) => [...runKeys.details(), id] as const,
};

// `q` MUST NOT carry `cursor` — useInfiniteQuery owns paging via pageParam.
export function useRunList(q: Partial<ListRunsQuery>) {
  return useInfiniteQuery({
    queryKey: runKeys.list(q),
    queryFn: ({ pageParam }) =>
      runApi.list({ ...q, cursor: (pageParam as string | undefined) ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useRunDetail(id: string) {
  return useQuery({
    queryKey: runKeys.detail(id),
    queryFn: () => runApi.get(id),
    enabled: id.length > 0,
  });
}

export function useCreateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRunRequest) => runApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runApi.cancel(id),
    onSuccess: (_run, id) => {
      qc.invalidateQueries({ queryKey: runKeys.detail(id) });
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}

export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => runApi.delete(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: runKeys.detail(id) });
      qc.invalidateQueries({ queryKey: runKeys.lists() });
    },
  });
}
