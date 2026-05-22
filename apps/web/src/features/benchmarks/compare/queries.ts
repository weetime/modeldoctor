import type {
  CompareSynthesizeRequest,
  CompareSynthesizeResponse,
  CreateSavedCompareRequest,
  HydratedSavedCompare,
  ListSavedComparesResponse,
  SavedCompare,
  UpdateSavedCompareRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type { HydratedSavedCompare };

export const savedCompareKeys = {
  all: ["saved-compares"] as const,
  list: () => [...savedCompareKeys.all, "list"] as const,
  detail: (id: string) => [...savedCompareKeys.all, "detail", id] as const,
};

export function useSavedCompares() {
  return useQuery<ListSavedComparesResponse>({
    queryKey: savedCompareKeys.list(),
    queryFn: () => api.get<ListSavedComparesResponse>("/api/saved-compares"),
  });
}

export function useSavedCompare(id: string) {
  return useQuery<HydratedSavedCompare>({
    queryKey: savedCompareKeys.detail(id),
    queryFn: () => api.get<HydratedSavedCompare>(`/api/saved-compares/${id}`),
    enabled: !!id,
  });
}

export function useCreateSavedCompare() {
  const qc = useQueryClient();
  return useMutation<SavedCompare, Error, CreateSavedCompareRequest>({
    mutationFn: (body) => api.post<SavedCompare>("/api/saved-compares", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.list() }),
  });
}

export function useUpdateSavedCompare(id: string) {
  const qc = useQueryClient();
  return useMutation<SavedCompare, Error, UpdateSavedCompareRequest>({
    mutationFn: (body) => api.patch<SavedCompare>(`/api/saved-compares/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: savedCompareKeys.detail(id) });
      qc.invalidateQueries({ queryKey: savedCompareKeys.list() });
    },
  });
}

export function useDeleteSavedCompare() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.del<void>(`/api/saved-compares/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.list() }),
  });
}

export function useSynthesizeSavedCompare(id: string) {
  const qc = useQueryClient();
  return useMutation<CompareSynthesizeResponse, Error, CompareSynthesizeRequest>({
    mutationFn: (body) =>
      api.post<CompareSynthesizeResponse>(`/api/saved-compares/${id}/synthesize`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: savedCompareKeys.detail(id) }),
  });
}
