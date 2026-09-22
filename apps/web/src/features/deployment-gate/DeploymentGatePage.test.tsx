import "@/lib/i18n";
import type { DiscoveredModelPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the sonner/react-router/queries mock factories can reference
// these symbols at hoist-time (vi.mock factories run before top-level const
// declarations) — same pattern as SourceSheet.test.tsx.
const {
  toastSuccess,
  toastError,
  navigateMock,
  discoveredModelsMock,
  updateMutateAsync,
  runMutateAsync,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigateMock: vi.fn(),
  discoveredModelsMock: vi.fn(),
  updateMutateAsync: vi.fn(async () => ({})),
  runMutateAsync: vi.fn(async () => ({})),
}));

vi.mock("./queries", () => ({
  useDiscoveredModels: () => discoveredModelsMock(),
  useSources: () => ({ isLoading: false, data: [{ id: "s1" }] }),
  useUpdateDiscoveredModel: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useRunDiscoveredModel: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

import { DeploymentGatePage } from "./DeploymentGatePage";

function makeModel(overrides: Partial<DiscoveredModelPublic> = {}): DiscoveredModelPublic {
  return {
    id: "m1",
    sourceId: "s1",
    sourceName: "prod",
    externalId: "7",
    name: "qwen",
    categories: ["llm"],
    clusterId: "1",
    status: "unroutable",
    routeName: null,
    routeOverride: false,
    connectionId: null,
    currentRevision: {
      id: "r1",
      fingerprint: "abc",
      backend: "vLLM",
      backendVersion: "0.11.0",
      readyAt: "2026-09-22T00:00:00Z",
    },
    automationEnabled: false,
    steps: ["diagnostics"],
    evaluationId: null,
    gateConfig: null,
    benchmarkTemplateId: null,
    schedule: "off",
    nextScheduledAt: null,
    baselineId: null,
    regressionThresholds: null,
    lastRun: {
      id: "a1",
      discoveredModelId: "m1",
      revisionId: "r1",
      trigger: "revision",
      status: "completed",
      currentStep: null,
      verdict: "regressed",
      diagnosticsRunId: null,
      evaluationRunId: null,
      benchmarkId: null,
      summary: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "",
    },
    ...overrides,
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <DeploymentGatePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  discoveredModelsMock.mockReturnValue({ isLoading: false, data: [makeModel()] });
  updateMutateAsync.mockReset().mockResolvedValue({});
  runMutateAsync.mockReset().mockResolvedValue({});
  toastSuccess.mockClear();
  toastError.mockClear();
  navigateMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DeploymentGatePage", () => {
  it("renders model link, backend version, status, verdict, and disables automation for an unroutable model", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "qwen" })).toHaveAttribute(
      "href",
      "/deployment-gate/models/m1",
    );
    expect(screen.getByText("vLLM 0.11.0")).toBeInTheDocument();
    expect(screen.getByText(/无专属路由|No dedicated route/)).toBeInTheDocument();
    expect(screen.getByText(/性能退化|Regressed/)).toBeInTheDocument();
    // (d) unroutable → automation switch must be disabled server-side rejects it.
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("(a) surfaces a toast and routes to the detail page when enabling automation is rejected (400)", async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: "m2",
      status: "new",
      automationEnabled: false,
    });
    discoveredModelsMock.mockReturnValue({ isLoading: false, data: [model] });
    updateMutateAsync.mockRejectedValueOnce(new Error("Model is not routable"));

    renderPage();
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeDisabled();
    await user.click(toggle);

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({ automationEnabled: true }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toMatch(
      /请先在详情页完成自动化配置|Finish the automation config/,
    );
    expect(navigateMock).toHaveBeenCalledWith("/deployment-gate/models/m2");
  });

  it("(b) toggling automation OFF succeeds without an error toast", async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: "m3",
      status: "active",
      automationEnabled: true,
    });
    discoveredModelsMock.mockReturnValue({ isLoading: false, data: [model] });
    updateMutateAsync.mockResolvedValueOnce({ ...model, automationEnabled: false });

    renderPage();
    const toggle = screen.getByRole("switch");
    await user.click(toggle);

    await waitFor(() =>
      expect(updateMutateAsync).toHaveBeenCalledWith({ automationEnabled: false }),
    );
    expect(toastError).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("(c) surfaces a toast and routes to the detail page when run-now is rejected", async () => {
    const user = userEvent.setup();
    const model = makeModel({
      id: "m4",
      status: "active",
      automationEnabled: true,
    });
    discoveredModelsMock.mockReturnValue({ isLoading: false, data: [model] });
    runMutateAsync.mockRejectedValueOnce(new Error("boom"));

    renderPage();
    const runButton = screen.getByRole("button", { name: /立即运行|Run now/ });
    expect(runButton).not.toBeDisabled();
    await user.click(runButton);

    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError.mock.calls[0][0]).toContain("boom");
    expect(navigateMock).toHaveBeenCalledWith("/deployment-gate/models/m4");
  });

  it("(e) disables run-now when automation is not enabled", () => {
    const model = makeModel({
      id: "m5",
      status: "new",
      automationEnabled: false,
    });
    discoveredModelsMock.mockReturnValue({ isLoading: false, data: [model] });

    renderPage();
    const runButton = screen.getByRole("button", { name: /立即运行|Run now/ });
    expect(runButton).toBeDisabled();
  });
});
