import { api } from "@/lib/api-client";
import type { AlertEventDto, CreateSubscriberBody, ListAlertsQuery, SubscriberDto } from "./types";

export const alertsApi = {
  list: (q: ListAlertsQuery = {}) => {
    const usp = new URLSearchParams();
    if (q.connectionId) usp.set("connectionId", q.connectionId);
    if (q.status) usp.set("status", q.status);
    if (q.severity) usp.set("severity", q.severity);
    const qs = usp.toString();
    return api.get<AlertEventDto[]>(`/api/alerts${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<AlertEventDto>(`/api/alerts/${id}`),
};

export const subscribersApi = {
  list: (connectionId: string) =>
    api.get<SubscriberDto[]>(`/api/connections/${connectionId}/subscribers`),
  create: (connectionId: string, body: CreateSubscriberBody) =>
    api.post<SubscriberDto>(`/api/connections/${connectionId}/subscribers`, body),
  remove: (connectionId: string, subscriberId: string) =>
    api.del<void>(`/api/connections/${connectionId}/subscribers/${subscriberId}`),
};
