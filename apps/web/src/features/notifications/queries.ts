import { api } from "@/lib/api-client";
import type {
  Channel,
  CreateChannelRequest,
  CreateSubscriptionRequest,
  Subscription,
  TestChannelResponse,
  UpdateChannelRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const channelsKey = ["notifications", "channels"] as const;
const subscriptionsKey = ["notifications", "subscriptions"] as const;

export function useChannels() {
  return useQuery({
    queryKey: channelsKey,
    queryFn: () => api.get<Channel[]>("/notifications/channels"),
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelRequest) => api.post<Channel>("/notifications/channels", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChannelRequest }) =>
      api.patch<Channel>(`/notifications/channels/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/notifications/channels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelsKey });
      qc.invalidateQueries({ queryKey: subscriptionsKey });
    },
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<TestChannelResponse>(`/notifications/channels/${id}/test`, {}),
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionsKey,
    queryFn: () => api.get<Subscription[]>("/notifications/subscriptions"),
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriptionRequest) =>
      api.post<Subscription>("/notifications/subscriptions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: subscriptionsKey }),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/notifications/subscriptions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: subscriptionsKey }),
  });
}
