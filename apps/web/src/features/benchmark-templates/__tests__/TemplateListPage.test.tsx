import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../queries", () => ({
  useTemplates: vi.fn(),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { id: string; roles: string[] } | null }) => unknown) =>
    selector({ user: { id: "user-1", roles: ["user"] } }),
}));

import { TemplateListPage } from "../TemplateListPage";
import { useTemplates } from "../queries";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TemplateListPage", () => {
  it("renders official badge for official templates and orders official first", async () => {
    (useTemplates as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        items: [
          {
            id: "off",
            name: "Official",
            isOfficial: true,
            scenario: "inference",
            tool: "guidellm",
            createdBy: "admin-1",
            tags: [],
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: null,
            config: {},
          },
          {
            id: "mine",
            name: "Mine",
            isOfficial: false,
            scenario: "inference",
            tool: "guidellm",
            createdBy: "user-1",
            tags: [],
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            description: null,
            config: {},
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
    });
    render(
      <Wrapper>
        <TemplateListPage />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByText("Official")).toBeInTheDocument());
    expect(screen.getByText("Mine")).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html.indexOf("Official")).toBeLessThan(html.indexOf("Mine"));
  });

  it("shows empty-state copy when items array is empty", () => {
    (useTemplates as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { items: [], nextCursor: null },
      isLoading: false,
    });
    render(
      <Wrapper>
        <TemplateListPage />
      </Wrapper>,
    );
    expect(screen.getByText(/no templates yet|还没有模板|list\.empty\.title/i)).toBeInTheDocument();
  });
});
