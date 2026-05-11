export type ChannelType = "slack" | "webhook" | "feishu" | "dingtalk";
export type NotificationEventType =
  | "benchmark.completed"
  | "benchmark.failed"
  | "diagnostics.failed";

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  urlMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  channelId: string;
  channelName: string;
  eventType: NotificationEventType;
  connectionId?: string;
  createdAt: string;
}

export interface CreateChannelRequest {
  type: ChannelType;
  name: string;
  url: string;
}

export interface UpdateChannelRequest {
  name?: string;
  url?: string;
}

export interface CreateSubscriptionRequest {
  channelId: string;
  eventType: NotificationEventType;
  connectionId?: string;
}

export interface TestChannelResponse {
  ok: boolean;
  error?: string;
}
