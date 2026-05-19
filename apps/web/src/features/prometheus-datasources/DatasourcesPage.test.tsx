import "@/lib/i18n";
import { useAuthStore } from "@/stores/auth-store";
import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted is required for symbols referenced inside vi.mock factories —
// vi.mock is hoisted above all imports/top-level lets, so plain `const fn = vi.fn()`
// at module scope would be uninitialized when the factory runs.
const { deleteMutate, setDefaultMutate, toastSuccess, toastError } = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  setDefaultMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

let mockList: PrometheusDatasourcePublic[] = [];

vi.mock("./queries", () => ({
  useDatasources: () => ({
    data: mockList,
    isLoading: false,
    error: null,
  }),
  useDeleteDatasource: () => ({ mutateAsync: deleteMutate, isPending: false }),
  useSetDefaultDatasource: () => ({ mutateAsync: setDefaultMutate, isPending: false }),
  // Sheet imports — keep stubs so the sheet wouldn't crash if opened.
  useCreateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVerifyDatasource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { DatasourcesPage } from "./DatasourcesPage";

const TWO_ROW_FIXTURE: PrometheusDatasourcePublic[] = [
  {
    id: "ds1",
    name: "prom-prod",
    baseUrl: "https://prom.example.com",
    bearerPreview: "ey...x",
    customHeaders: "",
    isDefault: true,
    consumersCount: 3,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "ds2",
    name: "prom-staging",
    baseUrl: "https://prom-staging.example.com",
    bearerPreview: "",
    customHeaders: "",
    isDefault: false,
    consumersCount: 0,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  },
];

function asAdmin() {
  useAuthStore.setState({
    accessToken: "tok",
    accessTokenExpiresAt: null,
    user: {
      id: "u1",
      email: "admin@example.com",
      roles: ["admin"],
      displayName: null,
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
  });
}

function asViewer() {
  useAuthStore.setState({
    accessToken: "tok",
    accessTokenExpiresAt: null,
    user: {
      id: "u2",
      email: "viewer@example.com",
      roles: [],
      displayName: null,
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
  });
}

describe("DatasourcesPage", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
    setDefaultMutate.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    mockList = [];
    asAdmin();
  });

  it("renders empty state when no datasources exist", () => {
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    // Empty-state title is rendered.
    expect(
      screen.getByText(/no prometheus datasource|尚未配置 prometheus 数据源/i),
    ).toBeInTheDocument();
  });

  it("renders rows with default badge and consumers count", () => {
    mockList = TWO_ROW_FIXTURE;
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("prom-prod")).toBeInTheDocument();
    expect(screen.getByText("prom-staging")).toBeInTheDocument();
    // Anonymous badge for the bearer-less one
    expect(screen.getByText(/anonymous|匿名/i)).toBeInTheDocument();
    // Bearer badge for the one with a preview
    expect(screen.getByText(/^bearer$/i)).toBeInTheDocument();
    // Default appears twice: once as the table column header, once as the
    // badge on the default row. `getAllByText` is the assertion we want here.
    expect(screen.getAllByText(/^default$|^默认$/i).length).toBeGreaterThanOrEqual(2);
    // Consumers count
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides admin-only buttons for non-admin viewers", () => {
    asViewer();
    mockList = TWO_ROW_FIXTURE;
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    // "+ New datasource" CTA in the page header is admin-only.
    expect(screen.queryByText(/\+ 新增数据源|\+ new datasource/i)).toBeNull();
    // The "Set as default" button is admin-only; only the default badge remains.
    expect(screen.queryByText(/^set as default$|^设为默认$/i)).toBeNull();
    // No delete buttons — only em-dash placeholders in the action column.
    expect(screen.queryAllByLabelText(/delete|删除/i)).toHaveLength(0);
    // Table still renders rows in read-only mode.
    expect(screen.getByText("prom-prod")).toBeInTheDocument();
    expect(screen.getByText("prom-staging")).toBeInTheDocument();
  });

  it("admin sees the create CTA — positive control matching the viewer test above", () => {
    // Pair-test to F3 in the test audit: a permissive "queryByText" absence
    // assertion can silently degrade if the label string drifts (`+ 新增数据源`
    // → `新增数据源`). A matching positive admin-side `getByRole` lock the
    // label string at one place; if it drifts, both tests scream at once.
    mockList = TWO_ROW_FIXTURE;
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: /^\+ 新增数据源|\+ new datasource$/i }),
    ).toBeInTheDocument();
  });

  it("viewer empty-state suppresses the create CTA", () => {
    // The empty-state body has its own "+ New datasource" affordance; viewers
    // should NOT see that either (admin-only creation path).
    asViewer();
    mockList = [];
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/\+ 新增数据源|\+ new datasource/i)).toBeNull();
    // Empty-state itself still renders so the user sees why the table is blank.
    expect(
      screen.getByText(/no prometheus datasource|尚未配置 prometheus 数据源/i),
    ).toBeInTheDocument();
  });

  it("clicking 'Set as default' on a non-default row invokes the mutation with its id", async () => {
    setDefaultMutate.mockResolvedValueOnce(undefined);
    mockList = TWO_ROW_FIXTURE;
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );
    // Only `prom-staging` (ds2, isDefault=false) renders the Set-default button.
    const btn = screen.getByRole("button", { name: /^设为默认|^set as default/i });
    fireEvent.click(btn);
    await waitFor(() => expect(setDefaultMutate).toHaveBeenCalledTimes(1));
    expect(setDefaultMutate).toHaveBeenCalledWith("ds2");
    // Success toast fires with the localized success message.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toMatch(/已设为默认|set as default/i);
  });

  it("delete flow: trash → AlertDialog confirm → mutate + cascade-count toast", async () => {
    // 2 connections will be detached when ds1 is dropped; the success toast
    // MUST surface that count (the whole point of returning consumersDetached).
    deleteMutate.mockResolvedValueOnce({ consumersDetached: 2 });
    mockList = TWO_ROW_FIXTURE;
    render(
      <MemoryRouter>
        <DatasourcesPage />
      </MemoryRouter>,
    );

    // Two trash icons (one per row). Click the first — corresponds to ds1.
    const trashButtons = screen.getAllByLabelText(/^删除$|^delete$/i);
    expect(trashButtons.length).toBe(2);
    fireEvent.click(trashButtons[0]);

    // AlertDialog opens; the confirm button uses t("delete.confirm") = "删除".
    // Cancel says t.common("actions.cancel") = "取消" / "Cancel".
    const confirmBtn = await screen.findByRole("button", { name: /^删除$|^delete$/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deleteMutate).toHaveBeenCalledTimes(1));
    expect(deleteMutate).toHaveBeenCalledWith("ds1");

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // The localized message is "已删除,解绑 2 个 connection" / EN equivalent —
    // we just lock the `2` since the prose may evolve but the count must
    // always reach the user.
    expect(toastSuccess.mock.calls[0][0]).toMatch(/\b2\b/);
  });
});
