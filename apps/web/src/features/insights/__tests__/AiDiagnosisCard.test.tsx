import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { AiDiagnosisCard } from "../AiDiagnosisCard";

vi.mock("@/lib/api-client", () => ({
  api: {
    // useLlmJudgeProvider() lists providers and picks the default.
    get: vi.fn(async () => ({
      items: [
        {
          id: "p1",
          name: "default",
          baseUrl: "https://x",
          model: "m",
          enabled: true,
          isDefault: true,
          apiKeyPreview: "sk-...abcd",
          createdAt: "2026-05-01T00:00:00Z",
          updatedAt: "2026-05-01T00:00:00Z",
        },
      ],
    })),
    post: vi.fn(async () => ({
      findings: [
        {
          severity: "critical",
          title: "TTFT 高",
          rootCause: "p95 1240ms",
          recommendations: ["预热"],
        },
      ],
      generatedAt: new Date().toISOString(),
      runIdsHash: "h",
      fromCache: false,
    })),
    put: vi.fn(),
    del: vi.fn(),
    patch: vi.fn(),
  },
}));

function r(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AiDiagnosisCard", () => {
  it("renders generate button when provider configured + has runs", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    expect(await screen.findByRole("button", { name: /生成|generate/i })).toBeInTheDocument();
  });

  it("renders findings after generate click", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    const btn = await screen.findByRole("button", { name: /生成|generate/i });
    await userEvent.click(btn);
    expect(await screen.findByText(/TTFT 高/)).toBeInTheDocument();
    expect(screen.getByText(/预热/)).toBeInTheDocument();
  });
});
