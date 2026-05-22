import type {
  LlmJudgeProviderPublic,
  TestLlmJudgeRequest,
  TestLlmJudgeResponse,
  UpsertLlmJudgeProvider,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

const KEY = ["llm-judge-provider"] as const;

export function useLlmJudgeProvider() {
  return useQuery<LlmJudgeProviderPublic | null>({
    queryKey: KEY,
    queryFn: () => api.get<LlmJudgeProviderPublic | null>("/api/llm-judge/provider"),
    staleTime: 0,
  });
}

export function useUpsertLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertLlmJudgeProvider) =>
      api.put<LlmJudgeProviderPublic>("/api/llm-judge/provider", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>("/api/llm-judge/provider"),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestLlmJudge() {
  return useMutation({
    mutationFn: (body: TestLlmJudgeRequest) =>
      api.post<TestLlmJudgeResponse>("/api/llm-judge/test", body),
  });
}
