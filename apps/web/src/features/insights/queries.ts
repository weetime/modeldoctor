import { api } from "@/lib/api-client";
import type {
  ListEvaluationProfilesResponse,
  SynthesizeRequest,
  SynthesizeResponse,
} from "@modeldoctor/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";

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

export function useSynthesize(connectionId: string) {
  return useMutation<SynthesizeResponse, Error, SynthesizeRequest>({
    mutationFn: (body) =>
      api.post<SynthesizeResponse>(`/api/insights/${connectionId}/synthesize`, body),
  });
}
