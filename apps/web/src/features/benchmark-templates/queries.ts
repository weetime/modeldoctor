import type {
  BenchmarkTemplate,
  CreateBenchmarkTemplateRequest,
  ListBenchmarkTemplatesQuery,
  ListBenchmarkTemplatesResponse,
  UpdateBenchmarkTemplateRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { benchmarkTemplateApi } from "./api";

export const benchmarkTemplateKeys = {
  all: ["benchmark-templates"] as const,
  lists: () => [...benchmarkTemplateKeys.all, "list"] as const,
  list: (q: Partial<ListBenchmarkTemplatesQuery>) => [...benchmarkTemplateKeys.lists(), q] as const,
  details: () => [...benchmarkTemplateKeys.all, "detail"] as const,
  detail: (id: string) => [...benchmarkTemplateKeys.details(), id] as const,
};

export function useTemplates(q: Partial<ListBenchmarkTemplatesQuery> = {}) {
  return useQuery<ListBenchmarkTemplatesResponse>({
    queryKey: benchmarkTemplateKeys.list(q),
    queryFn: () => benchmarkTemplateApi.list(q),
  });
}

export function useTemplate(id: string | undefined) {
  return useQuery<BenchmarkTemplate>({
    queryKey: benchmarkTemplateKeys.detail(id ?? ""),
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => benchmarkTemplateApi.get(id!),
    enabled: Boolean(id),
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBenchmarkTemplateRequest) => benchmarkTemplateApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: benchmarkTemplateKeys.all }),
  });
}

export function useUpdateTemplate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<UpdateBenchmarkTemplateRequest>) =>
      benchmarkTemplateApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: benchmarkTemplateKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkTemplateKeys.lists() });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => benchmarkTemplateApi.delete(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: benchmarkTemplateKeys.detail(id) });
      qc.invalidateQueries({ queryKey: benchmarkTemplateKeys.lists() });
    },
  });
}
