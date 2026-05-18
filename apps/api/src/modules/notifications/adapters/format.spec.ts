import { describe, expect, it } from "vitest";
import { formatDingtalkAlertMarkdown, formatText } from "./format.js";

describe("formatText — per-eventType shapes", () => {
  it("test event includes the message string", () => {
    const out = formatText({
      eventType: "test",
      payload: { message: "Test notification from ModelDoctor" },
    });
    expect(out).toBe("[ModelDoctor] test: Test notification from ModelDoctor");
  });

  it("test event without message falls back to placeholder", () => {
    const out = formatText({ eventType: "test", payload: {} });
    expect(out).toBe("[ModelDoctor] test: (no message)");
  });

  it("test event with empty / whitespace-only message also falls back", () => {
    expect(formatText({ eventType: "test", payload: { message: "" } })).toBe(
      "[ModelDoctor] test: (no message)",
    );
    expect(formatText({ eventType: "test", payload: { message: "   " } })).toBe(
      "[ModelDoctor] test: (no message)",
    );
  });

  it("alert.explained includes alertName + severity + connectionName", () => {
    const out = formatText({
      eventType: "alert.explained",
      payload: {
        alertEventId: "ae_1",
        alertName: "VllmKvCacheNearFull",
        severity: "critical",
        connectionId: "cmp1",
        connectionName: "prod-vllm",
        narrative: "...",
      },
    });
    expect(out).toBe(
      "[ModelDoctor] alert VllmKvCacheNearFull severity=critical connection=prod-vllm",
    );
  });

  it("alert.explained falls back to connectionId when name is missing", () => {
    const out = formatText({
      eventType: "alert.explained",
      payload: {
        alertName: "X",
        severity: "warning",
        connectionId: "cmp_xyz",
      },
    });
    expect(out).toBe("[ModelDoctor] alert X severity=warning connection=cmp_xyz");
  });

  it("alert.explained without alertName/severity uses placeholders", () => {
    const out = formatText({ eventType: "alert.explained", payload: {} });
    expect(out).toBe("[ModelDoctor] alert (unknown alert) severity=unknown");
  });

  it("alert.explained with empty alertName/severity also uses placeholders", () => {
    const out = formatText({
      eventType: "alert.explained",
      payload: { alertName: "", severity: "  " },
    });
    expect(out).toBe("[ModelDoctor] alert (unknown alert) severity=unknown");
  });

  it("alert.explained falls through connectionName='' to connectionId", () => {
    const out = formatText({
      eventType: "alert.explained",
      payload: { alertName: "X", severity: "info", connectionName: "", connectionId: "cmp_z" },
    });
    expect(out).toContain("connection=cmp_z");
  });

  it("benchmark.completed keeps the original shape (name + status + connection)", () => {
    const out = formatText({
      eventType: "benchmark.completed",
      payload: { name: "qwen-baseline", status: "succeeded", connectionId: "cmp1" },
    });
    expect(out).toBe(
      "[ModelDoctor] benchmark.completed qwen-baseline status=succeeded connection=cmp1",
    );
  });

  it("benchmark.failed falls back to runId when name is missing", () => {
    const out = formatText({
      eventType: "benchmark.failed",
      payload: { runId: "run_abc", status: "failed" },
    });
    expect(out).toBe("[ModelDoctor] benchmark.failed run_abc status=failed");
  });

  it("unknown eventType uses the benchmark-style fallback", () => {
    const out = formatText({
      eventType: "diagnostics.failed",
      payload: { name: "endpoint-health", status: "failed" },
    });
    expect(out).toBe("[ModelDoctor] diagnostics.failed endpoint-health status=failed");
  });
});

describe("formatDingtalkAlertMarkdown", () => {
  const fullPayload = {
    alertEventId: "ae_abc",
    alertName: "VllmKvCacheNearFull",
    severity: "critical",
    connectionId: "cmp_1",
    connectionName: "prod-vllm",
    scenario: "engine",
    narrative: "KV cache pressure on prod-vllm exceeded 90% for 5 min.",
    recommendations: ["扩容副本", "降低 max_tokens 上限"],
  };

  it("renders title + sectioned markdown body", () => {
    const out = formatDingtalkAlertMarkdown({
      eventType: "alert.explained",
      payload: fullPayload,
    });
    expect(out.title).toBe("[ModelDoctor] CRITICAL · VllmKvCacheNearFull");
    expect(out.text).toContain("#### [ModelDoctor] 告警：VllmKvCacheNearFull");
    expect(out.text).toContain("> **严重度**: critical");
    expect(out.text).toContain("> **关联连接**: prod-vllm");
    expect(out.text).toContain("> **场景**: engine");
    expect(out.text).toContain("**AI 解读**");
    expect(out.text).toContain("KV cache pressure on prod-vllm exceeded 90% for 5 min.");
    expect(out.text).toContain("**建议处置**");
    expect(out.text).toContain("- 扩容副本");
    expect(out.text).toContain("- 降低 max_tokens 上限");
  });

  it("omits detail link when appBaseUrl is unset", () => {
    const out = formatDingtalkAlertMarkdown({
      eventType: "alert.explained",
      payload: fullPayload,
    });
    expect(out.text).not.toContain("[查看详情]");
  });

  it("renders detail link when appBaseUrl is provided", () => {
    const out = formatDingtalkAlertMarkdown(
      { eventType: "alert.explained", payload: fullPayload },
      { appBaseUrl: "https://app.example.com/" },
    );
    expect(out.text).toContain("[查看详情](https://app.example.com/alerts/ae_abc)");
  });

  it("falls back to connectionId when connectionName missing", () => {
    const out = formatDingtalkAlertMarkdown({
      eventType: "alert.explained",
      payload: { ...fullPayload, connectionName: undefined },
    });
    expect(out.text).toContain("> **关联连接**: cmp_1");
  });

  it("renders gracefully with no narrative + no recommendations", () => {
    const out = formatDingtalkAlertMarkdown({
      eventType: "alert.explained",
      payload: {
        alertName: "X",
        severity: "warning",
      },
    });
    expect(out.title).toBe("[ModelDoctor] WARNING · X");
    expect(out.text).toContain("#### [ModelDoctor] 告警：X");
    expect(out.text).not.toContain("**AI 解读**");
    expect(out.text).not.toContain("**建议处置**");
  });
});
