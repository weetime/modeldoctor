import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/lib/i18n";
import { useAuthStore } from "@/stores/auth-store";
import { MePage } from "./MePage";

function renderIt() {
  useAuthStore.setState({
    accessToken: "x",
    accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "u1",
      email: "a@b.c",
      roles: [],
      displayName: null,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
    },
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MePage />
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("MePage", () => {
  it("renders Profile + Password sections", () => {
    renderIt();
    expect(screen.getAllByText(/Profile|个人资料/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Password|密码/).length).toBeGreaterThan(0);
  });
});
