import i18n from "@/lib/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { describe, expect, it } from "vitest";
import { InsightsDetailPage } from "../InsightsDetailPage";

describe("InsightsDetailPage", () => {
  it("renders without crashing (loading skeleton visible)", () => {
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
    // Both queries are pending (no msw) → loading skeleton should be in the DOM.
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("redirects /benchmarks/reports/:id → /insights/:id with search preserved", () => {
    function Probe() {
      const location = useLocation();
      return <div data-testid="probe">{location.pathname + location.search}</div>;
    }
    // Local Redirect mirrors RedirectToInsights in apps/web/src/router/index.tsx;
    // duplicated here to test the behavior without exporting an internal helper.
    function Redirect() {
      const { connectionId } = useParams<{ connectionId: string }>();
      const [sp] = useSearchParams();
      const qs = sp.toString();
      return <Navigate to={`/insights/${connectionId}${qs ? `?${qs}` : ""}`} replace />;
    }
    render(
      <MemoryRouter initialEntries={["/benchmarks/reports/c1?range=7d"]}>
        <Routes>
          <Route path="/benchmarks/reports/:connectionId" element={<Redirect />} />
          <Route path="/insights/:connectionId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("/insights/c1?range=7d");
  });
});
