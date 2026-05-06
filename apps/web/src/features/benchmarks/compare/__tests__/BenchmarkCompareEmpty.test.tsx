import type { Benchmark, ListBenchmarksResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock the api-client like the sibling tests do — useBenchmarkList resolves
// against `api.get` under the hood, so this stub feeds the picker its list.
vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { BenchmarkCompareEmpty } from "../BenchmarkCompareEmpty";

function makeBenchmark(
  id: string,
  status: Benchmark["status"] = "completed",
  scenario: Benchmark["scenario"] = "inference",
  tool: Benchmark["tool"] = "guidellm",
): Benchmark {
  return {
    id,
    userId: null,
    connectionId: null,
    connection: null,
    scenario,
    tool,
    toolVersion: null,
    name: id,
    description: null,
    status,
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: {},
    rawOutput: null,
    summaryMetrics: null,
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

// MemoryRouter doesn't update window.location, so to assert the navigated
// URL we render a sibling that probes useLocation() and exposes its
// pathname + search via test-ids. The sibling renders alongside the page,
// not on a separate route, so it's available at every step.
function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <span data-testid="loc-pathname">{loc.pathname}</span>
      <span data-testid="loc-search">{loc.search}</span>
    </>
  );
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/benchmarks/compare"]}>
          <LocationProbe />
          <Routes>
            <Route path="/benchmarks/compare" element={<BenchmarkCompareEmpty />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("BenchmarkCompareEmpty", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("submit button is hidden before any scenario is picked", () => {
    renderPage();
    // Submit button is rendered only once a scenario is picked; before
    // picking, neither the button nor the helper text exist.
    expect(screen.queryByRole("button", { name: /Start comparison|开始对比/i })).toBeNull();
    expect(screen.queryByText(/Select 2\+ benchmarks|至少选择 2 个基准测试/i)).toBeNull();
  });

  it("after picking a scenario, submit is disabled and helper text shows until 2 are selected", async () => {
    const resp: ListBenchmarksResponse = {
      items: [makeBenchmark("alpha"), makeBenchmark("beta"), makeBenchmark("gamma")],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    renderPage();

    const select = screen.getByLabelText(/Scenario|场景/i) as HTMLSelectElement;
    await userEvent.selectOptions(select, "inference");

    // The list query resolves and the checkbox for "alpha" appears. Use
    // the checkbox's accessible name (via its <label>) as the unique anchor.
    const alphaCheckbox = await screen.findByRole("checkbox", { name: /alpha/i });

    const submit = screen.getByRole("button", { name: /Start comparison|开始对比/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Select 2\+ benchmarks|至少选择 2 个基准测试/i)).toBeInTheDocument();

    // Tick one — still disabled, helper text still visible
    await userEvent.click(alphaCheckbox);
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Select 2\+ benchmarks|至少选择 2 个基准测试/i)).toBeInTheDocument();
  });

  it("happy path: ticking 2 benchmarks then submit navigates to /benchmarks/compare?ids=a,b without a scenario param", async () => {
    const resp: ListBenchmarksResponse = {
      items: [makeBenchmark("alpha"), makeBenchmark("beta")],
      nextCursor: null,
    };
    vi.mocked(api.get).mockResolvedValue(resp);
    renderPage();

    await userEvent.selectOptions(
      screen.getByLabelText(/Scenario|场景/i) as HTMLSelectElement,
      "inference",
    );
    const alphaCheckbox = await screen.findByRole("checkbox", { name: /alpha/i });
    const betaCheckbox = screen.getByRole("checkbox", { name: /beta/i });

    await userEvent.click(alphaCheckbox);
    await userEvent.click(betaCheckbox);

    const submit = screen.getByRole("button", { name: /Start comparison|开始对比/i });
    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);

    // useLocation() reflects the navigation; assert the destination.
    await waitFor(() =>
      expect(screen.getByTestId("loc-pathname").textContent).toBe("/benchmarks/compare"),
    );
    const search = screen.getByTestId("loc-search").textContent ?? "";
    const sp = new URLSearchParams(search);
    expect(sp.get("ids")).toBe("alpha,beta");
    // YAGNI: scenario param should NOT be present (ComparePage derives it).
    expect(sp.get("scenario")).toBeNull();
  });

  it("changing scenario clears the prior selection", async () => {
    // The component's `useBenchmarkList` fires once on mount with no
    // scenario filter (the `{}` query) and again on each scenario pick.
    // Branch on the URL search rather than using `mockResolvedValueOnce`,
    // which would lose calls if React invokes the query more than once
    // per scenario change (StrictMode double-invoke, refetch-on-mount, …).
    vi.mocked(api.get).mockImplementation((path: string) => {
      const inference: ListBenchmarksResponse = {
        items: [makeBenchmark("alpha"), makeBenchmark("beta")],
        nextCursor: null,
      };
      const capacity: ListBenchmarksResponse = {
        items: [makeBenchmark("xray"), makeBenchmark("yankee")],
        nextCursor: null,
      };
      if (path.includes("scenario=capacity")) return Promise.resolve(capacity);
      // covers both `?scenario=inference` and the no-filter `{}` query
      return Promise.resolve(inference);
    });
    renderPage();

    const select = screen.getByLabelText(/Scenario|场景/i) as HTMLSelectElement;
    await userEvent.selectOptions(select, "inference");
    const alphaCheckbox = await screen.findByRole("checkbox", { name: /alpha/i });
    const betaCheckbox = screen.getByRole("checkbox", { name: /beta/i });
    await userEvent.click(alphaCheckbox);
    await userEvent.click(betaCheckbox);

    // Submit must be enabled with 2 selected before we switch scenarios.
    const submit = screen.getByRole("button", { name: /Start comparison|开始对比/i });
    expect(submit).not.toBeDisabled();

    // Switch scenario — selection clears synchronously in the onChange handler.
    await userEvent.selectOptions(select, "capacity");
    await screen.findByRole("checkbox", { name: /xray/i });

    expect(submit).toBeDisabled();
    // Prior selection cleared → helper text reappears.
    expect(screen.getByText(/Select 2\+ benchmarks|至少选择 2 个基准测试/i)).toBeInTheDocument();
  });
});
