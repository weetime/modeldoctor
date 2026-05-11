import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { formatText } from "./format.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

export async function sendSlack(url: string, body: DeliveryPayload): Promise<void> {
  const text = formatText(body);
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify({ text }),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`slack webhook returned ${res.status}`);
  }
}
