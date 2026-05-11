import type { ChannelType } from "@prisma/client";
import { sendSlack } from "./slack.adapter.js";
import { sendWebhook } from "./webhook.adapter.js";

export interface DeliveryPayload {
  eventType: string;
  payload: Record<string, unknown>;
}

export class NotificationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

export async function dispatchToChannel(
  type: ChannelType,
  url: string,
  body: DeliveryPayload,
): Promise<void> {
  if (type === "slack") return sendSlack(url, body);
  if (type === "webhook") return sendWebhook(url, body);
  const _exhaustive: never = type;
  throw new Error(`Unsupported channel type: ${String(_exhaustive)}`);
}
