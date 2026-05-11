import { safeFetch } from "../../connection/discovery/safe-fetch.js";
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

function formatText(body: DeliveryPayload): string {
  const tag = `[ModelDoctor] ${body.eventType}`;
  const p = body.payload as Record<string, unknown>;
  const name =
    typeof p.name === "string" ? p.name : ((p.runId as string | undefined) ?? "(unknown)");
  const status = typeof p.status === "string" ? ` status=${p.status}` : "";
  const conn = typeof p.connectionId === "string" ? ` connection=${p.connectionId}` : "";
  return `${tag} ${name}${status}${conn}`;
}
