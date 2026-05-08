import "@/lib/i18n";
import type { BenchmarkTemplate, ListBenchmarkTemplatesResponse } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrefillFromTemplatePopover } from "../PrefillFromTemplatePopover";

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

function tpl(overrides: Partial<BenchmarkTemplate> = {}): BenchmarkTemplate {
  return {
    id: "tpl-1",
    name: "vLLM single concurrency",
    description: "official low-load",
    scenario: "inference",
    tool: "guidellm",
    config: {},
    isOfficial: true,
    createdBy: null,
    tags: ["official"],
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    ...overrides,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("PrefillFromTemplatePopover", () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it("opens, lists templates filtered by current scenario", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [
        tpl({ id: "t1", name: "vLLM single" }),
        tpl({ id: "t2", name: "Internal gateway", tool: "vegeta" }),
      ],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    expect(await screen.findByText("vLLM single")).toBeInTheDocument();
    expect(screen.getByText("Internal gateway")).toBeInTheDocument();
    // Verify the api was called with scenario filter:
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining("scenario=inference")),
    );
  });

  it("filters items locally by search input", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [tpl({ id: "t1", name: "vLLM single" }), tpl({ id: "t2", name: "Internal gateway" })],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    await screen.findByText("vLLM single");
    const search = screen.getByPlaceholderText(/search templates|搜索模板/i);
    await userEvent.type(search, "vLLM");
    expect(screen.getByText("vLLM single")).toBeInTheDocument();
    expect(screen.queryByText("Internal gateway")).not.toBeInTheDocument();
  });

  it("shows empty state with manage link when no templates exist", async () => {
    vi.mocked(api.get).mockResolvedValue({
      items: [],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    render(<PrefillFromTemplatePopover scenario="inference" onPick={() => {}} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    expect(await screen.findByText(/no templates|还没有此场景/i)).toBeInTheDocument();
    const manage = screen.getByRole("link", { name: /manage templates|去模板库管理/i });
    expect(manage).toHaveAttribute("href", "/benchmark-templates?scenario=inference");
  });

  it("calls onPick with the full template object on click", async () => {
    const t1 = tpl({ id: "t1", name: "vLLM single" });
    vi.mocked(api.get).mockResolvedValue({
      items: [t1],
      nextCursor: null,
    } satisfies ListBenchmarkTemplatesResponse);

    const onPick = vi.fn();
    render(<PrefillFromTemplatePopover scenario="inference" onPick={onPick} />, {
      wrapper: Wrapper,
    });
    await userEvent.click(
      screen.getByRole("button", { name: /prefill from template|从模板预填/i }),
    );
    await userEvent.click(await screen.findByRole("option", { name: /vLLM single/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t1", name: "vLLM single" }));
  });
});
