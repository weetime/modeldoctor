import "@/lib/i18n";
import type { AutomationRunPublic, DeploymentRevisionPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RevisionTimeline } from "./RevisionTimeline";

const revisions: DeploymentRevisionPublic[] = [
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
        trigger: "revision",
        status: "completed",
        currentStep: null,
        verdict: "regressed",
        diagnosticsRunId: "d",
        evaluationRunId: "e",
        benchmarkId: "b",
        startedAt: null,
        finishedAt: null,
        createdAt: "2026-09-21T00:02:00Z",
        summary: {
          steps: [
            { step: "diagnostics", outcome: "ok" },
            { step: "quality_gate", outcome: "ok" },
            { step: "benchmark", outcome: "ok" },
            { step: "compare", outcome: "ok" },
          ],
          regression: {
            compared: true,
            baselineId: "bl",
            metrics: [
              {
                metric: "outputTokensPerSec",
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
    snapshot: { backend: "vLLM", backend_version: "0.10.1" },
    firstSeenAt: "2026-09-20T00:00:00Z",
    readyAt: null,
    // The oldest revision is diffed against `null` by
    // DiscoveredModelsService.listRevisions, so the API returns a FULL diff
    // here (one `null -> value` entry per non-null snapshot field), never an
    // empty one. The UI must recognise it by position, not by diff length.
    diff: [
      { field: "backend", before: null, after: "vLLM" },
      { field: "backend_version", before: null, after: "0.10.1" },
    ],
    runs: [],
  },
];

function renderTimeline(
  revs: DeploymentRevisionPublic[] = revisions,
  onCancelRun: (id: string) => void = vi.fn(),
) {
  render(
    <MemoryRouter>
      <RevisionTimeline revisions={revs} onCancelRun={onCancelRun} />
    </MemoryRouter>,
  );
}

function makeRun(overrides: Partial<AutomationRunPublic> = {}): AutomationRunPublic {
  return {
    id: "a1",
    discoveredModelId: "m",
    revisionId: "r1",
    trigger: "manual",
    status: "completed",
    currentStep: null,
    verdict: "passed",
    diagnosticsRunId: null,
    evaluationRunId: null,
    benchmarkId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-09-22T00:02:00Z",
    summary: null,
    ...overrides,
  };
}

function makeRevision(overrides: Partial<DeploymentRevisionPublic> = {}): DeploymentRevisionPublic {
  return {
    id: "r1",
    fingerprint: "cccccccccccc",
    snapshot: {},
    firstSeenAt: "2026-09-22T00:00:00Z",
    readyAt: "2026-09-22T00:01:00Z",
    diff: [],
    runs: [],
    ...overrides,
  };
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

  it("(a) renders the 'not compared' reason and no metrics table when regression.compared is false", () => {
    const revs = [
      makeRevision({
        runs: [
          makeRun({
            summary: {
              steps: [{ step: "benchmark", outcome: "ok" }],
              regression: {
                compared: false,
                reason: "尚无 baseline，本次结果已作为 baseline",
                metrics: [],
              },
            },
          }),
        ],
      }),
    ];
    renderTimeline(revs);
    expect(screen.getByText(/尚无 baseline，本次结果已作为 baseline/)).toBeInTheDocument();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("(b) renders the baseline-established line", () => {
    const revs = [
      makeRevision({
        runs: [
          makeRun({
            summary: {
              steps: [{ step: "benchmark", outcome: "ok" }],
              baselineEstablished: true,
            },
          }),
        ],
      }),
    ];
    renderTimeline(revs);
    expect(screen.getByText(/已建立 Baseline|Baseline established/)).toBeInTheDocument();
  });

  it("(c) offers Cancel and shows the current step for a running run, and calls onCancelRun(id) on click", async () => {
    const user = userEvent.setup();
    const onCancelRun = vi.fn();
    const revs = [
      makeRevision({
        runs: [
          makeRun({
            id: "running-1",
            status: "running",
            currentStep: "diagnostics",
            verdict: null,
          }),
        ],
      }),
    ];
    renderTimeline(revs, onCancelRun);

    expect(screen.getByText(/诊断|Diagnostics/)).toBeInTheDocument();
    const cancelButton = screen.getByRole("button", { name: /取消|Cancel/ });
    await user.click(cancelButton);
    expect(onCancelRun).toHaveBeenCalledWith("running-1");
  });

  it("(d) renders the empty-state text when there are no revisions", () => {
    renderTimeline([], vi.fn());
    expect(screen.getByText(/尚无部署版本|No revisions yet/)).toBeInTheDocument();
  });

  it("(e) labels the oldest revision as the initial revision instead of rendering its null→value diff", () => {
    renderTimeline();
    expect(screen.getByText(/初始版本|Initial revision/)).toBeInTheDocument();
    // Only the newer revision's real diff is tabulated; the oldest
    // revision's `null -> value` dump must not be shown.
    expect(screen.queryByText("backend")).not.toBeInTheDocument();
    expect(screen.getAllByText("backend_version")).toHaveLength(1);
  });
});
