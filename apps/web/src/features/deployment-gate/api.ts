import type {
  AutomationRunPublic,
  CreatePlatformSource,
  DeploymentRevisionPublic,
  DiscoveredModelPublic,
  GpustackRouteOption,
  PlatformSource,
  TestPlatformSourceResponse,
  UpdateDiscoveredModel,
  UpdatePlatformSource,
} from "@modeldoctor/contracts";
import { api } from "@/lib/api-client";

export interface ModelListFilter {
  sourceId?: string;
  status?: string;
  automationEnabled?: boolean;
}

function qs(f: ModelListFilter = {}): string {
  const p = new URLSearchParams();
  if (f.sourceId) p.set("sourceId", f.sourceId);
  if (f.status) p.set("status", f.status);
  if (f.automationEnabled !== undefined) p.set("automationEnabled", String(f.automationEnabled));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const dgApi = {
  listSources: () => api.get<PlatformSource[]>("/api/platform-sources"),
  createSource: (body: CreatePlatformSource) =>
    api.post<PlatformSource>("/api/platform-sources", body),
  updateSource: (id: string, body: UpdatePlatformSource) =>
    api.patch<PlatformSource>(`/api/platform-sources/${id}`, body),
  deleteSource: (id: string) => api.del<void>(`/api/platform-sources/${id}`),
  testSource: (body: { baseUrl: string; apiKey: string }) =>
    api.post<TestPlatformSourceResponse>("/api/platform-sources/test", body),
  testSavedSource: (id: string) =>
    api.post<TestPlatformSourceResponse>(`/api/platform-sources/${id}/test`, {}),
  syncSource: (id: string) => api.post<{ models: number }>(`/api/platform-sources/${id}/sync`, {}),
  listRoutes: (sourceId: string) =>
    api.get<GpustackRouteOption[]>(`/api/platform-sources/${sourceId}/routes`),
  listModels: (f?: ModelListFilter) =>
    api.get<DiscoveredModelPublic[]>(`/api/discovered-models${qs(f)}`),
  getModel: (id: string) => api.get<DiscoveredModelPublic>(`/api/discovered-models/${id}`),
  updateModel: (id: string, body: UpdateDiscoveredModel) =>
    api.patch<DiscoveredModelPublic>(`/api/discovered-models/${id}`, body),
  runModel: (id: string) => api.post<AutomationRunPublic>(`/api/discovered-models/${id}/run`, {}),
  listRevisions: (id: string) =>
    api.get<DeploymentRevisionPublic[]>(`/api/discovered-models/${id}/revisions`),
  cancelRun: (id: string) => api.post<void>(`/api/automation-runs/${id}/cancel`, {}),
};
