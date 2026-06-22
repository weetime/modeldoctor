import type {
  CreateLlmJudgeProvider,
  ListLlmJudgeProvidersResponse,
  LlmJudgeProviderPublic,
  TestLlmJudgeRequest,
  TestLlmJudgeResponse,
  UpdateLlmJudgeProvider,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

const KEY = ["llm-judge-providers"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useLlmJudgeProviders() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListLlmJudgeProvidersResponse>("/api/llm-judge/providers"),
    select: (r) => r.items,
  });
}

/**
 * The effective default provider (or null when none is set). Used to gate
 * AI-assisted features (insights, compare narrative). Shares the list cache —
 * the default is always enabled, so a non-null result means AI is available.
 */
export function useLlmJudgeProvider() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListLlmJudgeProvidersResponse>("/api/llm-judge/providers"),
    select: (r): LlmJudgeProviderPublic | null => r.items.find((p) => p.isDefault) ?? null,
    staleTime: 0,
  });
}

export function useCreateLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLlmJudgeProvider) =>
      api.post<LlmJudgeProviderPublic>("/api/llm-judge/providers", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLlmJudgeProvider }) =>
      api.patch<LlmJudgeProviderPublic>(`/api/llm-judge/providers/${id}`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useDeleteLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/llm-judge/providers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetDefaultLlmJudgeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<LlmJudgeProviderPublic>(`/api/llm-judge/providers/${id}/set-default`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestLlmJudge() {
  return useMutation({
    mutationFn: (body: TestLlmJudgeRequest) =>
      api.post<TestLlmJudgeResponse>("/api/llm-judge/test", body),
  });
}
