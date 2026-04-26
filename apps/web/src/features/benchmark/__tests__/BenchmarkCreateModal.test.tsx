import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } };
});

import { api } from "@/lib/api-client";
import { BenchmarkCreateModal } from "../BenchmarkCreateModal";
import type { BenchmarkRun } from "@modeldoctor/contracts";

const SOURCE_RUN: BenchmarkRun = {
  id: "src1",
  userId: "u1",
  name: "vllm-llama3-tput",
  description: "first run",
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "llama-3-8b",
  datasetName: "random",
  datasetInputTokens: 2048,
  datasetOutputTokens: 256,
  datasetSeed: 42,
  requestRate: 0,
  totalRequests: 500,
  state: "completed",
  stateMessage: null,
  jobName: "j",
  progress: 1,
  metricsSummary: null,
  rawMetrics: null,
  logs: null,
  createdAt: "2026-04-26T14:22:00Z",
  startedAt: "2026-04-26T14:22:00Z",
  completedAt: "2026-04-26T14:24:00Z",
};

const FAKE_RUN: BenchmarkRun = {
  id: "newid",
  userId: "u1",
  name: "smoke",
  description: null,
  profile: "throughput",
  apiType: "chat",
  apiUrl: "https://api.test/v1",
  model: "m",
  datasetName: "random",
  datasetInputTokens: 1024,
  datasetOutputTokens: 128,
  datasetSeed: null,
  requestRate: 0,
  totalRequests: 1000,
  state: "pending",
  stateMessage: null,
  jobName: null,
  progress: null,
  metricsSummary: null,
  rawMetrics: null,
  logs: null,
  createdAt: new Date().toISOString(),
  startedAt: null,
  completedAt: null,
};

function Wrapper({
  children,
  initialEntries = ["/benchmarks"],
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/benchmarks" element={children} />
          <Route
            path="/benchmarks/:id"
            element={<div>detail page for navigation target</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BenchmarkCreateModal — basic tab", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("is closed by default", () => {
    render(<BenchmarkCreateModal />, { wrapper: Wrapper });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when ?create=1 is in the URL", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/new benchmark/i)).toBeInTheDocument();
  });

  it("renders both tab triggers", () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    expect(screen.getByRole("tab", { name: /basic info/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it("closes when Cancel is clicked and clears the URL search param", async () => {
    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("submitting fills form, calls api.post, navigates to detail", async () => {
    vi.mocked(api.post).mockResolvedValue(FAKE_RUN);

    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?create=1"]}>{children}</Wrapper>
      ),
    });

    await userEvent.type(screen.getByLabelText(/^name$/i), "smoke");
    await userEvent.type(
      screen.getByLabelText(/api url/i),
      "https://api.test/v1",
    );
    await userEvent.type(screen.getByLabelText(/api key/i), "k");
    await userEvent.type(screen.getByLabelText(/^model$/i), "m");

    const submit = screen.getByRole("button", { name: /run benchmark/i });
    await userEvent.click(submit);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/api/benchmarks",
        expect.objectContaining({
          name: "smoke",
          apiUrl: "https://api.test/v1",
          apiKey: "k",
          model: "m",
          profile: "throughput",
        }),
      ),
    );
    expect(
      await screen.findByText(/detail page for navigation target/i),
    ).toBeInTheDocument();
  });

  it("?duplicate=src1 prefills form with source values and blanks apiKey", async () => {
    vi.mocked(api.get).mockResolvedValue(SOURCE_RUN);

    render(<BenchmarkCreateModal />, {
      wrapper: ({ children }) => (
        <Wrapper initialEntries={["/benchmarks?duplicate=src1"]}>
          {children}
        </Wrapper>
      ),
    });

    expect(
      await screen.findByText(/duplicating from/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue("vllm-llama3-tput-2");
    expect(screen.getByLabelText(/api url/i)).toHaveValue(
      "https://api.test/v1",
    );
    expect(screen.getByLabelText(/^model$/i)).toHaveValue("llama-3-8b");
    expect(screen.getByLabelText(/api key/i)).toHaveValue("");
    expect(screen.getByLabelText(/api key/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

});
