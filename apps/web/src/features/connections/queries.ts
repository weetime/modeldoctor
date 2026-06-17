import type {
  ConnectionHealthResponse,
  ConnectionPublic,
  ConnectionRevealKeyResponse,
  ConnectionStatusFilter,
  ConnectionWithSecret,
  CreateConnection,
  DiscoverConnectionRequest,
  DiscoverConnectionResponse,
  ListConnectionsResponse,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

const KEY = ["connections"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useConnections(params?: { status?: ConnectionStatusFilter }) {
  const status = params?.status ?? "enabled";
  return useQuery({
    queryKey: [...KEY, { status }] as const,
    queryFn: () => api.get<ListConnectionsResponse>(`/api/connections?status=${status}`),
    select: (r) => r.items,
  });
}

/** Archive (disable) or restore (enable) a connection via PATCH. */
export function useSetConnectionEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<ConnectionPublic>(`/api/connections/${id}`, { enabled }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

/** On-demand health probe. An action, not cached. */
export function useTestConnection() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ConnectionHealthResponse>(`/api/connections/${id}/health`, {}),
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

export function useRevealApiKey(id: string | null | undefined) {
  return useQuery({
    queryKey: [...detailKey(id ?? ""), "reveal-key"] as const,
    enabled: !!id,
    queryFn: () => api.get<ConnectionRevealKeyResponse>(`/api/connections/${id}/reveal-key`),
    // apiKey doesn't change unless the user rotates it — cache aggressively.
    staleTime: 5 * 60 * 1000,
  });
}

export function useDiscoverConnection() {
  return useMutation({
    mutationFn: (input: DiscoverConnectionRequest) =>
      api.post<DiscoverConnectionResponse>("/api/connections/discover", input),
  });
}
