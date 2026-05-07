import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { AiDiagnosisSection } from "./AiDiagnosisSection";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => ({})),
    post: vi.fn(async () => ({ ok: true, latencyMs: 123, error: null })),
    del: vi.fn(async () => null),
  },
}));

function r(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("AiDiagnosisSection", () => {
  it("validates form before submit", async () => {
    r(<AiDiagnosisSection />);
    const save = await screen.findByRole("button", { name: /保存|save/i });
    await userEvent.click(save);
    // zod URL validation should report on baseUrl ("Invalid URL format" via global errorMap)
    const errorEls = await screen.findAllByText(/url|URL/i);
    expect(errorEls.length).toBeGreaterThan(0);
  });
});
