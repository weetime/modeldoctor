import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

export async function sendWebhook(url: string, body: DeliveryPayload): Promise<void> {
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`webhook returned ${res.status}`);
  }
}
