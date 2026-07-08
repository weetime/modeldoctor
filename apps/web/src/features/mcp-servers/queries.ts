import type { CreateMcpServer, UpdateMcpServer } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mcpServerApi } from "./api";

const KEY = ["mcp-servers"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useMcpServers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => mcpServerApi.list(),
    select: (r) => r.items,
  });
}

export function useMcpServer(id: string | null | undefined) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    enabled: !!id,
    // biome-ignore lint/style/noNonNullAssertion: `enabled` gates this to a defined id
    queryFn: () => mcpServerApi.get(id!),
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMcpServer) => mcpServerApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMcpServer }) =>
      mcpServerApi.update(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mcpServerApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Live `tools/list` discovery round-trip (Task 11) — refreshes `toolsCache`. */
export function useDiscoverMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mcpServerApi.discover(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(data.id) });
    },
  });
}
