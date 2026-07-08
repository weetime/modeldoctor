import type {
  CreateSkill,
  ListSkillsResponse,
  SkillPublic,
  UpdateSkill,
} from "@modeldoctor/contracts";
import { api } from "@/lib/api-client";

export const skillApi = {
  list: () => api.get<ListSkillsResponse>("/api/skills"),
  get: (id: string) => api.get<SkillPublic>(`/api/skills/${id}`),
  create: (body: CreateSkill) => api.post<SkillPublic>("/api/skills", body),
  update: (id: string, body: UpdateSkill) => api.patch<SkillPublic>(`/api/skills/${id}`, body),
  delete: (id: string) => api.del<void>(`/api/skills/${id}`),
};
