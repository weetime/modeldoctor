import type { ListRunsQuery } from "@modeldoctor/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
