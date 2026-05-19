import type { ConnectionPublic } from "@modeldoctor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@/features/connections/queries", () => ({
  useConnections: vi.fn(() => ({ data: [], isLoading: false })),
  useConnection: vi.fn(() => ({ data: null })),
  useCreateConnection: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateConnection: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/features/connections/ConnectionSheet", () => ({
  ConnectionSheet: () => null,
}));

import { useConnections } from "@/features/connections/queries";
import { ConnectionPicker } from "../ConnectionPicker";

const conn: ConnectionPublic = {
  id: "c_1",
  userId: "u_1",
  kind: "model",
  name: "bge-by-mis-tei",
  baseUrl: "http://183.240.109.2:30888",
  apiKeyPreview: "sk-...bc8d",
  model: "gen-studio_bge-m3-uZbs",
  customHeaders: "",
  queryParams: "",
  category: "embeddings",
  tags: [],
  prometheusDatasourceId: null,
  prometheusDatasource: null,
  serverKind: null,
  tokenizerHfId: null,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  evaluationProfileId: null,
  evaluationProfile: null,
};

function withQc(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("ConnectionPicker", () => {
  it("dropdown option shows name + model + baseUrl on two visual lines", async () => {
    (useConnections as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [conn],
      isLoading: false,
    });
    render(withQc(<ConnectionPicker selectedConnectionId={null} onSelect={() => {}} />));
    // Open dropdown.
    await userEvent.click(screen.getByRole("combobox"));
    // Both name and model and baseUrl are present in the option.
    expect(await screen.findByText("bge-by-mis-tei")).toBeInTheDocument();
    expect(screen.getByText("gen-studio_bge-m3-uZbs")).toBeInTheDocument();
    expect(screen.getByText("http://183.240.109.2:30888")).toBeInTheDocument();
  });

  it("closed trigger renders only the model id", async () => {
    (useConnections as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [conn],
      isLoading: false,
    });
    render(withQc(<ConnectionPicker selectedConnectionId="c_1" onSelect={() => {}} />));
    // Trigger shows the model id (the first-class identifier in our system),
    // not the connection alias or baseUrl. Full picker option still shows all
    // three when the dropdown is open.
    const trigger = await screen.findByRole("combobox");
    expect(trigger).toHaveTextContent("gen-studio_bge-m3-uZbs");
    expect(trigger.textContent).not.toContain("http://");
    expect(trigger.textContent).not.toContain("bge-by-mis-tei");
  });
});
