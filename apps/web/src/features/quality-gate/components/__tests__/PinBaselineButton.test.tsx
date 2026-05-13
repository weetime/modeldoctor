import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PinBaselineButton } from "../PinBaselineButton";

vi.mock("../../queries", () => ({
  useEvaluation: vi.fn(),
  useSetBaseline: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEvaluation } from "../../queries";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function P({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

describe("PinBaselineButton", () => {
  it("renders 'Pin' button when evaluation has no baseline", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: null },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByRole("button", { name: /钉为 baseline/ })).toBeInTheDocument();
  });

  it("renders 'Pinned + Unpin' when this run is the pin", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: "r1" },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByText(/已钉为 baseline/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /解钉/ })).toBeInTheDocument();
  });

  it("renders 'Pin' (AlertDialog trigger) when another run is the pin", () => {
    (useEvaluation as never as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "e1", baselineRunId: "other-run" },
    });
    render(<PinBaselineButton evaluationId="e1" runId="r1" />, { wrapper: P });
    expect(screen.getByRole("button", { name: /钉为 baseline/ })).toBeInTheDocument();
  });
});
