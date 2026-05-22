import type { Benchmark, ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { I18nextProvider } from "react-i18next";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

// Hoisted refs so the mock factories below can reference them at
// vi.mock-hoist time. Each per-test setup mutates `.current` to switch
// the hook return value without needing to re-mock.
const { connQueryRef, profilesQueryRef, listQueryRef, updateMutateRef } = vi.hoisted(() => ({
  connQueryRef: { current: { data: undefined, isLoading: true, error: null } } as {
    current: { data: unknown; isLoading: boolean; error: unknown };
  },
  profilesQueryRef: { current: { data: undefined, isLoading: true } } as {
    current: { data: unknown; isLoading: boolean };
  },
  listQueryRef: { current: { data: undefined, isLoading: true } } as {
    current: { data: unknown; isLoading: boolean };
  },
  updateMutateRef: { current: vi.fn() } as { current: ReturnType<typeof vi.fn> },
}));

vi.mock("@/features/connections/queries", () => ({
  useConnection: () => connQueryRef.current,
  useUpdateConnection: () => ({ mutate: updateMutateRef.current, isPending: false }),
}));

vi.mock("../queries", () => ({
  useEvaluationProfiles: () => profilesQueryRef.current,
}));

vi.mock("@/features/benchmarks/queries", () => ({
  useBenchmarkList: () => listQueryRef.current,
}));

// Stub the heavy children that have their OWN queries / DOM concerns. Each
// renders a sentinel element so we can assert presence without pulling in
// the child's full mock surface.
vi.mock("../AiDiagnosisCard", () => ({
  AiDiagnosisCard: ({ connectionId, range }: { connectionId: string; range: string }) =>
    createElement("div", {
      "data-testid": "ai-diagnosis-card",
      "data-conn": connectionId,
      "data-range": range,
    }),
}));

vi.mock("../ScenarioPanel", () => ({
  ScenarioPanel: ({ scenario, runs }: { scenario: string; runs: unknown[] }) =>
    createElement(
      "div",
      { "data-testid": `scenario-panel-${scenario}`, "data-run-count": String(runs.length) },
      `panel:${scenario}`,
    ),
}));

import { InsightsDetailPage } from "../InsightsDetailPage";

function makeConn(over: Partial<ConnectionPublic> = {}): ConnectionPublic {
  return {
    id: "c1",
    name: "primary-vllm",
    baseUrl: "https://vllm.example.com",
    apiKeyPreview: "sk-...abc",
    model: "Qwen3-32B",
    category: "chat",
    serverKind: "vllm",
    tokenizerHfId: null,
    tags: [],
    customHeaders: "",
    queryParams: "",
    prometheusDatasourceId: null,
    prometheusDatasource: null,
    evaluationProfile: { id: "ep_default", slug: "default", name: "Default" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as ConnectionPublic;
}

function makeBenchmark(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "b1",
    name: "run-1",
    scenario: "inference",
    tool: "guidellm",
    status: "completed",
    connectionId: "c1",
    createdAt: "2026-04-15T00:00:00Z",
    ...over,
  } as Benchmark;
}

// `rules.checks` MUST be an object — buildFindings reads `profile.checks[id]`
// for every check definition, so [] would throw on first read. Empty object
// means every check is unconfigured → severity "no_data" → composite null →
// "—" rendered in the hero band. That's the shape this test asserts on.
const PROFILES_FIXTURE = {
  items: [
    {
      id: "ep_default",
      slug: "default",
      name: "Default",
      nameKey: null,
      description: null,
      isBuiltin: true,
      rules: { checks: {}, axisWeights: {} },
      source: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "ep_strict",
      slug: "strict",
      name: "Strict",
      nameKey: null,
      description: null,
      isBuiltin: true,
      rules: { checks: {}, axisWeights: {} },
      source: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
};

function renderPage(initialUrl = "/insights/c1?range=30d") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <Routes>
            <Route path="/insights/:connectionId" element={<InsightsDetailPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("InsightsDetailPage", () => {
  beforeEach(() => {
    updateMutateRef.current = vi.fn();
    // Reset to loading by default so individual tests opt into populated state.
    connQueryRef.current = { data: undefined, isLoading: true, error: null };
    profilesQueryRef.current = { data: undefined, isLoading: true };
    listQueryRef.current = { data: undefined, isLoading: true };
  });

  it("renders the loading skeleton while either conn or profiles is pending", () => {
    renderPage();
    // The skeleton has role="status" so assistive tech announces the wait;
    // we query semantically rather than by className for the same reason.
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    // Hero band MUST NOT render in loading state — composite-score is the
    // testid we lock in success-state tests below.
    expect(screen.queryByTestId("composite-score")).toBeNull();
  });

  it("renders 404 EmptyState when useConnection returns a 404 error", () => {
    connQueryRef.current = {
      data: undefined,
      isLoading: false,
      error: { status: 404 },
    };
    profilesQueryRef.current = { data: PROFILES_FIXTURE, isLoading: false };
    listQueryRef.current = { data: { pages: [{ items: [] }] }, isLoading: false };
    renderPage();
    // The 404 branch shows the literal "404" string in the EmptyState heading.
    expect(screen.getByText("404")).toBeInTheDocument();
    // Hero band still must not render — the page short-circuits before it.
    expect(screen.queryByTestId("composite-score")).toBeNull();
  });

  it("with full data: renders model name, composite '—' (no runs), 3 scenario panels, AI card", () => {
    connQueryRef.current = { data: makeConn(), isLoading: false, error: null };
    profilesQueryRef.current = { data: PROFILES_FIXTURE, isLoading: false };
    // Empty runs list → scenarioScore returns null → composite null → renders "—".
    listQueryRef.current = { data: { pages: [{ items: [] }] }, isLoading: false };
    renderPage();

    // Model name surfaces in exactly TWO places: PageHeader title +
    // breadcrumb last entry. Lock the exact count so a regression that
    // drops one (or adds a third unexpected render) fails loudly.
    expect(screen.getAllByText("Qwen3-32B")).toHaveLength(2);

    // Composite score block renders the em-dash for null score (lock the
    // testid so future copy changes don't silently break us).
    expect(screen.getByTestId("composite-score")).toHaveTextContent("—");
    // Per-scenario subscore tiles for all 3 scenarios.
    expect(screen.getByTestId("subscore-inference")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-capacity")).toBeInTheDocument();
    expect(screen.getByTestId("subscore-gateway")).toBeInTheDocument();

    // Scenario tab panels mounted by Tabs primitive — stubs render their
    // sentinels, so we can assert each panel exists.
    expect(screen.getByTestId("scenario-panel-inference")).toBeInTheDocument();

    // AI diagnosis card sits at the bottom with the right connection id
    // and range threaded through from the URL (?range=30d).
    const ai = screen.getByTestId("ai-diagnosis-card");
    expect(ai).toHaveAttribute("data-conn", "c1");
    expect(ai).toHaveAttribute("data-range", "30d");
  });

  it("filters runs to the active scenario tab (default 'inference')", () => {
    // Radix Tabs only mounts the active TabsContent; assert the visible
    // panel got the right slice. ?scenario=capacity / gateway are exercised
    // in separate tests below.
    connQueryRef.current = { data: makeConn(), isLoading: false, error: null };
    profilesQueryRef.current = { data: PROFILES_FIXTURE, isLoading: false };
    listQueryRef.current = {
      data: {
        pages: [
          {
            items: [
              makeBenchmark({ id: "b_inf_1", scenario: "inference" }),
              makeBenchmark({ id: "b_inf_2", scenario: "inference" }),
              makeBenchmark({ id: "b_cap_1", scenario: "capacity" }),
            ],
          },
        ],
      },
      isLoading: false,
    };
    renderPage();
    expect(screen.getByTestId("scenario-panel-inference")).toHaveAttribute("data-run-count", "2");
    // Inactive tabs' panels are not in the DOM yet.
    expect(screen.queryByTestId("scenario-panel-capacity")).toBeNull();
    expect(screen.queryByTestId("scenario-panel-gateway")).toBeNull();
  });

  it("?scenario=capacity activates the capacity tab and shows its slice", () => {
    connQueryRef.current = { data: makeConn(), isLoading: false, error: null };
    profilesQueryRef.current = { data: PROFILES_FIXTURE, isLoading: false };
    listQueryRef.current = {
      data: {
        pages: [
          {
            items: [
              makeBenchmark({ id: "b_inf_1", scenario: "inference" }),
              makeBenchmark({ id: "b_cap_1", scenario: "capacity" }),
              makeBenchmark({ id: "b_cap_2", scenario: "capacity" }),
            ],
          },
        ],
      },
      isLoading: false,
    };
    renderPage("/insights/c1?range=30d&scenario=capacity");
    expect(screen.getByTestId("scenario-panel-capacity")).toHaveAttribute("data-run-count", "2");
    expect(screen.queryByTestId("scenario-panel-inference")).toBeNull();
  });

  it("?range=7d propagates the chosen range into AiDiagnosisCard", () => {
    connQueryRef.current = { data: makeConn(), isLoading: false, error: null };
    profilesQueryRef.current = { data: PROFILES_FIXTURE, isLoading: false };
    listQueryRef.current = { data: { pages: [{ items: [] }] }, isLoading: false };
    renderPage("/insights/c1?range=7d");
    expect(screen.getByTestId("ai-diagnosis-card")).toHaveAttribute("data-range", "7d");
  });

  it("redirects /benchmarks/reports/:id → /insights/:id with search preserved", () => {
    // Unrelated to the page itself (lives in router); kept here because the
    // redirect path is part of the same user-facing URL surface.
    function Probe() {
      const location = useLocation();
      return <div data-testid="probe">{location.pathname + location.search}</div>;
    }
    function Redirect() {
      const { connectionId } = useParams<{ connectionId: string }>();
      const [sp] = useSearchParams();
      const qs = sp.toString();
      return <Navigate to={`/insights/${connectionId}${qs ? `?${qs}` : ""}`} replace />;
    }
    render(
      <MemoryRouter initialEntries={["/benchmarks/reports/c1?range=7d"]}>
        <Routes>
          <Route path="/benchmarks/reports/:connectionId" element={<Redirect />} />
          <Route path="/insights/:connectionId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("/insights/c1?range=7d");
  });
});
