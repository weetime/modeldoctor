import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkCreatePage } from "../BenchmarkCreatePage";

const mockUseTemplate = vi.fn();
vi.mock("@/features/benchmark-templates/queries", () => ({
  useTemplate: (...args: unknown[]) => mockUseTemplate(...args),
  useTemplates: () => ({ data: { pages: [{ items: [], nextCursor: null }] }, isLoading: false }),
  useCreateTemplate: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/features/llm-judge-providers/queries", () => ({
  useLlmJudgeProviders: () => ({ data: [], isLoading: false }),
}));

const mockUseConnection = vi.fn();
vi.mock("@/features/connections/queries", () => ({
  useConnections: () => ({
    data: [{ id: "c1", name: "test-conn", baseUrl: "http://x", model: "m", category: "chat" }],
    isLoading: false,
  }),
  useConnection: (...args: unknown[]) => mockUseConnection(...args),
  useCreateConnection: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDiscoverConnection: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useVerifyKind: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const mockMutate = vi.fn();
vi.mock("../queries", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useCreateBenchmark: () => ({
      mutate: mockMutate,
      mutateAsync: mockMutate,
      isPending: false,
    }),
  };
});

function renderAt(initialEntry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <BenchmarkCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BenchmarkCreatePage", () => {
  beforeEach(() => {
    mockUseTemplate.mockReturnValue({ data: undefined, isError: false });
    mockUseConnection.mockReturnValue({ data: null });
    mockMutate.mockReset();
  });

  it("renders target, tool, name, description sections", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    // Endpoint + tool now collapse into a single "Target" card.
    expect(screen.getByText(/Target|目标/)).toBeInTheDocument();
    expect(screen.getAllByText(/Tool/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
  });

  it("disables submit when no connection selected", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const submit = screen.getByRole("button", { name: /Submit/i });
    expect(submit).toBeDisabled();
  });

  it("defaults to inference scenario when no ?scenario= param (tool select shows guidellm)", () => {
    renderAt("/benchmarks/new");
    // Inference is multi-tool (guidellm + evalscope + aiperf), so the
    // dropdown is rendered as a combobox with the default-selected value visible.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("narrows tool select to guidellm only when ?scenario=capacity", () => {
    renderAt("/benchmarks/new?scenario=capacity");
    // Capacity has a single tool (guidellm), so the dropdown is replaced by a
    // read-only label — there should be no combobox in the Tool section.
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/guidellm/i);
  });

  it("narrows tool select to vegeta only when ?scenario=gateway", () => {
    renderAt("/benchmarks/new?scenario=gateway");
    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/vegeta/i);
  });

  it("falls back to inference when ?scenario= is invalid", () => {
    renderAt("/benchmarks/new?scenario=foo");
    // Falls back to inference → multi-tool dropdown rendered.
    const toolCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(toolCombo).getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("renders VegetaParamsForm fields when ?scenario=gateway", () => {
    renderAt("/benchmarks/new?scenario=gateway");
    // VegetaParamsForm exposes a "Rate (req/s)" field that no other params
    // form has — distinctive enough to confirm the right subform mounted.
    expect(screen.getByLabelText(/Rate \(req\/s\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Duration \(s\)/i)).toBeInTheDocument();
    // GuidellmParamsForm's "Profile" field MUST NOT be present.
    expect(screen.queryByLabelText(/^Profile$/i)).not.toBeInTheDocument();
  });

  it("renders GuidellmParamsForm fields when ?scenario=capacity", () => {
    renderAt("/benchmarks/new?scenario=capacity");
    // GuidellmParamsForm exposes a "Profile" field that vegeta's form doesn't
    // — distinctive enough to confirm the right subform mounted.
    expect(screen.getByLabelText(/^Profile$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Request rate/i)).toBeInTheDocument();
    // VegetaParamsForm's "Rate (req/s)" field MUST NOT be present.
    expect(screen.queryByLabelText(/Rate \(req\/s\)/i)).not.toBeInTheDocument();
  });

  it("renders red asterisk on required Connection / Name labels", () => {
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    // <FormLabel required> renders text + a span containing "*"
    const labels = screen.getAllByText("*", { selector: "span" });
    expect(labels.length).toBeGreaterThanOrEqual(2); // connection + name
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BenchmarkCreatePage />, { wrapper: Wrapper });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });

  it("resets form when ?scenario= URL changes (regression for stale tool)", () => {
    // This test exercises the useEffect that calls form.reset() on scenario
    // change — the BenchmarkCreatePage instance stays mounted across the
    // URL change (no remount), so a stale `tool` would survive without the
    // reset. We trigger navigation programmatically inside the same
    // MemoryRouter tree to keep the page mounted.
    let navigateRef: ((to: string) => void) | null = null;
    function NavCapture() {
      const navigate = useNavigate();
      navigateRef = (to: string) => navigate(to);
      return null;
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/benchmarks/new?scenario=inference"]}>
          <NavCapture />
          <BenchmarkCreatePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Initial: inference → multi-tool combobox showing guidellm.
    const initialCombo = screen.getByRole("combobox", { name: /Tool/i });
    expect(within(initialCombo).getByText(/guidellm/i)).toBeInTheDocument();

    // Navigate to gateway in the same tree. The form.reset useEffect must
    // fire and switch the tool to vegeta (single-tool readonly indicator).
    act(() => {
      navigateRef?.("/benchmarks/new?scenario=gateway");
    });

    expect(screen.queryByRole("combobox", { name: /Tool/i })).not.toBeInTheDocument();
    const label = screen.getByLabelText(/Tool/i);
    expect(label).toHaveTextContent(/vegeta/i);
    // And the VegetaParamsForm should now be the rendered subform.
    expect(screen.getByLabelText(/Rate \(req\/s\)/i)).toBeInTheDocument();
  });

  it("prefills form when ?templateId= present in URL", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    // Wait for prefill effect to fire:
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
      expect(nameInput.value).toBe("preset");
    });
  });

  it("shows prefilled banner with clear-link button when templateId is set", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    expect(await screen.findByText(/prefilled from template|已从模板/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear link|清除关联/i })).toBeInTheDocument();
  });

  it("clear-link button strips templateId but keeps params", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    await screen.findByText(/prefilled from template|已从模板/i);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /clear link|清除关联/i }));
    // Banner gone…
    expect(screen.queryByText(/prefilled from template|已从模板/i)).not.toBeInTheDocument();
    // …but Name field still has "preset"
    const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
    expect(nameInput.value).toBe("preset");
  });

  it("submits with templateId from URL prefill in payload", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    mockMutate.mockResolvedValue({ id: "b-new", scenario: "inference", name: "preset" });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    // Wait for prefill so the Name field is populated.
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
      expect(nameInput.value).toBe("preset");
    });
    // Select the connection via ConnectionPicker — it's the first combobox in DOM order.
    const [connectionCombo] = screen.getAllByRole("combobox");
    await userEvent.click(connectionCombo);
    await userEvent.click(await screen.findByText("test-conn"));
    // Submit.
    const submit = screen.getByRole("button", { name: /Submit|提交/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    const payload = mockMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.templateId).toBe("tpl-1");
  });

  it("redirects URL scenario when template's scenario differs (URL prefill)", async () => {
    // Template is for gateway, but URL says scenario=inference. Page should
    // redirect URL to scenario=gateway so form state and submission stay
    // coherent with the visible page (single-source-of-truth = URL).
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "gateway",
        tool: "vegeta",
        config: { rate: 50, duration: 30 },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    // After redirect + re-apply, Vegeta-only "Rate (req/s)" field is mounted.
    await waitFor(() => {
      expect(screen.getByLabelText(/Rate \(req\/s\)/i)).toBeInTheDocument();
    });
    // And the prefilled banner should reflect the template name.
    expect(await screen.findByText(/prefilled from template|已从模板/i)).toBeInTheDocument();
  });

  it("submits with form scenario (not URL scenario) — onSubmit uses values", async () => {
    // Regression: previously onSubmit overrode `scenario` from URL, which
    // could disagree with the form's scenario in mid-redirect frames.
    // After the fix, payload.scenario must come from form values.
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    mockMutate.mockResolvedValue({ id: "b-new", scenario: "inference", name: "preset" });
    const { default: userEvent } = await import("@testing-library/user-event");
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
      expect(nameInput.value).toBe("preset");
    });
    const [connectionCombo] = screen.getAllByRole("combobox");
    await userEvent.click(connectionCombo);
    await userEvent.click(await screen.findByText("test-conn"));
    const submit = screen.getByRole("button", { name: /Submit|提交/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    const payload = mockMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.scenario).toBe("inference");
  });

  it("submits without templateId after clear-link is clicked", async () => {
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-1",
        name: "preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    mockMutate.mockResolvedValue({ id: "b-new", scenario: "inference", name: "preset" });

    const { default: userEvent } = await import("@testing-library/user-event");
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-1");
    await screen.findByText(/prefilled from template|已从模板/i);
    // Select the connection via ConnectionPicker — it's the first combobox in DOM order.
    const [connectionCombo] = screen.getAllByRole("combobox");
    await userEvent.click(connectionCombo);
    await userEvent.click(await screen.findByText("test-conn"));
    // Clear the template link.
    await userEvent.click(screen.getByRole("button", { name: /clear link|清除关联/i }));
    // Submit.
    const submit = screen.getByRole("button", { name: /Submit|提交/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    const payload = mockMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.templateId).toBeUndefined();
    // Prefilled params are still present after clearing the link.
    expect((payload.params as Record<string, unknown>).profile).toBe("throughput");
  });

  it("cascade clears template + params when connection category no longer matches", async () => {
    // Template targets chat connections only.
    mockUseTemplate.mockReturnValue({
      data: {
        id: "tpl-chat",
        name: "chat-only preset",
        description: null,
        scenario: "inference",
        tool: "guidellm",
        config: { profile: "throughput" },
        isOfficial: false,
        createdBy: null,
        tags: [],
        categories: ["chat"],
        createdAt: "2026-05-07T00:00:00.000Z",
        updatedAt: "2026-05-07T00:00:00.000Z",
      },
      isError: false,
    });
    // Connection is an embeddings endpoint — does NOT match the template.
    mockUseConnection.mockReturnValue({
      data: {
        id: "c-emb",
        name: "emb-conn",
        baseUrl: "http://x",
        model: "m",
        category: "embeddings",
      },
    });
    renderAt("/benchmarks/new?scenario=inference&templateId=tpl-chat");

    // After cascade fires, the prefilled name + params must be cleared so a
    // stale chat-style config can't be submitted against an embeddings model.
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Name|名称/i) as HTMLInputElement;
      expect(nameInput.value).toBe("");
    });
    // Banner gone (templateId reset).
    expect(screen.queryByText(/prefilled from template|已从模板/i)).not.toBeInTheDocument();
  });

  describe("agent scenario", () => {
    it("renders AgentParamsForm fields + tool-call/context-window hints when ?scenario=agent", () => {
      renderAt("/benchmarks/new?scenario=agent");
      // Domains multiselect (airline/retail/telecom).
      expect(screen.getByRole("checkbox", { name: "airline" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "retail" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "telecom" })).toBeInTheDocument();
      // Tier picker.
      expect(screen.getByRole("combobox", { name: /Tier|档位/i })).toBeInTheDocument();
      // Static pre-flight hints near the connection picker.
      expect(screen.getByText(/function calling/i)).toBeInTheDocument();
      expect(screen.getByText(/max-model-len/i)).toBeInTheDocument();
    });

    it("shows the Full-tier cost hint only after selecting Full", async () => {
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();
      renderAt("/benchmarks/new?scenario=agent");
      // Default (Standard-shaped) params: no cost hint yet.
      expect(screen.queryByText(/episodes/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole("combobox", { name: /Tier|档位/i }));
      await user.click(screen.getByRole("option", { name: /Full|全量/i }));
      expect(await screen.findByText(/episodes/i)).toBeInTheDocument();
    });

    it("submits scenario=agent/tool=tau2 with Standard tier params (numTrials=3, 3 deduped domains)", async () => {
      mockMutate.mockResolvedValue({ id: "b-new", scenario: "agent", name: "agent-run" });
      const { default: userEvent } = await import("@testing-library/user-event");
      const user = userEvent.setup();
      renderAt("/benchmarks/new?scenario=agent");

      // ConnectionPicker is the first combobox in DOM order (Target card sits
      // above the params card, which also renders comboboxes of its own).
      const [connectionCombo] = screen.getAllByRole("combobox");
      await user.click(connectionCombo);
      await user.click(await screen.findByText("test-conn"));

      await user.type(screen.getByLabelText(/Name|名称/i), "agent-run");

      // Explicitly (re-)pick Standard — fills numTasksPerDomain=20/numTrials=3.
      await user.click(screen.getByRole("combobox", { name: /Tier|档位/i }));
      await user.click(screen.getByRole("option", { name: /Standard|基本能力/i }));

      // Uncheck + recheck a domain: the resulting array must stay exactly the
      // 3 canonical domains with no duplicate entries (Set-based toggle).
      const retailCheckbox = screen.getByRole("checkbox", { name: "retail" });
      await user.click(retailCheckbox);
      await user.click(retailCheckbox);

      const submit = screen.getByRole("button", { name: /Submit|提交/i });
      await waitFor(() => expect(submit).not.toBeDisabled());
      await user.click(submit);
      await waitFor(() => expect(mockMutate).toHaveBeenCalled());

      const payload = mockMutate.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.scenario).toBe("agent");
      expect(payload.tool).toBe("tau2");
      const params = payload.params as { numTrials: number; domains: string[] };
      expect(params.numTrials).toBe(3);
      expect(params.domains).toHaveLength(3);
      expect(new Set(params.domains).size).toBe(3);
    });
  });
});
