import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alertsApi, subscribersApi } from "./api";
import type { CreateSubscriberBody, ListAlertsQuery } from "./types";

const KEY = {
  list: (q: ListAlertsQuery) => ["alerts", "list", q] as const,
  one: (id: string) => ["alerts", "one", id] as const,
  subscribers: (connectionId: string) => ["alerts", "subscribers", connectionId] as const,
};

export function useAlerts(q: ListAlertsQuery = {}) {
  return useQuery({
    queryKey: KEY.list(q),
    queryFn: () => alertsApi.list(q),
    refetchInterval: 30_000, // alerts arrive via webhook — poll for UI freshness
  });
}

export function useAlert(id: string | undefined) {
  return useQuery({
    queryKey: id ? KEY.one(id) : ["alerts", "one", "disabled"],
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => alertsApi.get(id!),
    enabled: !!id,
  });
}

export function useSubscribers(connectionId: string | undefined) {
  return useQuery({
    queryKey: connectionId ? KEY.subscribers(connectionId) : ["alerts", "subscribers", "disabled"],
    // biome-ignore lint/style/noNonNullAssertion: enabled gates this
    queryFn: () => subscribersApi.list(connectionId!),
    enabled: !!connectionId,
  });
}

export function useCreateSubscriber(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriberBody) => subscribersApi.create(connectionId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.subscribers(connectionId) }),
  });
}

export function useDeleteSubscriber(connectionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subscriberId: string) => subscribersApi.remove(connectionId, subscriberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY.subscribers(connectionId) }),
  });
}
