import type { DeliveryPayload } from "./index.js";

/**
 * One-line summary used as the message body by simple-text adapters
 * (Slack / Feishu / DingTalk). Starts with `[ModelDoctor]` so users can
 * configure that as the security keyword on bot webhooks that require it
 * (Feishu 自定义关键字 / DingTalk 自定义关键词).
 *
 * Per-eventType shape:
 *   test                — `[ModelDoctor] test: <message>`
 *   alert.explained     — `[ModelDoctor] alert <alertName> severity=<sev> connection=<name|id>`
 *   benchmark.*         — `[ModelDoctor] <eventType> <name|runId> [status=<s>] [connection=<id>]`
 *   diagnostics.failed  — same fallback as benchmark.*
 *
 * The fallback for unknown eventTypes mirrors the benchmark shape (name +
 * status + connection), since most workflow events follow that pattern.
 */
export function formatText(body: DeliveryPayload): string {
  const p = body.payload as Record<string, unknown>;
  const ev = body.eventType;

  if (ev === "test") {
    const message = typeof p.message === "string" ? p.message : "(no message)";
    return `[ModelDoctor] test: ${message}`;
  }

  if (ev === "alert.explained") {
    const alertName = typeof p.alertName === "string" ? p.alertName : "(unknown alert)";
    const severity = typeof p.severity === "string" ? p.severity : "unknown";
    // Prefer the human connection name; cuid fallback so we never drop
    // the identifier entirely.
    const conn =
      typeof p.connectionName === "string" && p.connectionName.length > 0
        ? p.connectionName
        : typeof p.connectionId === "string"
          ? p.connectionId
          : null;
    const tail = conn ? ` connection=${conn}` : "";
    return `[ModelDoctor] alert ${alertName} severity=${severity}${tail}`;
  }

  // Benchmark-style fallback (unchanged from the original shape): name (or
  // runId), optional status, optional connection id. Same for
  // benchmark.completed / benchmark.failed / diagnostics.failed.
  const name =
    typeof p.name === "string" ? p.name : ((p.runId as string | undefined) ?? "(unknown)");
  const status = typeof p.status === "string" ? ` status=${p.status}` : "";
  const connId = typeof p.connectionId === "string" ? ` connection=${p.connectionId}` : "";
  return `[ModelDoctor] ${ev} ${name}${status}${connId}`;
}
