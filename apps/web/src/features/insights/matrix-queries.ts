import type { InsightsMatrixResponse, MatrixAggregate, EndpointReportRange } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
export function useInsightsMatrix(p: { aggregate: MatrixAggregate; range: EndpointReportRange; profile: string | null }) {
  const qs = new URLSearchParams({ aggregate: p.aggregate, range: p.range });
  if (p.profile) qs.set("profile", p.profile);
  return useQuery<InsightsMatrixResponse>({
    queryKey: ["insights-matrix", p.aggregate, p.range, p.profile],
    queryFn: () => api.get<InsightsMatrixResponse>(`/api/insights/matrix?${qs.toString()}`),
  });
}
