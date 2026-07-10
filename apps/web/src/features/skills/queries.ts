import type { CreateSkill, UpdateSkill } from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { skillApi } from "./api";

const KEY = ["skills"] as const;
const detailKey = (id: string) => [...KEY, id] as const;

export function useSkills() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => skillApi.list(),
    select: (r) => r.items,
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: detailKey(id ?? ""),
    enabled: !!id,
    // biome-ignore lint/style/noNonNullAssertion: `enabled` gates this to a defined id
    queryFn: () => skillApi.get(id!),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkill) => skillApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSkill }) => skillApi.update(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: detailKey(vars.id) });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
