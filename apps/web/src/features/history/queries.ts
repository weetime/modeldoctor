import type { ListRunsQuery } from "@modeldoctor/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { historyApi } from "./api";

export const historyKeys = {
  all: ["history"] as const,
  lists: () => [...historyKeys.all, "list"] as const,
  list: (q: Partial<ListRunsQuery>) => [...historyKeys.lists(), q] as const,
  details: () => [...historyKeys.all, "detail"] as const,
  detail: (id: string) => [...historyKeys.details(), id] as const,
};

// `q` MUST NOT carry `cursor` — useInfiniteQuery owns paging via pageParam.
export function useRunsInfiniteList(q: Partial<ListRunsQuery>) {
  return useInfiniteQuery({
    queryKey: historyKeys.list(q),
    queryFn: ({ pageParam }) =>
      historyApi.list({ ...q, cursor: (pageParam as string | undefined) ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useRunDetail(id: string) {
  return useQuery({
    queryKey: historyKeys.detail(id),
    queryFn: () => historyApi.get(id),
    enabled: id.length > 0,
  });
}
