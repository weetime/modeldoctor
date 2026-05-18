import i18n from "@/lib/i18n";
import type { Benchmark, ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { RequestDetailsSection } from "../RequestDetailsSection";

vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
import { api } from "@/lib/api-client";

const CONNECTION: ConnectionPublic = {
  id: "c_emb",
  userId: "u_1",
  kind: "model",
  name: "bge-by-mis-tei",
  baseUrl: "http://gw",
  apiKeyPreview: "sk-...bc8d",
  model: "bge-m3-uZbs",
  customHeaders: "X-Trace: 1",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusUrl: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  evaluationProfileId: null,
  evaluationProfile: null,
};

function makeBenchmark(): Benchmark {
  return {
    id: "b_1",
    userId: "u_1",
    connectionId: "c_emb",
    connection: {
      id: "c_emb",
      name: "bge-by-mis-tei",
      model: "bge-m3-uZbs",
      baseUrl: "http://gw",
    },
    scenario: "gateway",
    tool: "vegeta",
    toolVersion: "12.11.0",
    name: "weetime-02",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: 1,
    driverHandle: null,
    params: {
      apiType: "embeddings",
      rate: 100,
      duration: 30,
      path: "/v1/embeddings",
      body: '{"model":"bge-m3-uZbs","input":"hello"}',
    },
    rawOutput: null,
    summaryMetrics: { latencies: { p95: 147 } },
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    logs: null,
    createdAt: "2026-05-06T00:00:00.000Z",
    startedAt: "2026-05-06T00:00:00.000Z",
    completedAt: "2026-05-06T00:00:30.000Z",
    baselineFor: null,
  };
}

function withProviders(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </I18nextProvider>
  );
}

describe("RequestDetailsSection", () => {
  it("renders URL with path appended, masked Bearer header, and pretty body", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb") return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error(`unexpected url ${url}`);
    });

    render(withProviders(<RequestDetailsSection benchmark={makeBenchmark()} />));

    await waitFor(() => {
      expect(screen.getByText("http://gw/v1/embeddings")).toBeInTheDocument();
    });
    // Display uses connection.apiKeyPreview, NOT the full plaintext apiKey.
    // The plaintext only goes onto the clipboard via Copy-cURL.
    expect(screen.getByText(/Authorization: Bearer sk-\.\.\.bc8d/)).toBeInTheDocument();
    expect(screen.queryByText(/Authorization: Bearer sk-secret/)).not.toBeInTheDocument();
    expect(screen.getByText(/X-Trace: 1/)).toBeInTheDocument();
    // body pretty-print contains both keys
    expect(screen.getByText(/"model": "bge-m3-uZbs"/)).toBeInTheDocument();
    expect(screen.getByText(/"input": "hello"/)).toBeInTheDocument();
  });

  it("copies a cURL command via clipboard when the button is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb") return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error("unexpected");
    });

    render(withProviders(<RequestDetailsSection benchmark={makeBenchmark()} />));

    await waitFor(() => screen.getByRole("button", { name: /cURL/i }));
    await userEvent.click(screen.getByRole("button", { name: /cURL/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain("curl -X POST 'http://gw/v1/embeddings'");
    expect(arg).toContain("-H 'Authorization: Bearer sk-secret'");
    expect(arg).toContain('-d \'{"model":"bge-m3-uZbs","input":"hello"}\'');
  });

  it("escapes single quotes in body when building cURL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb") return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error("unexpected");
    });

    const benchmark = makeBenchmark();
    benchmark.params = {
      ...benchmark.params,
      body: '{"input":"it\'s"}',
    };
    render(withProviders(<RequestDetailsSection benchmark={benchmark} />));
    await waitFor(() => screen.getByRole("button", { name: /cURL/i }));
    await userEvent.click(screen.getByRole("button", { name: /cURL/i }));

    const arg = writeText.mock.calls[0][0] as string;
    // The single quote is escaped using the POSIX 'foo'\''bar' idiom.
    expect(arg).toContain("'{\"input\":\"it'\\''s\"}'");
  });

  it("shows an error toast when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === "/api/connections/c_emb") return Promise.resolve(CONNECTION) as unknown as never;
      if (url === "/api/connections/c_emb/reveal-key")
        return Promise.resolve({ apiKey: "sk-secret" }) as unknown as never;
      throw new Error("unexpected");
    });

    // Spy on the toast.error helper.
    const toastModule = await import("sonner");
    const errorSpy = vi.spyOn(toastModule.toast, "error");

    render(withProviders(<RequestDetailsSection benchmark={makeBenchmark()} />));
    await waitFor(() => screen.getByRole("button", { name: /cURL/i }));
    await userEvent.click(screen.getByRole("button", { name: /cURL/i }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });
});
