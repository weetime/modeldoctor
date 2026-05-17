import { useQuery } from "@tanstack/react-query";
import { alertsApi } from "./api";
import type { ListAlertsQuery } from "./types";

const KEY = {
  list: (q: ListAlertsQuery) => ["alerts", "list", q] as const,
  one: (id: string) => ["alerts", "one", id] as const,
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
