import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { SavedComparesListPage } from "./SavedComparesListPage";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(async () => ({
      items: [
        {
          id: "sc1",
          userId: "u",
          name: "Study A",
          benchmarkIds: ["a", "b"],
          stageLabels: {},
          baselineId: null,
          context: null,
          narrative: null,
          narrativeAt: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
      ],
    })),
    del: vi.fn(),
  },
}));

describe("SavedComparesListPage", () => {
  it("renders saved compares with run count", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <SavedComparesListPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
