import type { ListRunsQuery } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";
import { historyApi } from "./api";

export const historyKeys = {
  all: ["history"] as const,
  lists: () => [...historyKeys.all, "list"] as const,
  list: (q: Partial<ListRunsQuery>) => [...historyKeys.lists(), q] as const,
  details: () => [...historyKeys.all, "detail"] as const,
  detail: (id: string) => [...historyKeys.details(), id] as const,
};

export function useRunsList(q: Partial<ListRunsQuery>) {
  return useQuery({
    queryKey: historyKeys.list(q),
    queryFn: () => historyApi.list(q),
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
