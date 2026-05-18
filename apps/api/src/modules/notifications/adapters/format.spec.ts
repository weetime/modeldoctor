import { describe, expect, it } from "vitest";
import { formatText } from "./format.js";

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
