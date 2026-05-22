import type { EngineMetricsSnapshotResponse } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface EngineMetricsRange {
  from: string;
  to: string;
  step?: number;
}

export const engineMetricsKeys = {
  all: ["engine-metrics"] as const,
  snapshot: (connectionId: string, r: EngineMetricsRange) =>
    [...engineMetricsKeys.all, connectionId, r.from, r.to, r.step ?? "auto"] as const,
};

export function useEngineMetrics(
  connectionId: string | null | undefined,
  range: EngineMetricsRange,
) {
  return useQuery({
    queryKey: engineMetricsKeys.snapshot(connectionId ?? "", range),
    enabled: !!connectionId,
    queryFn: async () => {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (range.step != null) params.set("step", String(range.step));
      return api.get<EngineMetricsSnapshotResponse>(
        `/api/engine-metrics/${connectionId}/snapshot?${params.toString()}`,
      );
    },
    staleTime: 30 * 1000,
  });
}
