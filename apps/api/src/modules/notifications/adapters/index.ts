import type { ChannelType } from "@prisma/client";
import { sendDingtalk } from "./dingtalk.adapter.js";
import { sendFeishu } from "./feishu.adapter.js";
import { sendSlack } from "./slack.adapter.js";
import { sendWebhook } from "./webhook.adapter.js";

export interface DeliveryPayload {
  eventType: string;
  payload: Record<string, unknown>;
}

/** Per-call context shared with adapters that build richer (e.g. markdown)
 * messages. `appBaseUrl` lets dingtalk render a "查看详情" link to the
 * web UI; adapters that don't need it ignore the field. */
export interface DispatchOptions {
  appBaseUrl?: string;
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
  opts: DispatchOptions = {},
): Promise<void> {
  if (type === "slack") return sendSlack(url, body);
  if (type === "webhook") return sendWebhook(url, body);
  if (type === "feishu") return sendFeishu(url, body);
  if (type === "dingtalk") return sendDingtalk(url, body, opts);
  const _exhaustive: never = type;
  throw new Error(`Unsupported channel type: ${String(_exhaustive)}`);
}
