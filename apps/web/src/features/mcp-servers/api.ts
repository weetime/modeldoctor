import type {
  CreateMcpServer,
  ListMcpServersResponse,
  McpServerPublic,
  McpServerWithSecret,
  UpdateMcpServer,
} from "@modeldoctor/contracts";
import { api } from "@/lib/api-client";

export const mcpServerApi = {
  list: () => api.get<ListMcpServersResponse>("/api/mcp-servers"),
  get: (id: string) => api.get<McpServerPublic>(`/api/mcp-servers/${id}`),
  create: (body: CreateMcpServer) => api.post<McpServerWithSecret>("/api/mcp-servers", body),
  update: (id: string, body: UpdateMcpServer) =>
    api.patch<McpServerWithSecret | McpServerPublic>(`/api/mcp-servers/${id}`, body),
  delete: (id: string) => api.del<void>(`/api/mcp-servers/${id}`),
  /** Live `tools/list` round-trip against the server; caches + returns the updated row (Task 11). */
  discover: (id: string) => api.post<McpServerPublic>(`/api/mcp-servers/${id}/discover`, undefined),
};
