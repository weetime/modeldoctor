import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../queries", () => ({
  useCreateTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useAuthStore } from "@/stores/auth-store";
import { TemplateCreatePage } from "../TemplateCreatePage";

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("TemplateCreatePage", () => {
  it("hides the isOfficial checkbox for non-admin users", () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { user: { id: string; roles: string[] } | null }) => unknown) =>
        selector({ user: { id: "user-1", roles: ["user"] } }),
    );
    render(
      <Wrapper>
        <TemplateCreatePage />
      </Wrapper>,
    );
    // Both literal "official" text and the i18n key form should be absent
    expect(screen.queryByLabelText(/官方|official|create\.fields\.isOfficial/i)).toBeNull();
  });

  it("shows the isOfficial checkbox for admin users", () => {
    (useAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (s: { user: { id: string; roles: string[] } | null }) => unknown) =>
        selector({ user: { id: "admin-1", roles: ["admin"] } }),
    );
    render(
      <Wrapper>
        <TemplateCreatePage />
      </Wrapper>,
    );
    // The checkbox label uses i18n key "create.fields.isOfficial" or its translation
    expect(
      screen.getByText(/标记为官方模板|mark as official|create\.fields\.isOfficial/i),
    ).toBeInTheDocument();
  });

  it("renders red asterisk on the required Name label", () => {
    render(<TemplateCreatePage />, { wrapper: Wrapper });
    const labels = screen.getAllByText("*", { selector: "span" });
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows required error under Name when blurred while empty", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<TemplateCreatePage />, { wrapper: Wrapper });
    const nameInput = screen.getByLabelText(/Name/i);
    await user.click(nameInput);
    await user.tab();
    expect(await screen.findByText(/required/i)).toBeInTheDocument();
  });
});
