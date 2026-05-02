import { api } from "@/lib/api-client";
import type { Baseline, CreateBaseline, ListBaselinesResponse } from "@modeldoctor/contracts";

export const baselineApi = {
  list: () => api.get<ListBaselinesResponse>("/api/baselines"),
  create: (body: CreateBaseline) => api.post<Baseline>("/api/baselines", body),
  remove: (id: string) => api.del<void>(`/api/baselines/${id}`),
};
