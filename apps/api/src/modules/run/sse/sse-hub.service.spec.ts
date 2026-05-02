import { describe, expect, it } from "vitest";
import { SseHub } from "./sse-hub.service.js";
import type { ProgressEvent } from "@modeldoctor/tool-adapters";

describe("SseHub", () => {
  it("delivers events to subscribers of the same runId", async () => {
    const hub = new SseHub();
    const received: ProgressEvent[] = [];
    const sub = hub.subscribe("run1").subscribe((e) => received.push(e));
    hub.publish("run1", { kind: "log", level: "info", line: "hello" });
    hub.publish("run1", { kind: "progress", pct: 0.5 });
    sub.unsubscribe();
    expect(received).toHaveLength(2);
  });

  it("does not deliver across different runIds", async () => {
    const hub = new SseHub();
    const r1: ProgressEvent[] = [];
    const r2: ProgressEvent[] = [];
    hub.subscribe("a").subscribe((e) => r1.push(e));
    hub.subscribe("b").subscribe((e) => r2.push(e));
    hub.publish("a", { kind: "log", level: "info", line: "for-a" });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(0);
  });
});
