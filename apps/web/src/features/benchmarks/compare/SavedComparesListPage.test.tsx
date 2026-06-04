import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
          stageLabels: { a: "baseline", b: "candidate" },
          baselineId: "a",
          context: null,
          classification: "internal",
          clientName: "Acme Corp",
          version: 1,
          narrative: null,
          narrativeAt: null,
          createdAt: "2026-05-12T00:00:00.000Z",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        {
          id: "sc2",
          userId: "u",
          name: "Study B",
          benchmarkIds: ["c", "d", "e"],
          stageLabels: { c: "v1", d: "v2", e: "v3" },
          baselineId: null,
          context: null,
          classification: "public",
          clientName: null,
          version: 1,
          narrative: { foo: 1 },
          narrativeAt: "2026-05-13T00:00:00.000Z",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      ],
    })),
    del: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <SavedComparesListPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("SavedComparesListPage", () => {
  it("renders saved compares as cards with stage labels and report status", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());

    // stage labels surfaced as chips
    expect(screen.getByText("baseline")).toBeInTheDocument();
    expect(screen.getByText("candidate")).toBeInTheDocument();
    // client name shown when present
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();

    // report-status badges: A has none, B has a generated narrative
    expect(screen.getByText("No report")).toBeInTheDocument();
    expect(screen.getByText("Report ready")).toBeInTheDocument();
  });

  it("filters by name, client, and stage label", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());

    const search = screen.getByPlaceholderText(/search/i);

    // by name
    await user.type(search, "Study B");
    expect(screen.queryByText("Study A")).not.toBeInTheDocument();
    expect(screen.getByText("Study B")).toBeInTheDocument();

    // by stage label
    await user.clear(search);
    await user.type(search, "baseline");
    expect(screen.getByText("Study A")).toBeInTheDocument();
    expect(screen.queryByText("Study B")).not.toBeInTheDocument();

    // by client name
    await user.clear(search);
    await user.type(search, "acme");
    expect(screen.getByText("Study A")).toBeInTheDocument();
    expect(screen.queryByText("Study B")).not.toBeInTheDocument();

    // no matches → empty state
    await user.clear(search);
    await user.type(search, "zzz-nope");
    expect(screen.queryByText("Study A")).not.toBeInTheDocument();
    expect(screen.queryByText("Study B")).not.toBeInTheDocument();
  });

  it("each card links to its detail page", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());
    const titleLink = screen.getByText("Study A").closest("a");
    expect(titleLink).toHaveAttribute("href", "/reports/sc1");
  });

  it("opens delete confirmation from the card menu", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText("Study A")).toBeInTheDocument());

    const menus = screen.getAllByRole("button", { name: /actions/i });
    await user.click(menus[0]);
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteItem);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });
});
