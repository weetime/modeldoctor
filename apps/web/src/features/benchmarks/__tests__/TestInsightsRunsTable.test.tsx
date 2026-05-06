import i18n from "@/lib/i18n";
import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TestInsightsRunsTable } from "../TestInsightsRunsTable";

function withProviders(node: React.ReactNode) {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>
  );
}

function makeRun(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: over.id ?? "b_1",
    userId: "u_1",
    connectionId: "c_1",
    connection: { id: "c_1", name: "conn", model: "m", baseUrl: "http://x" },
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: over.name ?? "run-1",
    description: null,
    status: over.status ?? "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: over.summaryMetrics ?? {
      tool: "guidellm",
      data: {
        e2eLatency: { p95: 100 },
        requests: { total: 100, error: 1 },
      },
    },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: over.createdAt ?? "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    baselineFor: null,
    ...over,
  };
}

describe("TestInsightsRunsTable", () => {
  it("renders one row per run with name link, tool badge, status, p95, errorRate", () => {
    render(
      withProviders(
        <TestInsightsRunsTable
          runs={[
            makeRun({ id: "b1", name: "alpha" }),
            makeRun({ id: "b2", name: "beta", status: "failed" }),
          ]}
        />,
      ),
    );
    const alphaLink = screen.getByRole("link", { name: "alpha" });
    expect(alphaLink).toHaveAttribute("href", "/benchmarks/b1");
    expect(screen.getByRole("link", { name: "beta" })).toHaveAttribute("href", "/benchmarks/b2");

    // tool badges (rendered twice — once per row)
    expect(screen.getAllByText(/guidellm/i)).toHaveLength(2);

    // p95 values: 100ms (alpha) and 100ms (beta — same fixture)
    expect(screen.getAllByText(/100/).length).toBeGreaterThanOrEqual(2);
  });

  it("renders dash when summary metrics are absent", () => {
    render(
      withProviders(<TestInsightsRunsTable runs={[makeRun({ id: "b1", summaryMetrics: null })]} />),
    );
    // Find the table cell containing "—". It appears in p95 + errorRate columns.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders empty placeholder when runs is []", () => {
    render(withProviders(<TestInsightsRunsTable runs={[]} />));
    expect(
      screen.getByText(/选定时间范围内没有基准测试|No benchmarks within/i),
    ).toBeInTheDocument();
  });
});
