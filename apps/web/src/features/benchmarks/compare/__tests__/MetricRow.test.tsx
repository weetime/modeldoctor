import type { Benchmark } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { MetricRow } from "../MetricRow";
import { rowDescriptorsForTool } from "../metrics";

function makeBenchmark(id: string, p95: number, errors = 0, total = 100): Benchmark {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: id,
    label: null,
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: {
      tool: "guidellm",
      data: {
        e2eLatency: { p95 },
        requests: { total, error: errors, success: total - errors, incomplete: 0 },
        requestsPerSecond: { mean: 10 },
      },
    } as unknown as Benchmark["summaryMetrics"],
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function findDescriptor(rows: ReturnType<typeof rowDescriptorsForTool>, labelKey: string) {
  const d = rows.find((r) => r.labelKey === labelKey);
  if (!d) throw new Error(`fixture: no descriptor for ${labelKey}`);
  return d;
}

describe("MetricRow", () => {
  const guidellmRows = rowDescriptorsForTool("guidellm");
  const p95Descriptor = findDescriptor(guidellmRows, "latencyP95");

  it("renders a verdict badge on baseline-vs-current cell when verdictKind is set", () => {
    const baseline = makeBenchmark("b", 200);
    const current = makeBenchmark("c", 240); // +20% — regressed
    render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.getByText(/240/)).toBeInTheDocument();
    // VerdictBadge renders the delta text "+20.0%"
    expect(screen.getByText(/\+20/)).toBeInTheDocument();
  });

  it("renders no verdict badge when descriptor.verdictKind is undefined", () => {
    const ttftMean = findDescriptor(guidellmRows, "ttftMean");
    const baseline = makeBenchmark("b", 200);
    const current = makeBenchmark("c", 200);
    render(
      <table>
        <tbody>
          <MetricRow descriptor={ttftMean} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.queryByText(/regressed|improved|unchanged/i)).not.toBeInTheDocument();
  });

  it("renders no verdict badge when baselineId is null", () => {
    const a = makeBenchmark("a", 200);
    const b = makeBenchmark("b", 240);
    const { container } = render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[a, b]} baselineId={null} />
        </tbody>
      </table>,
    );
    // No icons rendered (VerdictBadge always renders an svg)
    expect(container.querySelector("svg")).toBeNull();
  });

  it("no-baseline: tints a worse-direction outlier red and shows a trend arrow", () => {
    // Mirrors the screenshot TTFT-p99 row: one huge value, rest clustered.
    const vals = [4571, 1973, 442, 413, 1448, 317, 318, 463];
    const runs = vals.map((v, i) => makeBenchmark(`r${i}`, v));
    render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={runs} baselineId={null} />
        </tbody>
      </table>,
    );
    const outlierCell = screen.getByText("4571 ms").closest("td");
    expect(outlierCell).not.toBeNull();
    // latency above mean = worse → red tint + a direction arrow icon.
    expect(outlierCell?.className).toMatch(/bg-red-50/);
    expect(outlierCell?.querySelector("svg")).not.toBeNull();
    // A clustered (non-outlier) value is not tinted.
    const normalCell = screen.getByText("442 ms").closest("td");
    expect(normalCell?.className).not.toMatch(/bg-red-50|bg-green-50/);
  });

  it("no-baseline: does not tint when all values are within band", () => {
    // Tight cluster — high z but <25% relative dev, so no outliers.
    const vals = [29.9, 27.1, 24.9, 25.1, 25.3, 25.0, 24.8, 24.9];
    const runs = vals.map((v, i) => makeBenchmark(`r${i}`, v));
    const { container } = render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={runs} baselineId={null} />
        </tbody>
      </table>,
    );
    expect(container.querySelector("td.bg-red-50, td.bg-green-50")).toBeNull();
  });

  it("renders em dash when reader returns null", () => {
    const baseline = makeBenchmark("b", 200);
    const current = {
      ...makeBenchmark("c", 200),
      summaryMetrics: null,
    };
    render(
      <table>
        <tbody>
          <MetricRow descriptor={p95Descriptor} runs={[baseline, current]} baselineId="b" />
        </tbody>
      </table>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
