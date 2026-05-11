import type { DeliveryPayload } from "./index.js";

/**
 * One-line summary used as the message body by all simple-text adapters
 * (Slack / Feishu / DingTalk). Starts with `[ModelDoctor]` so users can
 * configure that as the security keyword on bot webhooks that require it
 * (Feishu 自定义关键字 / DingTalk 自定义关键词).
 *
 * Shape: `[ModelDoctor] <eventType> <name> [status=<s>] [connection=<id>]`
 */
export function formatText(body: DeliveryPayload): string {
  const tag = `[ModelDoctor] ${body.eventType}`;
  const p = body.payload as Record<string, unknown>;
  const name =
    typeof p.name === "string" ? p.name : ((p.runId as string | undefined) ?? "(unknown)");
  const status = typeof p.status === "string" ? ` status=${p.status}` : "";
  const conn = typeof p.connectionId === "string" ? ` connection=${p.connectionId}` : "";
  return `${tag} ${name}${status}${conn}`;
}
