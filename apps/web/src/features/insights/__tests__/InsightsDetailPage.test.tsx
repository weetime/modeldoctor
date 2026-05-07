import { render } from "@testing-library/react";
import { describe, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { InsightsDetailPage } from "../InsightsDetailPage";

describe("InsightsDetailPage", () => {
  it("renders without crashing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/insights/c1?range=30d"]}>
            <Routes>
              <Route path="/insights/:connectionId" element={<InsightsDetailPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );
    // Loading skeleton should be present (no msw → both queries pending).
  });
});
