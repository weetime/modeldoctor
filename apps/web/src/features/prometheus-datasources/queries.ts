import type {
  CreatePrometheusDatasource,
  DeletePrometheusDatasourceResponse,
  ListPrometheusDatasourcesResponse,
  PrometheusDatasourcePublic,
  PrometheusDatasourceWithSecret,
  UpdatePrometheusDatasource,
  VerifyPrometheusDatasourceRequest,
  VerifyPrometheusDatasourceResponse,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

const KEY = ["prometheus-datasources"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useDatasources() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListPrometheusDatasourcesResponse>("/api/prometheus-datasources"),
    select: (r) => r.items,
  });
}

export function useDatasource(id: string | null | undefined) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<PrometheusDatasourcePublic>(`/api/prometheus-datasources/${id}`),
  });
}

export function useCreateDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePrometheusDatasource) =>
      api.post<PrometheusDatasourceWithSecret>("/api/prometheus-datasources", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useUpdateDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePrometheusDatasource }) =>
      api.patch<PrometheusDatasourceWithSecret | PrometheusDatasourcePublic>(
        `/api/prometheus-datasources/${id}`,
        body,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useDeleteDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<DeletePrometheusDatasourceResponse>(`/api/prometheus-datasources/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useSetDefaultDatasource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<PrometheusDatasourcePublic>(`/api/prometheus-datasources/${id}/set-default`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useVerifyDatasource() {
  return useMutation({
    mutationFn: (body: VerifyPrometheusDatasourceRequest) =>
      api.post<VerifyPrometheusDatasourceResponse>("/api/prometheus-datasources/verify", body),
  });
}
