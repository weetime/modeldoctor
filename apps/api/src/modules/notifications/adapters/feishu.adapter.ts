import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { formatText } from "./format.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

/**
 * 飞书 (Lark) custom robot. Payload shape:
 *   { msg_type: "text", content: { text: "<message>" } }
 *
 * The bot must be configured with at least one of: 自定义关键字 / IP 白名单 /
 * 签名校验. We always prefix the message with `[ModelDoctor]` so users can
 * set that as the keyword (the simplest security mode). HMAC signing
 * (加签) requires a per-channel secret and is deferred to V2.
 *
 * Feishu returns HTTP 200 even on logical errors (e.g. invalid token) and
 * encodes the failure in the JSON response body as `{ code: <non-zero>, msg: ... }`.
 * We check both the HTTP status and the body's `code` field.
 */
export async function sendFeishu(url: string, body: DeliveryPayload): Promise<void> {
  const text = formatText(body);
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify({ msg_type: "text", content: { text } }),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`feishu webhook returned ${res.status}`);
  }
  const raw = await res.text();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { code?: number; msg?: string };
    if (typeof parsed.code === "number" && parsed.code !== 0) {
      throw new NotificationDeliveryError(
        `feishu webhook error code=${parsed.code} msg=${parsed.msg ?? ""}`,
      );
    }
  } catch (e) {
    if (e instanceof NotificationDeliveryError) throw e;
    // Non-JSON body is treated as success — Feishu sometimes returns plain "ok".
  }
}
