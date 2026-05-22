import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { AiDiagnosisCard } from "../AiDiagnosisCard";

let postCallCount = 0;
vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => ({
      id: "p1",
      baseUrl: "https://x",
      model: "m",
      enabled: true,
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-01T00:00:00Z",
    })),
    post: vi.fn(async () => {
      postCallCount += 1;
      return {
        findings: [
          { severity: "info", title: `gen-${postCallCount}`, rootCause: "ok", recommendations: [] },
        ],
        generatedAt: new Date().toISOString(),
        runIdsHash: `h${postCallCount}`,
        fromCache: false,
      };
    }),
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

describe("AiDiagnosisCard cache hint behavior", () => {
  it("re-clicking refresh produces a fresh request (no client-side cache)", async () => {
    r(<AiDiagnosisCard connectionId="c1" profileSlug="default" range="30d" runIds={["r1"]} />);
    await userEvent.click(await screen.findByRole("button", { name: /生成|generate/i }));
    expect(await screen.findByText(/gen-1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /刷新|refresh/i }));
    expect(await screen.findByText(/gen-2/)).toBeInTheDocument();
  });
});
