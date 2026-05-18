import type { DeliveryPayload } from "./index.js";

/** DingTalk markdown payload shape — `title` is the push-banner preview,
 * `text` is the body (DingTalk-flavoured GFM: headings / bold / lists /
 * links / inline images, NO tables or fenced code blocks). */
export interface DingtalkMarkdown {
  title: string;
  text: string;
}

/** Narrow check used throughout the formatters: a value is a usable string
 * only if it's actually a string AND has at least one non-whitespace char.
 * Catches `""`, `"   "`, and the more obvious `undefined` / non-string cases
 * with one predicate so the formatter doesn't render fields like
 * `[ModelDoctor] test: ` with a trailing blank. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

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
    const message = isNonEmptyString(p.message) ? p.message : "(no message)";
    return `[ModelDoctor] test: ${message}`;
  }

  if (ev === "alert.explained") {
    const alertName = isNonEmptyString(p.alertName) ? p.alertName : "(unknown alert)";
    const severity = isNonEmptyString(p.severity) ? p.severity : "unknown";
    // Prefer the human connection name; cuid fallback so we never drop
    // the identifier entirely. Multi-tenant scoping (don't expose another
    // user's alert) is enforced upstream in AlertsService.listForUser /
    // AlertExplainerService.emitNotification, not here — the formatter
    // receives an already-authorised payload.
    const conn = isNonEmptyString(p.connectionName)
      ? p.connectionName
      : isNonEmptyString(p.connectionId)
        ? p.connectionId
        : null;
    const tail = conn ? ` connection=${conn}` : "";
    return `[ModelDoctor] alert ${alertName} severity=${severity}${tail}`;
  }

  // Benchmark-style fallback (unchanged from the original shape): name (or
  // runId), optional status, optional connection id. Same for
  // benchmark.completed / benchmark.failed / diagnostics.failed.
  const name = isNonEmptyString(p.name)
    ? p.name
    : isNonEmptyString(p.runId)
      ? p.runId
      : "(unknown)";
  const status = isNonEmptyString(p.status) ? ` status=${p.status}` : "";
  const connId = isNonEmptyString(p.connectionId) ? ` connection=${p.connectionId}` : "";
  return `[ModelDoctor] ${ev} ${name}${status}${connId}`;
}

/**
 * DingTalk markdown body for `alert.explained` — the only payload that
 * carries enough structure to benefit from rich formatting (AI narrative,
 * recommendations list, severity, connection link). Other event types
 * stay on plain text via `formatText` because they're short and don't
 * need sectioning.
 *
 * Pass `appBaseUrl` to render a clickable "查看详情" link; leave it
 * undefined (e.g. in dev without APP_BASE_URL set) and the link section
 * is omitted entirely.
 *
 * DingTalk markdown supports: headings / bold / italic / links / inline
 * images / lists / blockquote. Does NOT support tables or fenced code
 * blocks (they render as raw text), so avoid both here.
 */
export function formatDingtalkAlertMarkdown(
  body: DeliveryPayload,
  opts: { appBaseUrl?: string } = {},
): DingtalkMarkdown {
  const p = body.payload as Record<string, unknown>;
  const alertName = isNonEmptyString(p.alertName) ? p.alertName : "(unknown alert)";
  const severity = isNonEmptyString(p.severity) ? p.severity : "unknown";
  const connectionName = isNonEmptyString(p.connectionName)
    ? p.connectionName
    : isNonEmptyString(p.connectionId)
      ? p.connectionId
      : null;
  const narrative = isNonEmptyString(p.narrative) ? p.narrative.trim() : "";
  const scenario = isNonEmptyString(p.scenario) ? p.scenario : null;
  const alertEventId = isNonEmptyString(p.alertEventId) ? p.alertEventId : null;

  const recs = Array.isArray(p.recommendations) ? (p.recommendations as unknown[]) : [];

  // Title is the push-banner preview — keep it ≤ ~50 chars and front-load
  // the high-signal bits (severity + alertName).
  const title = `[ModelDoctor] ${severity.toUpperCase()} · ${alertName}`;

  const lines: string[] = [];
  lines.push(`#### [ModelDoctor] 告警：${alertName}`);
  lines.push("");
  lines.push(`> **严重度**: ${severity}`);
  if (connectionName) lines.push(`> **关联连接**: ${connectionName}`);
  if (scenario) lines.push(`> **场景**: ${scenario}`);
  lines.push("");

  if (narrative) {
    lines.push("**AI 解读**");
    lines.push("");
    lines.push(narrative);
    lines.push("");
  }

  if (recs.length > 0) {
    lines.push("**建议处置**");
    for (const r of recs) {
      if (isNonEmptyString(r)) lines.push(`- ${r}`);
    }
    lines.push("");
  }

  if (opts.appBaseUrl && alertEventId) {
    const base = opts.appBaseUrl.replace(/\/$/, "");
    lines.push(`[查看详情](${base}/alerts/${alertEventId})`);
  }

  return { title, text: lines.join("\n") };
}
