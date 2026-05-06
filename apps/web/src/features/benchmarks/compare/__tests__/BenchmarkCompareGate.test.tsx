import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkCompareGate } from "../BenchmarkCompareGate";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));

function renderAt(initialUrl: string) {
  // QueryClientProvider needed because BenchmarkComparePage (rendered
  // when ids are present) calls useQueries internally.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/benchmarks/compare" element={<BenchmarkCompareGate />} />
          <Route path="/benchmarks/inference" element={<div>inference list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BenchmarkCompareGate", () => {
  it("redirects to /benchmarks/inference when ?ids is missing", () => {
    renderAt("/benchmarks/compare");
    expect(screen.getByText("inference list")).toBeInTheDocument();
  });

  it("redirects to /benchmarks/inference when ?ids is empty string", () => {
    renderAt("/benchmarks/compare?ids=");
    expect(screen.getByText("inference list")).toBeInTheDocument();
  });

  it("renders <BenchmarkComparePage /> when ?ids has at least one entry", () => {
    renderAt("/benchmarks/compare?ids=a,b");
    expect(screen.queryByText("inference list")).not.toBeInTheDocument();
  });
});
