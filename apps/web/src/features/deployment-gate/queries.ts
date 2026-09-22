import type {
  CreatePlatformSource,
  UpdateDiscoveredModel,
  UpdatePlatformSource,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dgApi, type ModelListFilter } from "./api";

const KEY = {
  sources: ["deployment-gate", "sources"] as const,
  routes: (sourceId: string) => ["deployment-gate", "routes", sourceId] as const,
  models: (f?: ModelListFilter) => ["deployment-gate", "models", f ?? {}] as const,
  model: (id: string) => ["deployment-gate", "model", id] as const,
  revisions: (id: string) => ["deployment-gate", "revisions", id] as const,
};

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["deployment-gate"] });
}

export function useSources() {
  return useQuery({ queryKey: KEY.sources, queryFn: dgApi.listSources });
}

export function useCreateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (b: CreatePlatformSource) => dgApi.createSource(b),
    onSuccess: invalidate,
  });
}

export function useUpdateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePlatformSource }) =>
      dgApi.updateSource(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.deleteSource(id), onSuccess: invalidate });
}

export function useTestSource() {
  return useMutation({
    mutationFn: (b: { baseUrl: string; apiKey: string }) => dgApi.testSource(b),
  });
}

export function useSyncSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.syncSource(id), onSuccess: invalidate });
}

export function useRoutes(sourceId: string | undefined) {
  return useQuery({
    queryKey: sourceId ? KEY.routes(sourceId) : ["deployment-gate", "routes", "disabled"],
    queryFn: () => dgApi.listRoutes(sourceId!),
    enabled: !!sourceId,
  });
}

export function useDiscoveredModels(f?: ModelListFilter) {
  return useQuery({
    queryKey: KEY.models(f),
    queryFn: () => dgApi.listModels(f),
    refetchInterval: 15_000,
  });
}

export function useDiscoveredModel(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEY.model(id) : ["deployment-gate", "model", "disabled"],
    queryFn: () => dgApi.getModel(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.lastRun?.status;
      return s === "pending" || s === "running" ? 5000 : false;
    },
  });
}

export function useUpdateDiscoveredModel(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (b: UpdateDiscoveredModel) => dgApi.updateModel(id, b),
    onSuccess: invalidate,
  });
}

export function useRunDiscoveredModel(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => dgApi.runModel(id), onSuccess: invalidate });
}

export function useRevisions(id: string | undefined, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: id ? KEY.revisions(id) : ["deployment-gate", "revisions", "disabled"],
    queryFn: () => dgApi.listRevisions(id!),
    enabled: !!id,
    refetchInterval: opts?.poll ? 5000 : false,
  });
}

export function useCancelAutomationRun() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => dgApi.cancelRun(id), onSuccess: invalidate });
}
