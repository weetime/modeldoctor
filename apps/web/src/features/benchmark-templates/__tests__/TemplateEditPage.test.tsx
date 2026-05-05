import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../queries", () => ({
  useTemplate: vi.fn(),
  useUpdateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useAuthStore } from "@/stores/auth-store";
import { TemplateEditPage } from "../TemplateEditPage";
import { useTemplate } from "../queries";

function Wrapper({
  children,
  route = "/benchmark-templates/abc",
}: { children: ReactNode; route?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/benchmark-templates/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const tpl = {
  id: "abc",
  name: "Mine",
  description: null,
  scenario: "inference" as const,
  tool: "guidellm" as const,
  config: {
    profile: "throughput",
    apiType: "chat",
    datasetName: "sharegpt",
    rateType: "constant",
  },
  isOfficial: false,
  createdBy: "user-1",
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("TemplateEditPage", () => {
  it("hides delete and shows readonly banner when current user is not the owner", () => {
    (useTemplate as ReturnType<typeof vi.fn>).mockReturnValue({ data: tpl, isLoading: false });
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { user: { id: string; roles: string[] } | null }) => unknown) =>
        selector({ user: { id: "someone-else", roles: ["user"] } }),
    );
    render(
      <Wrapper>
        <TemplateEditPage />
      </Wrapper>,
    );
    expect(
      screen.getByText(/不是此模板的所有者|read-only|edit\.readonlyBanner/i),
    ).toBeInTheDocument();
    // Delete button should not exist
    expect(screen.queryByText(/^删除$|^Delete$|actions\.delete/i)).toBeNull();
  });

  it("shows save and delete when the current user is the owner", () => {
    (useTemplate as ReturnType<typeof vi.fn>).mockReturnValue({ data: tpl, isLoading: false });
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { user: { id: string; roles: string[] } | null }) => unknown) =>
        selector({ user: { id: "user-1", roles: ["user"] } }),
    );
    render(
      <Wrapper>
        <TemplateEditPage />
      </Wrapper>,
    );
    expect(screen.getByText(/^保存$|^Save$|actions\.save/i)).toBeInTheDocument();
    expect(screen.getByText(/^删除$|^Delete$|actions\.delete/i)).toBeInTheDocument();
  });
});
