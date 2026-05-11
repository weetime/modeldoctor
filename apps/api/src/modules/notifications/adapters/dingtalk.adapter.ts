import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { formatText } from "./format.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

/**
 * 钉钉 custom robot. Payload shape:
 *   { msgtype: "text", text: { content: "<message>" } }
 *
 * Same security model as Feishu: the bot must be configured with at least
 * one of: 自定义关键词 / IP 白名单 / 加签. We always prefix the message
 * with `[ModelDoctor]` so users can set that as the keyword. HMAC signing
 * (加签) requires a per-channel secret and is deferred to V2.
 *
 * DingTalk also returns HTTP 200 on logical errors with `{ errcode: <non-zero>, errmsg: ... }`.
 */
export async function sendDingtalk(url: string, body: DeliveryPayload): Promise<void> {
  const text = formatText(body);
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify({ msgtype: "text", text: { content: text } }),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`dingtalk webhook returned ${res.status}`);
  }
  const raw = await res.text();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as { errcode?: number; errmsg?: string };
    if (typeof parsed.errcode === "number" && parsed.errcode !== 0) {
      throw new NotificationDeliveryError(
        `dingtalk webhook errcode=${parsed.errcode} errmsg=${parsed.errmsg ?? ""}`,
      );
    }
  } catch (e) {
    if (e instanceof NotificationDeliveryError) throw e;
    // Non-JSON body treated as success.
  }
}
