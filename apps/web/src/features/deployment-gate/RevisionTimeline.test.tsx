import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RevisionTimeline } from "./RevisionTimeline";

const revisions = [
  {
    id: "r2",
    fingerprint: "bbbbbbbbbbbb",
    snapshot: {},
    firstSeenAt: "2026-09-21T00:00:00Z",
    readyAt: "2026-09-21T00:01:00Z",
    diff: [{ field: "backend_version", before: "0.10.1", after: "0.11.0" }],
    runs: [
      {
        id: "a2",
        discoveredModelId: "m",
        revisionId: "r2",
        trigger: "revision" as const,
        status: "completed" as const,
        currentStep: null,
        verdict: "regressed" as const,
        diagnosticsRunId: "d",
        evaluationRunId: "e",
        benchmarkId: "b",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-09-21T00:02:00Z",
        summary: {
          steps: [
            { step: "diagnostics" as const, outcome: "ok" as const },
            { step: "quality_gate" as const, outcome: "ok" as const },
            { step: "benchmark" as const, outcome: "ok" as const },
            { step: "compare" as const, outcome: "ok" as const },
          ],
          regression: {
            compared: true,
            baselineId: "bl",
            metrics: [
              {
                metric: "outputTokensPerSec" as const,
                baseline: 1000,
                current: 850,
                changePct: -15,
                thresholdPct: 10,
                exceeded: true,
              },
            ],
          },
        },
      },
    ],
  },
  {
    id: "r1",
    fingerprint: "aaaaaaaaaaaa",
    snapshot: {},
    firstSeenAt: "2026-09-20T00:00:00Z",
    readyAt: null,
    diff: [],
    runs: [],
  },
];

function renderTimeline() {
  render(
    <MemoryRouter>
      <RevisionTimeline revisions={revisions} onCancelRun={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("RevisionTimeline", () => {
  it("shows config diff, verdict, regression metric and links", () => {
    renderTimeline();
    expect(screen.getByText("backend_version")).toBeInTheDocument();
    expect(screen.getByText("0.10.1")).toBeInTheDocument();
    expect(screen.getByText("0.11.0")).toBeInTheDocument();
    expect(screen.getByText(/性能退化|Regressed/)).toBeInTheDocument();
    expect(screen.getByText("-15.0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /压测详情|Benchmark/ })).toHaveAttribute(
      "href",
      "/benchmarks/b",
    );
    expect(screen.getByRole("link", { name: /质量门禁报告|Quality gate report/ })).toHaveAttribute(
      "href",
      "/quality-gate/runs/e",
    );
  });
});
