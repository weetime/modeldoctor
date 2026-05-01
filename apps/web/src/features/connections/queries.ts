import { api } from "@/lib/api-client";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  CreateConnection,
  ListConnectionsResponse,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const KEY = ["connections"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useConnections() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<ListConnectionsResponse>("/api/connections"),
    select: (r) => r.items,
  });
}

export function useConnection(id: string | null | undefined) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<ConnectionPublic>(`/api/connections/${id}`),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConnection) =>
      api.post<ConnectionWithSecret>("/api/connections", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConnection }) =>
      api.patch<ConnectionWithSecret | ConnectionPublic>(`/api/connections/${id}`, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
