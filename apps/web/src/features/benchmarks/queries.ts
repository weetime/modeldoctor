import type {
  Benchmark,
  CreateBenchmarkRequest,
  EndpointReportRange,
  EndpointReportsResponse,
  ListBenchmarksQuery,
} from "@modeldoctor/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { benchmarkApi } from "./api";

/**
 * Polling cadence for non-terminal benchmarks. Backend already pushes `status`
 * updates to DB via the callback v2 channel (#53), so 2 s is enough latency
 * for the user to see "running → completed" without spamming requests.
 */
const POLL_INTERVAL_MS = 2_000;

export function isTerminalStatus(status: Benchmark["status"] | undefined): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

export const benchmarkKeys = {
  all: ["benchmarks"] as const,
  lists: () => [...benchmarkKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarksQuery>) => [...benchmarkKeys.lists(), q] as const,
  details: () => [...benchmarkKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkKeys.details(), id] as const,
  charts: (id: string) => [...benchmarkKeys.detail(id), "charts"] as const,
};

// `q` MUST NOT carry `cursor` — useInfiniteQuery owns paging via pageParam.
export function useBenchmarkList(q: Partial<ListBenchmarksQuery>) {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.list(q),
    queryFn: ({ pageParam }) =>
      benchmarkApi.list({ ...q, cursor: (pageParam as string | undefined) ?? undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}

export function useBenchmarkDetail(id: string) {
  return useQuery({
    queryKey: benchmarkKeys.detail(id),
    queryFn: () => benchmarkApi.get(id),
    enabled: id.length > 0,
    refetchInterval: (query) =>
      isTerminalStatus(query.state.data?.status) ? false : POLL_INTERVAL_MS,
  });
}

export function useCreateBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBenchmarkRequest) => benchmarkApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
  });
}

export function useCancelBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.cancel(id),
    onSuccess: (_b, id) => {
      qc.invalidateQueries({ queryKey: benchmarkKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
  });
}

export function useDeleteBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkApi.delete(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: benchmarkKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
  });
}

export function useBulkDeleteBenchmarks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => benchmarkApi.bulkDelete(ids),
    onSuccess: (_v, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: benchmarkKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkKeys.lists() });
    },
  });
}

export function useBenchmarkCharts(benchmarkId: string) {
  return useQuery({
    queryKey: benchmarkKeys.charts(benchmarkId),
    queryFn: () => benchmarkApi.getCharts(benchmarkId),
    enabled: benchmarkId.length > 0,
    // Charts are derived from a terminal Benchmark's rawOutput, which never
    // changes once the run finishes. Cache for the page's lifetime.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
  });
}

const reportsKey = (range: EndpointReportRange) =>
  [...benchmarkKeys.all, "reports", "by-connection", range] as const;

export function useEndpointReports(range: EndpointReportRange = "30d") {
  return useQuery({
    queryKey: reportsKey(range),
    queryFn: () =>
      api.get<EndpointReportsResponse>(`/api/benchmarks/reports/by-connection?range=${range}`),
    // Reports are aggregations of historical data; refetching often is
    // expensive (5000-row scan). 60s stale window keeps the page feeling
    // live without pounding the API.
    staleTime: 60_000,
  });
}
