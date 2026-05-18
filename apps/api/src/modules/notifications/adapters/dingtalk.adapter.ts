import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { formatDingtalkAlertMarkdown, formatText } from "./format.js";
import { type DeliveryPayload, type DispatchOptions, NotificationDeliveryError } from "./index.js";

/**
 * 钉钉 custom robot. Two payload shapes depending on the event:
 *
 *   text     — `{ msgtype: "text", text: { content: "<plain>" } }`
 *              Used for short events (test, benchmark.*, diagnostics.*).
 *
 *   markdown — `{ msgtype: "markdown", markdown: { title, text } }`
 *              Used for `alert.explained` because the payload carries an
 *              AI narrative + recommendations that benefit from sectioning.
 *              DingTalk markdown supports headings / bold / lists / links /
 *              inline images, but NOT tables or fenced code blocks.
 *
 * Same security model as Feishu: the bot must be configured with at least
 * one of 自定义关键词 / IP 白名单 / 加签. We prefix every message with
 * `[ModelDoctor]` so users can set that as the keyword. HMAC signing
 * (加签) requires a per-channel secret and is deferred to V2.
 *
 * DingTalk returns HTTP 200 on logical errors with `{ errcode: <non-zero>,
 * errmsg: ... }` — we treat any non-zero errcode as a delivery failure.
 */
export async function sendDingtalk(
  url: string,
  body: DeliveryPayload,
  opts: DispatchOptions = {},
): Promise<void> {
  const reqBody =
    body.eventType === "alert.explained"
      ? {
          msgtype: "markdown",
          markdown: formatDingtalkAlertMarkdown(body, { appBaseUrl: opts.appBaseUrl }),
        }
      : { msgtype: "text", text: { content: formatText(body) } };

  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify(reqBody),
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
