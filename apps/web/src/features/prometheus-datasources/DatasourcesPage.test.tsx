import "@/lib/i18n";
import { useAuthStore } from "@/stores/auth-store";
import type { PrometheusDatasourcePublic } from "@modeldoctor/contracts";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteMutate = vi.fn();
const setDefaultMutate = vi.fn();

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

import { DatasourcesPage } from "./DatasourcesPage";

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
    mockList = [
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
    mockList = [
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
});
