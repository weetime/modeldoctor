import type { Benchmark } from "@modeldoctor/contracts";
import type { VllmOmniBenchReport } from "@modeldoctor/tool-adapters/schemas";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { OmniReport } from "../OmniReport";

const stat = (mean: number, p50: number, p99: number) => ({ mean, p50, p99 });

const omniReport: VllmOmniBenchReport = {
  curve: [
    {
      arm: "audio",
      concurrency: 1,
      status: "ok",
      reqPerSec: 1.2,
      outTokPerSec: 30,
      ttftMs: stat(120, 110, 200),
      e2elMs: stat(2500, 2400, 3000),
      audioTtfpMs: stat(300, 280, 450),
      audioRtf: stat(0.4, 0.38, 0.6),
    },
    {
      arm: "text",
      concurrency: 1,
      status: "ok",
      reqPerSec: 1.5,
      outTokPerSec: 35,
      ttftMs: stat(100, 95, 180),
      e2elMs: stat(2000, 1900, 2600),
      audioTtfpMs: null,
      audioRtf: null,
    },
    {
      arm: "audio",
      concurrency: 8,
      status: "ok",
      reqPerSec: 6.5,
      outTokPerSec: 180,
      ttftMs: stat(200, 190, 320),
      e2elMs: stat(3200, 3000, 4200),
      audioTtfpMs: stat(500, 470, 700),
      audioRtf: stat(0.9, 0.85, 1.1),
    },
    {
      arm: "audio",
      concurrency: 16,
      status: "failed",
      reqPerSec: null,
      outTokPerSec: null,
      ttftMs: null,
      e2elMs: null,
      audioTtfpMs: null,
      audioRtf: null,
    },
  ],
  derived: {
    realtimeCeiling: 8,
    peakConcurrency: 8,
    voiceTaxMsByLevel: { "1": 500, "8": 1200 },
    voiceTaxMs: 850,
  },
  warnings: ["concurrency=16 timed out after 900s"],
};

const omniBenchmarkFixture = {
  id: "b-omni-1",
  name: "Omni · vllm-omni-bench",
  tool: "vllm-omni-bench",
  scenario: "omni",
  status: "completed",
  summaryMetrics: { tool: "vllm-omni-bench", data: omniReport },
} as unknown as Benchmark;

describe("OmniReport", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders stat tiles, curve charts and the voice-tax chart from a valid report", () => {
    render(<OmniReport benchmark={omniBenchmarkFixture} />);

    // realtime ceiling stat tile
    expect(screen.getByText("c=8")).toBeInTheDocument();
    // TTFP @ c1 (mean=300)
    expect(screen.getByText("300 ms")).toBeInTheDocument();
    // RTF @ peak (mean=0.90)
    expect(screen.getByText("0.90")).toBeInTheDocument();
    // voice tax stat tile (850ms)
    expect(screen.getByText("850 ms")).toBeInTheDocument();

    expect(screen.getByText("AUDIO_RTF - 并发曲线")).toBeInTheDocument();
    expect(screen.getByText("AUDIO_TTFP - 并发曲线")).toBeInTheDocument();
    expect(screen.getByText("语音税(按档 ΔE2EL)")).toBeInTheDocument();
    expect(screen.getByText("concurrency=16 timed out after 900s")).toBeInTheDocument();

    // 3 charts: RTF curve, TTFP curve, voice-tax bar.
    expect(screen.getAllByTestId("echart")).toHaveLength(3);
  });

  it("only plots the audio-arm ok-status points on the RTF curve (excludes text arm and failed points)", () => {
    render(<OmniReport benchmark={omniBenchmarkFixture} />);

    const [rtfChart] = screen.getAllByTestId("echart");
    const option = JSON.parse(rtfChart.getAttribute("data-option") ?? "{}");
    const series = option.series[0];
    // Two audio/ok points (concurrency 1 and 8) — the text-arm point and the
    // failed concurrency=16 point must not appear.
    expect(series.data).toEqual([
      [1, 0.4],
      [8, 0.9],
    ]);
  });

  it("falls back to UnknownReport when summaryMetrics does not parse as a VllmOmniBenchReport", () => {
    const bm = {
      ...omniBenchmarkFixture,
      summaryMetrics: { tool: "vllm-omni-bench", data: { curve: "not-an-array" } },
    } as unknown as Benchmark;
    render(<OmniReport benchmark={bm} />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
  });
});
