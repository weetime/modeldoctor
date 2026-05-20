import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const createMutate = vi.fn(async (body: unknown) => ({ id: "new", ...(body as object) }));
const updateMutate = vi.fn(async (vars: { id: string; body: unknown }) => ({
  id: vars.id,
  ...(vars.body as object),
}));
const discoverMutate = vi.fn();
let discoverIsPending = false;

vi.mock("./queries", () => ({
  useCreateConnection: () => ({
    mutateAsync: createMutate,
    isPending: false,
  }),
  useUpdateConnection: () => ({
    mutateAsync: updateMutate,
    isPending: false,
  }),
  useDiscoverConnection: () => ({
    mutateAsync: discoverMutate,
    isPending: discoverIsPending,
  }),
  useVerifyKind: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// ConnectionSheet renders a Prometheus-datasource <Select> for kind=model/gateway.
// Fixture: one default datasource + one alternate so the (默认) suffix test works.
// Also stub DatasourceSheet query hooks (rendered via the register CTA).
vi.mock("@/features/prometheus-datasources/queries", () => ({
  useDatasources: () => ({
    data: [
      {
        id: "ds-default",
        name: "default-prom",
        baseUrl: "http://prom:9090",
        bearerPreview: "",
        customHeaders: "",
        isDefault: true,
        consumersCount: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "ds-alt",
        name: "secondary-prom",
        baseUrl: "http://prom2:9090",
        bearerPreview: "",
        customHeaders: "",
        isDefault: false,
        consumersCount: 0,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ],
  }),
  useCreateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// SubscribersSection (rendered in edit mode) reads from React Query hooks.
// Stub them out so the sheet test doesn't need a QueryClientProvider.
vi.mock("@/features/alerts/queries", () => ({
  useSubscribers: () => ({ data: [], isLoading: false }),
  useCreateSubscriber: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSubscriber: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/features/notifications/queries", () => ({
  useChannels: () => ({ data: [] }),
}));

let mockUserRoles: string[] = ["admin"];
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: <T,>(selector: (s: { user: { roles: string[] } }) => T) =>
    selector({ user: { roles: mockUserRoles } }),
}));

type CapturedDatasourceSheetProps = {
  open: boolean;
  mode: { kind: string; initial?: { baseUrl?: string; name?: string } };
  onSaved?: (ds: { id: string; [k: string]: unknown }) => void;
};
let lastDatasourceSheetProps: CapturedDatasourceSheetProps | null = null;
vi.mock("@/features/prometheus-datasources/DatasourceSheet", () => ({
  DatasourceSheet: (props: CapturedDatasourceSheetProps) => {
    lastDatasourceSheetProps = props;
    // Render nothing — we just want to observe props and let tests call onSaved.
    return null;
  },
}));

import { ConnectionSheet } from "./ConnectionSheet";

async function fillBaseFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^name\b/i), "n1");
  await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
  await user.type(screen.getByLabelText(/api key/i), "sk-1");
  await user.type(screen.getByLabelText(/^model\b/i), "m1");
}

const EXISTING: ConnectionPublic = {
  id: "c1",
  userId: "u1",
  kind: "model",
  name: "preexisting",
  baseUrl: "http://old.test",
  apiKeyPreview: "sk-...wxyz",
  model: "old-model",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: null,
  category: "chat",
  tags: ["vLLM"],
  createdAt: "2026-04-26T14:22:00Z",
  updatedAt: "2026-04-26T14:22:00Z",
  prometheusDatasourceId: null,
  prometheusDatasource: null,
  serverKind: null,
  evaluationProfileId: null,
  evaluationProfile: null,
};

describe("ConnectionSheet (create mode)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("requires a category before save", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    expect(screen.getAllByText(/category|分类/i).length).toBeGreaterThan(0);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("creates a connection with selected category and entered tags", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "vLLM{Enter}");
    await user.type(tagInput, "production{Enter}");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.name).toBe("n1");
    expect(arg.baseUrl).toBe("http://x.test");
    expect(arg.apiKey).toBe("sk-1");
    expect(arg.model).toBe("m1");
    expect(arg.category).toBe("chat");
    expect(arg.tags).toEqual(["vLLM", "production"]);
  });

  it("removing a chip drops the tag", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    const tagInput = screen.getByLabelText(/^tags$/i);
    await user.type(tagInput, "x{Enter}");
    await user.type(tagInput, "y{Enter}");

    await user.click(screen.getByRole("button", { name: /remove tag x|移除标签 x/i }));

    expect(screen.queryByText("x")).not.toBeInTheDocument();
    expect(screen.getByText("y")).toBeInTheDocument();
  });

  it("submits tokenizerHfId when filled", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    await user.type(screen.getByLabelText(/tokenizer/i), "Qwen/Qwen2.5-0.5B-Instruct");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.tokenizerHfId).toBe("Qwen/Qwen2.5-0.5B-Instruct");
  });

  it("submits null when tokenizerHfId left empty", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    // Leave tokenizer field blank (default is "")
    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.tokenizerHfId).toBeNull();
  });

  it("creates with prometheusDatasourceId=undefined (let server auto-fill default) when user does not touch the picker", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    // For new connections, leaving the picker untouched MUST send `undefined`
    // (not null) so the API picks the org-default datasource server-side.
    expect(arg.prometheusDatasourceId).toBeUndefined();
  });

  it("submits the chosen prometheusDatasourceId when user picks a non-default option", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    await user.click(screen.getByRole("combobox", { name: /Metrics source|指标源/i }));
    await user.click(screen.getByRole("option", { name: /^secondary-prom$/ }));

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.prometheusDatasourceId).toBe("ds-alt");
  });

  it("submits prometheusDatasourceId=null when user picks a datasource then switches to 'Not bound'", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await fillBaseFields(user);

    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    // The picker defaults to showing "Not bound" (since the form value is
    // undefined → server auto-fills). To exercise the explicit-unbind path,
    // first pick a real datasource, then switch back to Not bound.
    const dsCombo = screen.getByRole("combobox", { name: /Metrics source|指标源/i });
    await user.click(dsCombo);
    await user.click(screen.getByRole("option", { name: /^secondary-prom$/ }));
    await user.click(dsCombo);
    await user.click(screen.getByRole("option", { name: /Not bound|不绑定/ }));

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const arg = createMutate.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.prometheusDatasourceId).toBeNull();
  });

  it("does NOT render the Metrics source picker for kind=alertmanager", async () => {
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.click(screen.getByRole("combobox", { name: /^kind|^类型/i }));
    await user.click(screen.getByRole("option", { name: /^Alertmanager$/i }));

    // alertmanager has no metrics datasource binding — picker must be hidden.
    expect(
      screen.queryByRole("combobox", { name: /Metrics source|指标源/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ConnectionSheet (edit mode)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("disables apiKey field by default and OMITS apiKey from the PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const apiKeyInput = screen.getByLabelText(/^api key$/i) as HTMLInputElement;
    expect(apiKeyInput).toBeDisabled();
    expect(apiKeyInput.placeholder).toBe(EXISTING.apiKeyPreview);

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { id, body } = updateMutate.mock.calls[0][0] as {
      id: string;
      body: Record<string, unknown>;
    };
    expect(id).toBe("c1");
    expect(body).not.toHaveProperty("apiKey");
    expect(body.name).toBe("preexisting");
    expect(body.baseUrl).toBe("http://old.test");
  });

  it("Reset apiKey toggle enables the field and INCLUDES apiKey in PATCH body", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /reset api key|重新设置/i });
    await user.click(checkbox);

    const apiKeyInput = screen.getByLabelText(/^api key\b/i) as HTMLInputElement;
    expect(apiKeyInput).not.toBeDisabled();
    await user.type(apiKeyInput, "sk-NEW");

    await user.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const { body } = updateMutate.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(body.apiKey).toBe("sk-NEW");
  });
});

describe("ConnectionSheet — serverKind dropdown", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("renders the serverKind dropdown", () => {
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    // The label text is "Engine" (en-US) or "推理引擎" (zh-CN)
    expect(screen.getAllByText(/^Engine$|^推理引擎$/i).length).toBeGreaterThan(0);
  });
});

describe("ConnectionSheet — Discover region", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    discoverMutate.mockReset();
    discoverIsPending = false;
  });

  it("disables Discover button when baseUrl is empty", () => {
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    const btn = screen.getByRole("button", { name: /Discover|自动发现/i });
    expect(btn).toBeDisabled();
  });

  it("auto-runs Discover after a successful Parse & fill from cURL", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "x" },
        category: { value: "chat", confidence: "guess", evidence: "x" },
        suggestedTags: { values: ["vllm"], confidence: "guess", evidence: "x" },
        prometheusUrl: { value: "http://x.test", confidence: "likely", evidence: "x" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    // Open the cURL import accordion + paste a curl. There is no longer a
    // "Parse & fill" button — the textarea auto-parses on change with a 400ms
    // debounce, so we just paste and wait for Discover to fire.
    await user.click(screen.getByText(/Import from cURL|从 cURL 导入/i));
    const curlBox = screen.getByPlaceholderText(/curl|^粘贴/i);
    await user.click(curlBox);
    await user.paste(
      `curl http://x.test/v1/chat/completions -H "Authorization: Bearer sk-1" -H "x-route: r1"`,
    );

    await waitFor(
      () => {
        expect(discoverMutate).toHaveBeenCalledWith({
          baseUrl: "http://x.test",
          apiKey: "sk-1",
          customHeaders: "x-route: r1",
        });
      },
      { timeout: 2000 },
    );
  });

  it("forwards customHeaders to the mutation (Higress routing case)", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["qwen-72b"], confidence: "certain", evidence: "x" },
        category: { value: "chat", confidence: "guess", evidence: "x" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "x" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/api base url/i), "http://gateway:8000");
    await user.type(screen.getByLabelText(/api key/i), "sk-test");
    await user.type(
      screen.getByLabelText(/custom headers|自定义请求头/i),
      "x-higress-llm-model: qwen-72b",
    );

    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));

    await waitFor(() => {
      expect(discoverMutate).toHaveBeenCalledWith({
        baseUrl: "http://gateway:8000",
        apiKey: "sk-test",
        customHeaders: "x-higress-llm-model: qwen-72b",
      });
    });
  });

  it("Discover success → silently auto-applies inferred fields (no banner)", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "metric prefix vllm:" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "/v1/models" },
        category: { value: "chat", confidence: "guess", evidence: "default" },
        suggestedTags: { values: ["vllm", "chat", "8b"], confidence: "guess", evidence: "..." },
        prometheusUrl: {
          value: "http://x",
          confidence: "likely",
          evidence: "engine exposes /metrics",
        },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/api base url/i), "http://x");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));

    // Auto-applies into the form — no "请确认" banner, no Apply button.
    await waitFor(() => {
      expect(screen.getByLabelText(/^model\b/i)).toHaveValue("llama-3-8b");
    });
    expect(screen.queryByText(/请确认|please verify/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply All|一键应用/i })).not.toBeInTheDocument();
  });

  it("shows SSRF warning banner on Cloud-metadata error", async () => {
    const user = userEvent.setup();
    discoverMutate.mockRejectedValue(new Error("Cloud metadata endpoint blocked"));
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://169.254.169.254");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));
    await waitFor(() => {
      expect(screen.getByText(/安全|security/i)).toBeInTheDocument();
    });
  });

  it("shows generic error banner on other failures", async () => {
    const user = userEvent.setup();
    discoverMutate.mockRejectedValue(new Error("Network error"));
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));
    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  it("zero-result banner: details list evidence + failed probes (always-open)", async () => {
    const user = userEvent.setup();
    // Zero detected fields → banner is shown (success/partial cases auto-apply
    // and surface a toast instead).
    discoverMutate.mockResolvedValue({
      health: {
        durationMs: 100,
        probesAttempted: 4,
        probesFailed: [
          { probe: "metrics", reason: "HTTP 404" },
          { probe: "health", reason: "no health endpoint (tried /health and /healthz)" },
        ],
        warnings: ["apiKey was provided but /v1/models returned 401 — verify the key is valid"],
      },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no metrics, no /v1/models" },
        models: { values: [], confidence: "unknown", evidence: "endpoint unreachable" },
        category: { value: null, confidence: "unknown", evidence: "no models" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "no signal" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "no /metrics" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));

    // Zero-result message visible
    await waitFor(() => {
      expect(screen.getByText(/手动填写|fill manually/i)).toBeInTheDocument();
    });

    // Details panel is open by default — evidence + probes + warnings visible
    expect(screen.getByText(/no metrics, no \/v1\/models/i)).toBeInTheDocument();
    expect(screen.getByText(/metrics: HTTP 404/i)).toBeInTheDocument();
    expect(screen.getByText(/no health endpoint/i)).toBeInTheDocument();
    expect(
      screen.getByText(/apiKey was provided but \/v1\/models returned 401/i),
    ).toBeInTheDocument();
  });

  it("zero-result banner can be dismissed via the X button", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "x" },
        models: { values: [], confidence: "unknown", evidence: "x" },
        category: { value: null, confidence: "unknown", evidence: "x" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "x" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));
    await waitFor(() => {
      expect(screen.getByText(/手动填写|fill manually/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Dismiss discover result|关闭探测结果/i }));
    expect(screen.queryByText(/手动填写|fill manually/i)).not.toBeInTheDocument();
  });

  it("renders no-results banner when nothing inferred", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: {
        durationMs: 50,
        probesAttempted: 4,
        probesFailed: ["models", "metrics"],
        warnings: [],
      },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no signal" },
        models: { values: [], confidence: "unknown", evidence: "endpoint unreachable" },
        category: { value: null, confidence: "unknown", evidence: "no models" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "no signal" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "no /metrics" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));
    await waitFor(() => {
      expect(screen.getByText(/手动填写|fill manually/i)).toBeInTheDocument();
    });
  });
});

describe("ConnectionSheet — Discover auto-apply + dirty preservation", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
    discoverMutate.mockReset();
    discoverIsPending = false;
  });

  it("auto-applies inferred fields into the create form (no button click)", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["llama-3-8b"], confidence: "certain", evidence: "x" },
        category: { value: "chat", confidence: "guess", evidence: "x" },
        suggestedTags: { values: ["vllm", "chat"], confidence: "guess", evidence: "x" },
        prometheusUrl: { value: "http://prom:9090", confidence: "likely", evidence: "x" },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);
    await user.type(screen.getByLabelText(/api base url/i), "http://x.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/^model\b/i)).toHaveValue("llama-3-8b");
    });
    // The legacy `prometheusUrl` form input is gone. In the success path
    // the DiscoverResultBanner does NOT render either (see runDiscover —
    // banner only mounts when `countFilledFields === 0`). The inferred
    // prometheusUrl is still carried through the contract for the
    // zero-result diagnostic view; see the next test for that path.
    expect(screen.queryByText(/请确认|please verify/i)).not.toBeInTheDocument();
  });

  it("zero-results banner surfaces the prometheusUrl evidence row (e.g. 'no /metrics')", async () => {
    // Banner mounts only when ALL inferred fields are empty — that's the
    // pure-diagnostic path. PR #199 kept inferred.prometheusUrl in the
    // contract precisely so this row is still informative; lock that
    // guarantee here so a future cleanup can't silently drop it.
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 80, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: null, confidence: "unknown", evidence: "no server header" },
        models: { values: [], confidence: "unknown", evidence: "/v1/models 404" },
        category: { value: null, confidence: "unknown", evidence: "no signal" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "n/a" },
        // Matches the actual evidence string the backend's prometheus-url
        // inferrer emits when /metrics is unreachable — see
        // apps/api/.../discovery/inference/prometheus-url.ts.
        prometheusUrl: {
          value: null,
          confidence: "unknown",
          evidence: "no /metrics endpoint detected",
        },
      },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />);

    await user.type(screen.getByLabelText(/api base url/i), "http://nothing-here.test");
    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));

    // Banner mounts with the diagnostic table; the prometheusUrl row's
    // evidence must surface so the user sees WHY metric inference failed.
    await waitFor(() => {
      expect(screen.getByText(/no \/metrics endpoint detected/i)).toBeInTheDocument();
    });
  });

  it("auto-apply preserves user-modified (dirty) model field in edit mode", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      health: { durationMs: 100, probesAttempted: 4, probesFailed: [], warnings: [] },
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["server-suggested-model"], confidence: "certain", evidence: "x" },
        category: { value: "chat", confidence: "guess", evidence: "x" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
        prometheusUrl: { value: null, confidence: "unknown", evidence: "x" },
      },
    });
    render(
      <ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing: EXISTING }} />,
    );

    // User edits the model field manually before Discover
    const modelInput = screen.getByLabelText(/^model\b/i);
    await user.clear(modelInput);
    await user.type(modelInput, "user-changed-model");

    await user.click(screen.getByRole("button", { name: /Discover|自动发现/i }));
    // Wait for the auto-apply to complete by asserting a non-dirty field WAS
    // overwritten (serverKind dropdown shows the inferred label).
    await waitFor(() => {
      expect(screen.getAllByText(/^vLLM$/i).length).toBeGreaterThan(0);
    });

    // Dirty field stays at user-edited value (not overwritten).
    expect(modelInput).toHaveValue("user-changed-model");
  });
});

describe("ConnectionSheet (unified form stack)", () => {
  beforeEach(() => {
    createMutate.mockClear();
    updateMutate.mockClear();
  });

  it("renders red asterisks on required fields (Name / API Base URL / API Key / Model / Category)", () => {
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    const stars = screen.getAllByText("*", { selector: "span" });
    expect(stars.length).toBeGreaterThanOrEqual(5);
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    const nameInput = screen.getByLabelText(/^Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
});

describe("Discover register CTA", () => {
  beforeEach(() => {
    mockUserRoles = ["admin"];
    discoverMutate.mockReset();
    lastDatasourceSheetProps = null;
  });

  function mockDiscoverWithProm(url: string | null) {
    discoverMutate.mockResolvedValue({
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["m1"], confidence: "certain", evidence: "x" },
        category: { value: null, confidence: "unknown", evidence: "x" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
        prometheusUrl: { value: url, confidence: "likely", evidence: "x" },
      },
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
    });
  }

  it("shows the pill on the auto-apply path when inferred URL is unregistered", async () => {
    const user = userEvent.setup();
    discoverMutate.mockResolvedValue({
      inferred: {
        serverKind: { value: "vllm", confidence: "certain", evidence: "x" },
        models: { values: ["m1"], confidence: "certain", evidence: "x" },
        category: { value: null, confidence: "unknown", evidence: "x" },
        suggestedTags: { values: [], confidence: "unknown", evidence: "x" },
        prometheusUrl: {
          value: "http://discovered-prom:9090",
          confidence: "likely",
          evidence: "x",
        },
      },
      health: { durationMs: 50, probesAttempted: 4, probesFailed: [], warnings: [] },
    });
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => {
      expect(screen.getByText(/推断到|Detected/)).toBeInTheDocument();
      expect(screen.getByText(/http:\/\/discovered-prom:9090/)).toBeInTheDocument();
    });
  });

  it("hides the pill when the inferred URL is already registered", async () => {
    const user = userEvent.setup();
    // Mocked datasources list (top of file) already contains baseUrl
    // "http://prom:9090" with id "ds-default". Use that exact URL so
    // dup-check fires.
    mockDiscoverWithProm("http://prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => {
      expect(discoverMutate).toHaveBeenCalled();
    });
    expect(screen.queryByText(/推断到|Detected/)).not.toBeInTheDocument();
  });

  it("hides the pill when the inferred URL only differs by trailing slash / case", async () => {
    // Fixture stores "http://prom:9090". Discover returns the same host with
    // a trailing slash AND uppercase scheme — normalizeBaseUrl should still
    // match so the dup-check fires.
    const user = userEvent.setup();
    mockDiscoverWithProm("HTTP://Prom:9090/");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => {
      expect(discoverMutate).toHaveBeenCalled();
    });
    expect(screen.queryByText(/推断到|Detected/)).not.toBeInTheDocument();
  });

  it("hides the pill when a datasource is already bound", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    const existing: ConnectionPublic = { ...EXISTING, prometheusDatasourceId: "ds-default" };
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "edit", existing }} />, {
      wrapper: Wrapper,
    });
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(discoverMutate).toHaveBeenCalled());
    expect(screen.queryByText(/推断到|Detected/)).not.toBeInTheDocument();
  });

  it("hides the pill for non-admin users", async () => {
    const user = userEvent.setup();
    mockUserRoles = []; // viewer
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(discoverMutate).toHaveBeenCalled());
    expect(screen.queryByText(/推断到|Detected/)).not.toBeInTheDocument();
  });

  it("opens DatasourceSheet pre-populated with the inferred URL + derived name", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(screen.getByText(/推断到|Detected/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /注册为数据源|register as datasource/i }));
    await waitFor(() => {
      expect(lastDatasourceSheetProps?.open).toBe(true);
      expect(lastDatasourceSheetProps?.mode.kind).toBe("create");
      expect(lastDatasourceSheetProps?.mode.initial?.baseUrl).toBe("http://discovered-prom:9090");
      expect(lastDatasourceSheetProps?.mode.initial?.name).toBe("discovered-prom:9090");
    });
  });

  it("onSaved binds the new datasource id and hides the pill", async () => {
    const user = userEvent.setup();
    mockDiscoverWithProm("http://discovered-prom:9090");
    render(<ConnectionSheet open onOpenChange={() => {}} mode={{ kind: "create" }} />, {
      wrapper: Wrapper,
    });
    await fillBaseFields(user);
    await user.click(screen.getByRole("button", { name: /自动发现|auto.?discover|🔍/i }));
    await waitFor(() => expect(screen.getByText(/推断到|Detected/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /注册为数据源|register as datasource/i }));
    await waitFor(() => expect(lastDatasourceSheetProps?.onSaved).toBeDefined());
    // Simulate the sheet's save callback firing with the new row.
    lastDatasourceSheetProps?.onSaved?.({
      id: "ds-new",
      name: "discovered-prom:9090",
      baseUrl: "http://discovered-prom:9090",
    });
    // Pill goes away because (a) form id is now set and (b) inferred state cleared.
    await waitFor(() => expect(screen.queryByText(/推断到|Detected/)).not.toBeInTheDocument());
  });
});
