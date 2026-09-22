import "@/lib/i18n";
import type { DiscoveredModelPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const model: DiscoveredModelPublic = {
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
};

vi.mock("./queries", () => ({
  useDiscoveredModels: () => ({ isLoading: false, data: [model] }),
  useSources: () => ({ isLoading: false, data: [{ id: "s1" }] }),
  useUpdateDiscoveredModel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunDiscoveredModel: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { DeploymentGatePage } from "./DeploymentGatePage";

describe("DeploymentGatePage", () => {
  it("renders model link, backend version, status and verdict", () => {
    render(
      <MemoryRouter>
        <DeploymentGatePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "qwen" })).toHaveAttribute(
      "href",
      "/deployment-gate/models/m1",
    );
    expect(screen.getByText("vLLM 0.11.0")).toBeInTheDocument();
    expect(screen.getByText(/无专属路由|No dedicated route/)).toBeInTheDocument();
    expect(screen.getByText(/性能退化|Regressed/)).toBeInTheDocument();
  });
});
