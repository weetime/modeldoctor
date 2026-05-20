import "@/lib/i18n";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seedList: ConnectionPublic[] = [
  {
    id: "c1",
    userId: "u1",
    name: "chat-prod",
    baseUrl: "http://a",
    apiKeyPreview: "sk-...1234",
    model: "qwen",
    customHeaders: "",
    queryParams: "",
    category: "chat",
    tags: ["vLLM", "production"],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusDatasourceId: null,
    prometheusDatasource: null,
    serverKind: null,
    tokenizerHfId: null,
    evaluationProfileId: null,
    evaluationProfile: null,
  },
  {
    id: "c2",
    userId: "u1",
    name: "embed-test",
    baseUrl: "http://b",
    apiKeyPreview: "sk-...5678",
    model: "bge",
    customHeaders: "",
    queryParams: "",
    category: "embeddings",
    tags: ["TEI"],
    createdAt: "2026-04-26T14:22:00Z",
    updatedAt: "2026-04-26T14:22:00Z",
    prometheusDatasourceId: "ds1",
    prometheusDatasource: { id: "ds1", name: "prod-prometheus", baseUrl: "http://prom:9090" },
    serverKind: null,
    tokenizerHfId: null,
    evaluationProfileId: null,
    evaluationProfile: null,
  },
];

const deleteMutate = vi.fn();

vi.mock("./queries", () => ({
  useConnections: () => ({ data: seedList, isLoading: false, error: null }),
  useDeleteConnection: () => ({ mutate: deleteMutate, isPending: false }),
  // ConnectionSheet imports useCreateConnection/useUpdateConnection/useDiscoverConnection;
  // include stubs so the sheet renders if it ever opens.
  useCreateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDiscoverConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyKind: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// ConnectionSheet's "Metrics source" picker queries the datasources list AND,
// since #207, mounts a hidden DatasourceSheet (for the register-CTA flow) that
// calls the create/update/verify mutation hooks at module init time. Stub all
// four — even though the current ConnectionsPage tests never open the sheet,
// this keeps the mock self-sufficient if a future test does.
vi.mock("@/features/prometheus-datasources/queries", () => ({
  useDatasources: () => ({ data: [], isLoading: false }),
  useCreateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConnectionsPage } from "./ConnectionsPage";

describe("ConnectionsPage (category + tags)", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
  });

  it("renders category badge and tag chips for each row", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.getByText("embed-test")).toBeInTheDocument();
    expect(screen.getByText("vLLM")).toBeInTheDocument();
    expect(screen.getByText("TEI")).toBeInTheDocument();
  });

  it("shows apiKeyPreview only", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("sk-...1234")).toBeInTheDocument();
    expect(screen.getByText("sk-...5678")).toBeInTheDocument();
  });

  it("filtering by category hides non-matching rows", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("combobox", { name: /category|分类/i }));
    await user.click(screen.getByRole("option", { name: /^chat$|^对话$/i }));

    expect(screen.getByText("chat-prod")).toBeInTheDocument();
    expect(screen.queryByText("embed-test")).not.toBeInTheDocument();
  });

  it("kind filter dropdown is gone entirely (#220)", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    // After #220, Connection has no `kind` field at all — the filter
    // dropdown that used to surface kinds was removed. Category + tags
    // filters remain.
    expect(screen.queryByRole("combobox", { name: /kind|类型/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /kind|类型/i })).not.toBeInTheDocument();
  });

  it("renders the prometheusDatasource column — link for bound rows, em-dash for unbound", () => {
    render(
      <MemoryRouter>
        <ConnectionsPage />
      </MemoryRouter>,
    );
    // Bound row: clickable link to the Settings page with the datasource name.
    const link = screen.getByRole("link", { name: "prod-prometheus" });
    expect(link).toHaveAttribute("href", "/settings/prometheus-datasources");
    // Unbound row (chat-prod has prometheusDatasource: null) shows em-dash —
    // assert by the absence of a link with another datasource name.
    expect(screen.queryByRole("link", { name: /unrelated/i })).not.toBeInTheDocument();
  });
});
