import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EvaluationDetailPage } from "../EvaluationDetailPage";

// Hoist the mock data so the `data` reference stays stable across re-renders.
// Without this, the component's `useEffect([data])` would fire every render
// (since `useEvaluation()` would return a fresh object each call), triggering
// `setSamples(data.samples)` which is a new array reference, causing an
// infinite render loop.
const mockEvaluation = {
  id: "e1",
  userId: "u1",
  name: "Demo",
  description: "desc",
  version: 1,
  samples: [
    {
      id: "s0",
      idx: 0,
      prompt: "Q",
      expected: "A",
      judgeConfig: { kind: "exact-match" as const },
    },
  ],
  totalSamples: 1,
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
};

vi.mock("../queries", () => ({
  useEvaluation: () => ({ data: mockEvaluation }),
  useUpdateEvaluation: () => ({ mutate: vi.fn() }),
}));

function wrap() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/quality-gate/evaluations/e1"]}>
        <Routes>
          <Route path="/quality-gate/evaluations/:id" element={<EvaluationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("EvaluationDetailPage", () => {
  it("prefills name from data", () => {
    render(wrap());
    expect(screen.getByDisplayValue("Demo")).toBeInTheDocument();
  });
  it("shows existing sample", () => {
    render(wrap());
    expect(screen.getByDisplayValue("Q")).toBeInTheDocument();
  });
});
