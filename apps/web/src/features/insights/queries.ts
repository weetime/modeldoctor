import { api } from "@/lib/api-client";
import type { ListEvaluationProfilesResponse } from "@modeldoctor/contracts";
import { useQuery } from "@tanstack/react-query";

export function useEvaluationProfiles() {
  return useQuery<ListEvaluationProfilesResponse>({
    queryKey: ["evaluation-profiles"],
    queryFn: () => api.get<ListEvaluationProfilesResponse>("/api/insights/profiles"),
    staleTime: 1000 * 60 * 60, // profiles rarely change
  });
}

export function defaultProfileSlug(): string {
  return "default";
}
