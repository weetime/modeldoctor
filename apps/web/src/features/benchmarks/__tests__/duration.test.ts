import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtDurationMs, fmtTimeRange, runDurationMs } from "../duration";

describe("runDurationMs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns completedAt - startedAt for finished runs", () => {
    expect(runDurationMs("2026-04-30T12:00:01.000Z", "2026-04-30T12:00:30.000Z", "completed")).toBe(
      29_000,
    );
  });

  it("returns null when the run never started", () => {
    expect(runDurationMs(null, null, "pending")).toBeNull();
  });

  it("returns a live now-based delta for running runs without completedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:01:01.000Z"));
    expect(runDurationMs("2026-04-30T12:00:01.000Z", null, "running")).toBe(60_000);
  });

  it("returns null for terminal runs missing completedAt (no ever-growing delta)", () => {
    expect(runDurationMs("2026-04-30T12:00:01.000Z", null, "failed")).toBeNull();
    expect(runDurationMs("2026-04-30T12:00:01.000Z", null, "canceled")).toBeNull();
  });
});

describe("fmtDurationMs", () => {
  it("formats seconds / minutes / hours GitHub-Actions style", () => {
    expect(fmtDurationMs(29_000)).toBe("29s");
    expect(fmtDurationMs(272_000)).toBe("4m 32s");
    expect(fmtDurationMs(3_785_000)).toBe("1h 3m 5s");
  });

  it("renders null and negative values as em dash", () => {
    expect(fmtDurationMs(null)).toBe("—");
    expect(fmtDurationMs(-1)).toBe("—");
  });
});

describe("fmtTimeRange", () => {
  it("is open-ended without an end timestamp", () => {
    expect(fmtTimeRange("2026-04-30T12:00:01.000Z", null)).toMatch(
      /^\d{2}-\d{2} \d{2}:\d{2}:\d{2} →$/,
    );
  });

  it("repeats the date on the end only when the run crosses midnight", () => {
    const sameDay = fmtTimeRange("2026-04-30T12:00:01.000Z", "2026-04-30T12:00:30.000Z");
    expect(sameDay).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2} → \d{2}:\d{2}:\d{2}$/);
    const crossDay = fmtTimeRange("2026-04-30T12:00:01.000Z", "2026-05-02T12:00:30.000Z");
    expect(crossDay).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2} → \d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
