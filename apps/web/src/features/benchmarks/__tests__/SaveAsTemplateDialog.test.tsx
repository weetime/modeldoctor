import "@/lib/i18n";
import type { Benchmark, BenchmarkTemplate } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveAsTemplateDialog } from "../SaveAsTemplateDialog";

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

function makeBenchmark(overrides: Partial<Benchmark> = {}): Benchmark {
  return {
    id: "b1",
    userId: "u1",
    connectionId: "c1",
    connection: null,
    scenario: "inference",
    tool: "guidellm",
    toolVersion: null,
    name: "my run",
    description: "desc text",
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: null,
    params: { foo: "bar" },
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    parentBenchmarkId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2026-04-30T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

describe("SaveAsTemplateDialog", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it("prefills name with `${benchmark.name} (template)` suffix", () => {
    render(
      <SaveAsTemplateDialog
        benchmark={makeBenchmark({ name: "vLLM run" })}
        onOpenChange={() => {}}
      />,
      { wrapper: Wrapper },
    );
    // The label resolves to "Name" (en-US) / "名称" (zh-CN) via benchmark-templates:create.fields.name.
    // getByLabelText sees "Name *" (includes aria-hidden asterisk in textContent), so we use a
    // prefix-anchored pattern to avoid matching "Description" but still catch "Name" and "名称".
    const nameInput = screen.getByLabelText(
      /^name|^名称|template name|模板名称/i,
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("vLLM run (template)");
  });

  it("submits with split tags and forwards scenario+tool+params from benchmark", async () => {
    const created: BenchmarkTemplate = {
      id: "tpl-1",
      name: "vLLM run (template)",
      description: "desc text",
      scenario: "inference",
      tool: "guidellm",
      config: { foo: "bar" },
      isOfficial: false,
      createdBy: "u1",
      tags: ["a", "b", "c"],
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    };
    vi.mocked(api.post).mockResolvedValue(created);
    const onOpenChange = vi.fn();

    render(
      <SaveAsTemplateDialog
        benchmark={makeBenchmark({ name: "vLLM run", params: { foo: "bar" } })}
        onOpenChange={onOpenChange}
      />,
      { wrapper: Wrapper },
    );

    await userEvent.type(screen.getByLabelText(/tags|标签/i), "a, b, c");
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/api/benchmark-templates",
        expect.objectContaining({
          name: "vLLM run (template)",
          description: "desc text",
          scenario: "inference",
          tool: "guidellm",
          config: { foo: "bar" },
          tags: ["a", "b", "c"],
          isOfficial: false,
        }),
      );
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("strips empty description from payload", async () => {
    vi.mocked(api.post).mockResolvedValue({} as BenchmarkTemplate);
    render(
      <SaveAsTemplateDialog
        benchmark={makeBenchmark({ description: null })}
        onOpenChange={() => {}}
      />,
      { wrapper: Wrapper },
    );
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("description");
  });

  it("shows inline error and keeps dialog open on mutation failure", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("boom"));
    const onOpenChange = vi.fn();
    render(<SaveAsTemplateDialog benchmark={makeBenchmark()} onOpenChange={onOpenChange} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    // Alert role appears with the localized generic error message.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toMatch(/save as template|保存为模板失败/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("renders nothing when benchmark is null", () => {
    const { container } = render(
      <SaveAsTemplateDialog benchmark={null} onOpenChange={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector("[role=dialog]")).toBeNull();
  });
});
